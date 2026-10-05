import { Check, Loader2, Share } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { pushTripToSplitwise, type SplitwiseRefusal } from "@/lib/splitwise/functions";
import { useStore } from "@/lib/store";
import type { ShoppingTrip } from "@/lib/types";
import { cn } from "@/lib/utils";

const MESSAGES: Record<SplitwiseRefusal, string> = {
  not_configured: "Splitwise is not set up on this deployment.",
  no_group: "No Splitwise group chosen yet — an admin sets that in Admin → Splitwise.",
  disabled: "Sending to Splitwise is switched off in Admin → Splitwise.",
  nobody_mapped: "None of the people you picked are matched to a Splitwise person.",
  no_total: "This shop has no bill total, so there is nothing to split.",
  already_sent: "This shop has already gone to Splitwise.",
  shares_wrong:
    "Whoever the Splitwise account belongs to has to be one of the people splitting it.",
  busy: "Splitwise is busy or rate-limiting. Try again in a minute.",
  splitwise_error: "Splitwise turned it down.",
};

/**
 * Sends one finished shop over as a single Splitwise expense.
 *
 * Deliberately a button rather than something that happens on saving a shop.
 * A free Splitwise account stops taking expenses after a handful in a day, so
 * when one is spent should be a decision rather than a surprise — and a shop
 * that fails to send is still safely a shop here.
 */
export function SendToSplitwise({ trip }: { trip: ShoppingTrip }) {
  const { members } = useAuth();
  const { reload } = useStore();
  const [ready, setReady] = useState(false);
  const [mapped, setMapped] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [{ data: settings }, { data: rows }] = await Promise.all([
        supabase.from("splitwise_settings").select("enabled, group_id").limit(1).maybeSingle(),
        supabase.from("splitwise_members").select("user_id"),
      ]);
      if (!alive) return;
      const ids = (rows ?? []).map((r) => r.user_id);
      setMapped(ids);
      // Everyone who can be included starts included: the whole house is the
      // common case, and dropping two people is quicker than picking eight.
      setPicked(ids);
      setReady(Boolean(settings?.enabled && settings.group_id) && ids.length > 0);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (trip.splitwiseExpenseId) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Check className="h-3.5 w-3.5" /> On Splitwise
      </p>
    );
  }

  if (!ready || trip.total === undefined || trip.total <= 0) return null;

  const send = async () => {
    if (!picked.length) {
      toast.error("Pick who this shop was shared between");
      return;
    }
    setBusy(true);
    try {
      const result = await pushTripToSplitwise({ data: { tripId: trip.id, userIds: picked } });
      if (!result.ok) {
        const base = MESSAGES[result.refusal] ?? "Could not send that.";
        toast.error(result.detail ? `${base} (${result.detail})` : base, { duration: 8000 });
        // Another phone may have sent it while this one was looking at it.
        if (result.refusal === "already_sent") await reload();
        return;
      }
      toast.success(`Split between ${result.people} — ${result.owedEach} each`);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const choosable = members.filter((m) => mapped.includes(m.user_id));

  return (
    <div className="mt-2">
      {open ? (
        <>
          <p className="text-xs font-semibold text-muted-foreground">Split between</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {choosable.map((m) => {
              const on = picked.includes(m.user_id);
              return (
                <button
                  key={m.user_id}
                  type="button"
                  onClick={() =>
                    setPicked((p) => (on ? p.filter((id) => id !== m.user_id) : [...p, m.user_id]))
                  }
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-bold",
                    on
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface-2 text-muted-foreground",
                  )}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              className="h-9 flex-1 rounded-full"
              disabled={busy || !picked.length}
              onClick={() => void send()}
            >
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Send {picked.length ? `(${picked.length})` : ""}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-9 rounded-full"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          className="h-9 rounded-full"
          onClick={() => setOpen(true)}
        >
          <Share className="mr-1.5 h-3.5 w-3.5" /> Send to Splitwise
        </Button>
      )}
    </div>
  );
}
