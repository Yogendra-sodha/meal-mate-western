import { AlertTriangle, Check, RotateCcw, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { type Acceptance, RentAcceptDialog } from "@/components/rent-accept-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  countedCents,
  defaultRentWindow,
  localTimeZone,
  money,
  monthLabel,
  type NoteCounts,
  type OpenMode,
  periodOf,
  settle,
  tallyNotes,
  windowLabel,
  windowState,
} from "@/lib/rent";
import { cn } from "@/lib/utils";

/** The migration this screen needs; named so a missing one can be asked for by name. */
const MIGRATION = "20261111090000_rent_change_cover_schedule.sql";

interface Cycle {
  id: string;
  period: string;
  window_start: string;
  window_end: string;
  /** the old switch, still read on a database the migration has not reached */
  is_open?: boolean;
  open_mode?: OpenMode;
  time_zone?: string;
}

interface Due {
  id: string;
  user_id: string;
  amount_due_cents: number;
  amount_paid_cents: number;
  notes: NoteCounts;
  /** what they entered themselves, before it was accepted */
  declared_notes: NoteCounts;
  declared_cents: number;
  paid: boolean;
  change_notes?: NoteCounts;
  change_from_pocket?: boolean;
  /** on a payer's row: whose rent they are also paying */
  covers?: string[];
  /** on a covered row: who paid it */
  paid_by?: string | null;
}

/** A missing database function reads as a glitch unless it is named as what it is. */
function isMissingMigration(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    /could not find the function|does not exist|schema cache/i.test(error.message ?? "")
  );
}

/**
 * Rent collection, for the person actually collecting it.
 *
 * Everything private lives here and nowhere else: who owes what, what was
 * counted, and the month's total. The house sees a count on the home screen
 * and nothing more.
 *
 * Who pays is chosen rather than assumed — a month may not include everyone,
 * and the collector is on the list like anyone else.
 */
export function RentAdminPanel() {
  const { household, members, user } = useAuth();
  const [period, setPeriod] = useState(() => periodOf(new Date()));
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [dues, setDues] = useState<Due[]>([]);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState<Due | null>(null);
  // null until known. False means the database is a step behind this screen,
  // which is said plainly rather than left to look like a broken switch.
  const [migrated, setMigrated] = useState<boolean | null>(null);
  const pickedStartMonth = useRef(false);

  /**
   * Opens on the month whose window is running, not just the calendar month.
   *
   * A window can run from the end of one month into the next — 27 Sep to 3 Oct
   * — and opening on October on the 1st hid September's collection in the
   * middle of it.
   */
  useEffect(() => {
    if (!household || pickedStartMonth.current) return;
    pickedStartMonth.current = true;
    void (async () => {
      const { data } = await supabase
        .from("rent_cycles")
        .select("*")
        .eq("household_id", household.id)
        .order("period", { ascending: false })
        .limit(6);
      const rows = (data as Cycle[] | null) ?? [];
      const running = rows.find(
        (c) =>
          windowState(c.open_mode ?? (c.is_open ? "open" : "closed"), c.window_start, c.window_end)
            .open,
      );
      if (running) setPeriod(running.period);
    })();
  }, [household]);

  const load = useCallback(async () => {
    if (!household) return;
    setLoading(true);
    // Everything selected as *, so a column the migration has not added yet is
    // simply absent instead of failing the whole query and the screen with it.
    const { data: cycleRow } = await supabase
      .from("rent_cycles")
      .select("*")
      .eq("household_id", household.id)
      .eq("period", period)
      .maybeSingle();
    const { error: probe } = await supabase.from("rent_cycles").select("open_mode").limit(1);
    setMigrated(!probe);

    const found = (cycleRow as Cycle | null) ?? null;
    setCycle(found);

    // A month created before the time zone was recorded is quietly given this
    // browser's, so that its last day ends at local midnight.
    if (found && !probe && (found.time_zone ?? "UTC") === "UTC" && localTimeZone() !== "UTC") {
      await supabase.from("rent_cycles").update({ time_zone: localTimeZone() }).eq("id", found.id);
    }

    if (found) {
      const { data: dueRows } = await supabase
        .from("rent_dues")
        .select("*")
        .eq("cycle_id", found.id);
      setDues((dueRows as Due[] | null) ?? []);
    } else {
      setDues([]);
    }
    setLoading(false);
  }, [household, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCycle = async () => {
    if (!household || !user) return;
    const suggested = defaultRentWindow(period);
    const { error } = await supabase.from("rent_cycles").insert({
      household_id: household.id,
      period,
      window_start: suggested.start,
      window_end: suggested.end,
      created_by: user.id,
      ...(migrated ? { time_zone: localTimeZone() } : {}),
    });
    if (error) {
      toast.error("Could not open the month");
      return;
    }
    await load();
    toast.success(`${monthLabel(period)} opened`);
  };

  const setWindow = async (patch: {
    window_start?: string;
    window_end?: string;
    is_open?: boolean;
    open_mode?: OpenMode;
  }) => {
    if (!cycle) return;
    const next = { ...cycle, ...patch };
    if (next.window_end < next.window_start) {
      toast.error("The window cannot end before it starts");
      return;
    }
    const write = migrated ? { ...patch, time_zone: localTimeZone() } : patch;
    const { error } = await supabase.from("rent_cycles").update(write).eq("id", cycle.id);
    if (error) {
      toast.error("Could not change the window");
      return;
    }
    setCycle({ ...next, ...(migrated ? { time_zone: localTimeZone() } : {}) });
  };

  /** Adding someone to the month, or taking them off it. */
  const toggleMember = async (userId: string, include: boolean) => {
    if (!cycle || !household) return;
    if (include) {
      // Carries last month's amount forward as the starting figure, since it
      // rarely changes and retyping it every month invites a typo.
      const { data: previous } = await supabase
        .from("rent_dues")
        .select("amount_due_cents")
        .eq("user_id", userId)
        .eq("household_id", household.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { error } = await supabase.from("rent_dues").insert({
        cycle_id: cycle.id,
        household_id: household.id,
        user_id: userId,
        amount_due_cents: previous?.amount_due_cents ?? 0,
      });
      if (error) {
        toast.error("Could not add them");
        return;
      }
    } else {
      const due = dues.find((d) => d.user_id === userId);
      if (due?.paid) {
        toast.error("They have already paid — reverse that first");
        return;
      }
      await supabase.from("rent_dues").delete().eq("cycle_id", cycle.id).eq("user_id", userId);
    }
    await load();
  };

  const setAmount = async (due: Due, dollars: number) => {
    const cents = Math.max(Math.round(dollars * 100), 0);
    if (cents === due.amount_due_cents) return;
    const { error } = await supabase
      .from("rent_dues")
      .update({ amount_due_cents: cents, updated_at: new Date().toISOString() })
      .eq("id", due.id);
    if (error) {
      toast.error("Could not save that amount");
      return;
    }
    setDues((list) => list.map((d) => (d.id === due.id ? { ...d, amount_due_cents: cents } : d)));
  };

  const nameOf = useCallback(
    (userId: string) => members.find((m) => m.user_id === userId)?.name ?? "Someone",
    [members],
  );

  /**
   * Accepts or reverses a payment.
   *
   * The extra arguments are sent only when they are used. A plain, exact
   * payment then goes through on a database the migration has not reached,
   * and only change or covering — which that database cannot record — asks
   * for it.
   */
  const record = async (due: Due, paid: boolean, acceptance?: Acceptance) => {
    const changeUsed = acceptance ? countedCents(acceptance.change) > 0 : false;
    const coversUsed = acceptance
      ? acceptance.covers.length > 0 || (due.covers?.length ?? 0) > 0
      : false;
    const args: {
      _due_id: string;
      _notes: NoteCounts;
      _paid: boolean;
      _change?: NoteCounts;
      _change_from_pocket?: boolean;
      _covers?: string[];
    } = { _due_id: due.id, _notes: acceptance?.notes ?? {}, _paid: paid };
    if (changeUsed && acceptance) {
      args._change = acceptance.change;
      args._change_from_pocket = acceptance.changeFromPocket;
    }
    if (coversUsed && acceptance) args._covers = acceptance.covers;

    const { data, error } = await supabase.rpc("record_rent_payment", args);
    const result = data as {
      ok: boolean;
      reason?: string;
      short_cents?: number;
      over_cents?: number;
      paid_by?: string;
      user_ids?: string[];
      covered?: number;
    } | null;

    if (isMissingMigration(error)) {
      toast.error(`Change and paying for others need the database update — run ${MIGRATION}`, {
        duration: 10000,
      });
      return;
    }
    if (error || !result?.ok) {
      const reason = result?.reason;
      toast.error(
        reason === "short"
          ? `${money(result?.short_cents ?? 0)} short — the full rent has to be handed over`
          : reason === "over"
            ? `${money(result?.over_cents ?? 0)} over — record the change you gave back`
            : reason === "change_too_big"
              ? "More change given back than was handed over"
              : reason === "covered_by_other"
                ? `Paid by ${nameOf(result?.paid_by ?? "")} — undo their payment instead`
                : reason === "cover_already_paid"
                  ? `${(result?.user_ids ?? []).map(nameOf).join(", ")} already paid — untick them`
                  : reason === "already_paid"
                    ? "Already accepted"
                    : reason === "not_on_rent"
                      ? "Someone ticked is not on this month's rent"
                      : "Could not save that",
        { duration: 8000 },
      );
      return;
    }
    await load();
    toast.success(
      paid
        ? result.covered
          ? `Accepted for ${result.covered + 1} people`
          : "Rent accepted"
        : "Marked unpaid again",
    );
  };

  const totals = useMemo(() => {
    const due = dues.reduce((n, d) => n + d.amount_due_cents, 0);
    const collected = dues.reduce((n, d) => n + (d.paid ? d.amount_paid_cents : 0), 0);
    return { due, collected, paid: dues.filter((d) => d.paid).length };
  }, [dues]);

  // Only accepted payments, less change handed back out of the pile. The tally
  // is meant to match the cash actually in hand, and neither what someone said
  // they would hand over nor change already given back is in it.
  const tally = useMemo(() => {
    const accepted = dues.filter((d) => d.paid);
    return tallyNotes(
      accepted.map((d) => d.notes ?? {}),
      accepted.filter((d) => !d.change_from_pocket).map((d) => d.change_notes ?? {}),
    );
  }, [dues]);

  /** Who each unpaid person's own declaration says is paying for them, if anyone. */
  const claimedBy = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const d of dues) {
      if (d.paid) continue;
      for (const covered of d.covers ?? []) {
        map.set(covered, [...(map.get(covered) ?? []), d.user_id]);
      }
    }
    return map;
  }, [dues]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading rent…</p>;

  if (!cycle) {
    const suggested = defaultRentWindow(period);
    return (
      <section className="surface-card p-4">
        <h3 className="font-bold">{monthLabel(period)}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Not set up yet. Creating it starts with {windowLabel(suggested.start, suggested.end)} as
          the dates, which you can change. Collection opens by itself on the first day and closes
          after the last.
        </p>
        <div className="mt-3 flex gap-2">
          <Button className="h-11 flex-1 rounded-full" onClick={() => void openCycle()}>
            Open {monthLabel(period)}
          </Button>
          <Button
            variant="secondary"
            className="h-11 rounded-full"
            onClick={() => setPeriod(shiftMonth(period, -1))}
          >
            Previous month
          </Button>
        </div>
      </section>
    );
  }

  const included = new Set(dues.map((d) => d.user_id));
  const mode: OpenMode = cycle.open_mode ?? (cycle.is_open ? "open" : "closed");
  const state = windowState(mode, cycle.window_start, cycle.window_end);

  return (
    <div className="space-y-4">
      {migrated === false ? (
        <div className="flex gap-2.5 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="min-w-0">
            The database is a step behind. Run{" "}
            <span className="font-mono text-xs">{MIGRATION}</span> for windows that open and close
            by their dates, change given back, and paying for someone else. Until then the switch
            below works the old way.
          </p>
        </div>
      ) : null}

      <section className="surface-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold">{monthLabel(cycle.period)}</h3>
            <p className="text-xs text-muted-foreground">
              {windowLabel(cycle.window_start, cycle.window_end)}
            </p>
          </div>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={() => setPeriod(shiftMonth(period, -1))}
            >
              ‹
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={() => setPeriod(shiftMonth(period, 1))}
            >
              ›
            </Button>
          </div>
        </div>

        <div
          className={cn(
            "mt-3 rounded-2xl px-3 py-2.5",
            state.open ? "bg-primary-container text-primary-container-foreground" : "bg-surface-2",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold">{state.headline}</p>
              <p className="text-xs opacity-80">{state.detail}</p>
            </div>
            {migrated === false ? (
              <Switch
                checked={Boolean(cycle.is_open)}
                onCheckedChange={(v) => void setWindow({ is_open: v })}
                aria-label="Open rent collection"
              />
            ) : null}
          </div>
          {migrated ? (
            <div className="mt-2.5 grid grid-cols-3 gap-1 rounded-full bg-background/60 p-1">
              {(
                [
                  ["auto", "Follow dates"],
                  ["open", "Open now"],
                  ["closed", "Closed"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => void setWindow({ open_mode: value })}
                  className={cn(
                    "rounded-full py-1.5 text-xs font-bold",
                    mode === value ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="rent-from">Window opens</Label>
            <Input
              id="rent-from"
              type="date"
              value={cycle.window_start}
              onChange={(e) => void setWindow({ window_start: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rent-to">Window closes</Label>
            <Input
              id="rent-to"
              type="date"
              value={cycle.window_end}
              onChange={(e) => void setWindow({ window_end: e.target.value })}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {migrated === false
            ? "These dates are what the house is told; the switch is what opens it."
            : "Follow dates opens on the first day and closes after the last, by itself. Open now and Closed override the dates — for a late payer, or to stop early."}
        </p>
      </section>

      <section className="surface-card p-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <Figure label="Collected" value={money(totals.collected)} />
          <Figure label="Expected" value={money(totals.due)} />
          <Figure label="Paid" value={`${totals.paid}/${dues.length}`} />
        </div>
      </section>

      <section className="surface-card overflow-hidden">
        <h3 className="bg-surface-2 px-4 py-2.5 text-sm font-bold">Who is paying this month</h3>
        <ul>
          {members.map((member) => {
            const due = dues.find((d) => d.user_id === member.user_id);
            const isIn = included.has(member.user_id);
            const coversNames = (due?.covers ?? []).map(nameOf);
            const declaredOwed =
              (due?.amount_due_cents ?? 0) +
              (due?.covers ?? []).reduce(
                (n, id) => n + (dues.find((d) => d.user_id === id)?.amount_due_cents ?? 0),
                0,
              );
            const quick =
              due && !due.paid && due.declared_cents > 0
                ? settle({
                    handedCents: due.declared_cents,
                    changeCents: 0,
                    owedCents: declaredOwed,
                  })
                : null;
            const othersClaiming = (claimedBy.get(member.user_id) ?? []).map(nameOf);
            const givenBack = countedCents(due?.change_notes ?? {});
            return (
              <li key={member.user_id} className="border-b border-border px-4 py-3 last:border-0">
                <div className="flex items-center justify-between gap-3">
                  <label className="flex min-w-0 items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={isIn}
                      onChange={(e) => void toggleMember(member.user_id, e.target.checked)}
                      className="h-5 w-5 shrink-0 accent-[var(--color-primary)]"
                    />
                    <span className="min-w-0 truncate font-semibold">
                      {member.name}
                      {member.user_id === user?.id ? " (you)" : ""}
                    </span>
                  </label>
                  {due?.paid ? (
                    <span className="flex shrink-0 items-center gap-1 text-sm font-bold text-primary">
                      <Check className="h-4 w-4" /> {money(due.amount_paid_cents)}
                    </span>
                  ) : null}
                </div>

                {due?.paid && (due.paid_by || coversNames.length || givenBack > 0) ? (
                  <p className="mt-1 pl-7 text-xs text-muted-foreground">
                    {due.paid_by ? `Paid by ${nameOf(due.paid_by)}` : null}
                    {coversNames.length ? `Also paid for ${coversNames.join(", ")}` : null}
                    {givenBack > 0
                      ? `${coversNames.length ? " · " : ""}${money(givenBack)} given back${
                          due.change_from_pocket ? " from your pocket" : ""
                        }`
                      : null}
                  </p>
                ) : null}

                {isIn && due ? (
                  <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor={`amt-${due.id}`} className="text-xs">
                        Rent due
                      </Label>
                      <Input
                        id={`amt-${due.id}`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="1"
                        disabled={due.paid}
                        defaultValue={due.amount_due_cents / 100}
                        onBlur={(e) => void setAmount(due, Number(e.target.value))}
                      />
                    </div>
                    {due.paid ? (
                      due.paid_by ? (
                        <p className="max-w-[9rem] pb-2 text-right text-xs text-muted-foreground">
                          Undo {nameOf(due.paid_by)}'s payment to change this
                        </p>
                      ) : (
                        <Button
                          variant="secondary"
                          className="h-10 rounded-full"
                          onClick={() => void record(due, false)}
                        >
                          <RotateCcw className="mr-1 h-4 w-4" /> Undo
                        </Button>
                      )
                    ) : (
                      <Button
                        variant={due.declared_cents > 0 ? "secondary" : "default"}
                        className="h-10 rounded-full"
                        onClick={() => setAccepting(due)}
                      >
                        <Wallet className="mr-1 h-4 w-4" />
                        {due.declared_cents > 0 ? "Check" : "Count cash"}
                      </Button>
                    )}
                  </div>
                ) : null}

                {isIn && due && !due.paid && othersClaiming.length ? (
                  <p className="mt-2 text-xs font-semibold text-primary">
                    {othersClaiming.join(", ")}{" "}
                    {othersClaiming.length === 1 ? "says they are" : "say they are"} paying for{" "}
                    {member.name}
                    {due.declared_cents > 0
                      ? " — and they entered their own too, so check which"
                      : ""}
                  </p>
                ) : null}

                {isIn && due && !due.paid && due.declared_cents > 0 && quick ? (
                  <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2">
                    <p className="min-w-0 text-xs">
                      They entered <span className="font-bold">{money(due.declared_cents)}</span>
                      {coversNames.length ? ` for them + ${coversNames.join(", ")}` : null}
                      {quick.status !== "exact" ? (
                        <span className="text-destructive">
                          {" "}
                          ·{" "}
                          {quick.status === "short"
                            ? `${money(quick.shortCents)} short`
                            : `${money(quick.changeStillOwedCents)} over — change owed`}
                        </span>
                      ) : null}
                    </p>
                    <Button
                      size="sm"
                      className="shrink-0 rounded-full"
                      onClick={() =>
                        // An exact handover is accepted in one tap. Anything else
                        // opens the count, where change can be recorded.
                        quick.status === "exact"
                          ? void record(due, true, {
                              notes: due.declared_notes,
                              change: {},
                              changeFromPocket: false,
                              covers: due.covers ?? [],
                            })
                          : setAccepting(due)
                      }
                    >
                      <Check className="mr-1 h-4 w-4" />{" "}
                      {quick.status === "exact" ? "Accept" : "Check"}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {tally.some((row) => row.count !== 0) ? (
        <section className="surface-card overflow-hidden">
          <h3 className="bg-surface-2 px-4 py-2.5 text-sm font-bold">Notes collected</h3>
          <ul>
            {tally.map((row) => (
              <li
                key={row.note}
                className="grid grid-cols-[4rem_minmax(0,1fr)_6rem] items-center gap-3 border-b border-border px-4 py-2.5 last:border-0"
              >
                <span className="text-sm font-bold">${row.note}</span>
                <span
                  className={cn(
                    "text-sm",
                    row.count === 0 && "text-muted-foreground",
                    row.count < 0 && "font-semibold text-destructive",
                  )}
                >
                  {row.count === 0 ? "none" : `× ${row.count}`}
                </span>
                <span
                  className={cn(
                    "text-right text-sm font-semibold",
                    row.count === 0 ? "text-muted-foreground" : "text-primary",
                  )}
                >
                  {row.count === 0 ? "—" : money(row.cents)}
                </span>
              </li>
            ))}
          </ul>
          {tally.some((row) => row.count < 0) ? (
            <p className="border-t border-border px-4 py-2 text-xs text-destructive">
              More of a note went back as change than was ever collected — some change must have
              come from your pocket. Mark it so on that payment.
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-3 bg-surface-2 px-4 py-2.5">
            <span className="text-sm font-bold">
              {tally.reduce((n, row) => n + row.count, 0)} notes in hand
            </span>
            <span className="text-sm font-bold">
              {money(tally.reduce((n, row) => n + row.cents, 0))}
            </span>
          </div>
        </section>
      ) : null}

      {accepting ? (
        <RentAcceptDialog
          payerName={nameOf(accepting.user_id)}
          payerDueCents={accepting.amount_due_cents}
          coverable={dues
            .filter((d) => d.id !== accepting.id && !d.paid)
            .map((d) => ({
              userId: d.user_id,
              name: nameOf(d.user_id),
              dueCents: d.amount_due_cents,
            }))}
          initialNotes={
            Object.keys(accepting.declared_notes ?? {}).length
              ? accepting.declared_notes
              : accepting.notes
          }
          initialCovers={accepting.covers ?? []}
          onClose={() => setAccepting(null)}
          onAccept={(acceptance) => {
            void record(accepting, true, acceptance);
            setAccepting(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-2 py-3">
      <p className="text-lg font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/** Steps the yyyy-mm-01 key by whole months. */
function shiftMonth(period: string, by: number): string {
  const [year, month] = period.split("-").map(Number) as [number, number];
  const d = new Date(year, month - 1 + by, 1);
  return periodOf(d);
}
