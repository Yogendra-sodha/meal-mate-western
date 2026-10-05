import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  centsToAmount,
  sharesBalance,
  sharesToParams,
  splitEvenly,
  toCents,
} from "@/lib/splitwise/shares";

export type SplitwiseRefusal =
  | "not_configured"
  | "no_group"
  | "disabled"
  | "nobody_mapped"
  | "no_total"
  | "already_sent"
  | "shares_wrong"
  | "busy"
  | "splitwise_error";

export type GroupsResult =
  | {
      ok: true;
      me: { id: number; name: string };
      groups: { id: number; name: string; members: { id: number; name: string }[] }[];
    }
  | { ok: false; refusal: SplitwiseRefusal; detail?: string };

export type PushResult =
  | { ok: true; expenseId: number; owedEach: string; people: number }
  | { ok: false; refusal: SplitwiseRefusal; detail?: string };

/**
 * The token owner's groups and members, for the admin screen.
 *
 * Read-only, and the first thing worth calling: it proves the token works and
 * saves anyone typing a group id by hand.
 */
export const splitwiseGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<GroupsResult> => {
    const { getToken, getCurrentUser, getGroups } = await import("@/lib/splitwise/client.server");
    const token = getToken();
    if (!token) return { ok: false, refusal: "not_configured" };

    try {
      const [me, groups] = await Promise.all([getCurrentUser(token), getGroups(token)]);
      return { ok: true, me, groups };
    } catch (error) {
      const { detail, busy } = error as { detail?: string; busy?: boolean };
      console.error("[splitwise] could not read the account:", error);
      return {
        ok: false,
        refusal: busy ? "busy" : "splitwise_error",
        ...(detail ? { detail } : {}),
      };
    }
  });

const pushSchema = z.object({
  tripId: z.string().uuid(),
  /** household members to split between; everyone when empty is not assumed */
  userIds: z.array(z.string().uuid()).min(1),
});

/**
 * Sends one shop to Splitwise as a single expense.
 *
 * One expense per shop, never one per item: a free Splitwise account stops
 * accepting after a handful in a day, and an eight-item shop would spend the
 * lot. The lines go in the expense's details instead.
 *
 * The right to post is claimed in Postgres before Splitwise is called, and
 * given back if the call fails. create_expense has no idempotency key, so
 * without that a second tap bills everybody twice.
 */
export const pushTripToSplitwise = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => pushSchema.parse(data))
  .handler(async ({ data, context }): Promise<PushResult> => {
    const { supabase } = context;

    const { getToken, getCurrentUser, createExpense } =
      await import("@/lib/splitwise/client.server");
    const token = getToken();
    if (!token) return { ok: false, refusal: "not_configured" };

    const { data: settings } = await supabase
      .from("splitwise_settings")
      .select("group_id, enabled")
      .limit(1)
      .maybeSingle();
    if (!settings?.enabled) return { ok: false, refusal: "disabled" };
    if (!settings.group_id) return { ok: false, refusal: "no_group" };

    const { data: trip } = await supabase
      .from("shopping_trips")
      .select("id, done_on, store, total, items, splitwise_expense_id")
      .eq("id", data.tripId)
      .maybeSingle();
    if (!trip) return { ok: false, refusal: "already_sent" };
    if (trip.splitwise_expense_id) return { ok: false, refusal: "already_sent" };
    if (!trip.total || trip.total <= 0) return { ok: false, refusal: "no_total" };

    // Only members who have been mapped. Someone not on Splitwise is left out
    // of the split rather than breaking it.
    const { data: mapped } = await supabase
      .from("splitwise_members")
      .select("user_id, splitwise_user_id")
      .in("user_id", data.userIds);
    const participantIds = (mapped ?? []).map((m) => Number(m.splitwise_user_id));
    if (!participantIds.length) return { ok: false, refusal: "nobody_mapped" };

    let me;
    try {
      me = await getCurrentUser(token);
    } catch (error) {
      const { detail, busy } = error as { detail?: string; busy?: boolean };
      return {
        ok: false,
        refusal: busy ? "busy" : "splitwise_error",
        ...(detail ? { detail } : {}),
      };
    }

    // Whoever the token belongs to is the one who paid, and is in the split
    // too unless they were deliberately left out of it.
    const totalCents = toCents(Number(trip.total));
    const shares = splitEvenly(totalCents, me.id, participantIds);
    if (!shares || !sharesBalance(shares, totalCents)) {
      // Not balancing means the payer is not among the people splitting it,
      // which Splitwise would refuse anyway — better to say so plainly.
      return { ok: false, refusal: "shares_wrong" };
    }

    const { data: claimed, error: claimError } = await supabase.rpc("claim_splitwise_post", {
      _trip_id: data.tripId,
    });
    if (claimError) throw new Error(`Could not claim the shop: ${claimError.message}`);
    if (!claimed) return { ok: false, refusal: "already_sent" };

    const lines = (trip.items ?? []) as { name?: string; qty?: number; unit?: string }[];
    const details = lines
      .slice(0, 60)
      .map((i) => `${i.name ?? ""}${i.qty ? ` — ${i.qty} ${i.unit ?? ""}`.trimEnd() : ""}`)
      .filter(Boolean)
      .join("\n");

    try {
      const expenseId = await createExpense(token, {
        groupId: Number(settings.group_id),
        cost: centsToAmount(totalCents),
        description: trip.store ? `Groceries — ${trip.store}` : "Groceries",
        details,
        date: String(trip.done_on).slice(0, 10),
        shares: sharesToParams(shares),
      });

      await supabase.rpc("record_splitwise_post", {
        _trip_id: data.tripId,
        _expense_id: expenseId,
      });

      const owed = shares.find((s) => s.userId !== me.id) ?? shares[0]!;
      return {
        ok: true,
        expenseId,
        owedEach: centsToAmount(owed.owedCents),
        people: shares.length,
      };
    } catch (error) {
      // Handing the claim back matters as much as taking it: a shop that
      // failed to send must stay sendable.
      await supabase.rpc("release_splitwise_post", { _trip_id: data.tripId });
      const { detail, busy } = error as { detail?: string; busy?: boolean };
      console.error("[splitwise] could not create the expense:", error);
      return {
        ok: false,
        refusal: busy ? "busy" : "splitwise_error",
        ...(detail ? { detail } : {}),
      };
    }
  });
