import { Check, RotateCcw, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  countedCents,
  DENOMINATIONS,
  defaultRentWindow,
  isWithinWindow,
  money,
  monthLabel,
  type NoteCounts,
  periodOf,
  windowLabel,
} from "@/lib/rent";
import { cn } from "@/lib/utils";

interface Cycle {
  id: string;
  period: string;
  window_start: string;
  window_end: string;
}

interface Due {
  id: string;
  user_id: string;
  amount_due_cents: number;
  amount_paid_cents: number;
  notes: NoteCounts;
  paid: boolean;
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

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
  const [counting, setCounting] = useState<Due | null>(null);

  const load = useCallback(async () => {
    if (!household) return;
    setLoading(true);
    const { data: cycleRow } = await supabase
      .from("rent_cycles")
      .select("id, period, window_start, window_end")
      .eq("household_id", household.id)
      .eq("period", period)
      .maybeSingle();
    setCycle(cycleRow ?? null);
    if (cycleRow) {
      const { data: dueRows } = await supabase
        .from("rent_dues")
        .select("id, user_id, amount_due_cents, amount_paid_cents, notes, paid")
        .eq("cycle_id", cycleRow.id);
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
    });
    if (error) {
      toast.error("Could not open the month");
      return;
    }
    await load();
    toast.success(`${monthLabel(period)} opened`);
  };

  const setWindow = async (patch: { window_start?: string; window_end?: string }) => {
    if (!cycle) return;
    const next = { ...cycle, ...patch };
    if (next.window_end < next.window_start) {
      toast.error("The window cannot end before it starts");
      return;
    }
    const { error } = await supabase.from("rent_cycles").update(patch).eq("id", cycle.id);
    if (error) {
      toast.error("Could not change the window");
      return;
    }
    setCycle(next);
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

  const record = async (due: Due, notes: NoteCounts, paid: boolean) => {
    const { error } = await supabase.rpc("record_rent_payment", {
      _due_id: due.id,
      _notes: notes,
      _paid: paid,
    });
    if (error) {
      toast.error("Could not save that");
      return;
    }
    await load();
    toast.success(paid ? "Rent accepted" : "Marked unpaid again");
  };

  const nameOf = (userId: string) => members.find((m) => m.user_id === userId)?.name ?? "Someone";

  const totals = useMemo(() => {
    const due = dues.reduce((n, d) => n + d.amount_due_cents, 0);
    const collected = dues.reduce((n, d) => n + (d.paid ? d.amount_paid_cents : 0), 0);
    return { due, collected, paid: dues.filter((d) => d.paid).length };
  }, [dues]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading rent…</p>;

  if (!cycle) {
    const suggested = defaultRentWindow(period);
    return (
      <section className="surface-card p-4">
        <h3 className="font-bold">{monthLabel(period)}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Not opened yet. The collection week would be {windowLabel(suggested.start, suggested.end)}{" "}
          — you can change it after opening.
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

  const open = isWithinWindow(todayIso(), cycle.window_start, cycle.window_end);
  const included = new Set(dues.map((d) => d.user_id));

  return (
    <div className="space-y-4">
      <section className="surface-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold">{monthLabel(cycle.period)}</h3>
            <p className="text-xs text-muted-foreground">
              {open ? "Collecting now" : "Window closed"} ·{" "}
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
                      <Button
                        variant="secondary"
                        className="h-10 rounded-full"
                        onClick={() => void record(due, {}, false)}
                      >
                        <RotateCcw className="mr-1 h-4 w-4" /> Undo
                      </Button>
                    ) : (
                      <Button className="h-10 rounded-full" onClick={() => setCounting(due)}>
                        <Wallet className="mr-1 h-4 w-4" /> Count cash
                      </Button>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {counting ? (
        <CountDialog
          due={counting}
          name={nameOf(counting.user_id)}
          onClose={() => setCounting(null)}
          onAccept={(notes) => {
            void record(counting, notes, true);
            setCounting(null);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Counts the notes handed over, and says what that comes to.
 *
 * The total is the notes, never a typed figure, so it cannot say one thing
 * while the cash says another. A short payment is allowed — it happens — and
 * is shown as a shortfall rather than being quietly rounded up to the amount
 * due.
 */
function CountDialog({
  due,
  name,
  onClose,
  onAccept,
}: {
  due: Due;
  name: string;
  onClose: () => void;
  onAccept: (notes: NoteCounts) => void;
}) {
  const [notes, setNotes] = useState<NoteCounts>(due.notes ?? {});
  const total = countedCents(notes);
  const difference = total - due.amount_due_cents;

  return (
    <Dialog open onOpenChange={(v) => (v ? null : onClose())}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto rounded-3xl">
        <DialogHeader>
          <DialogTitle>Count {name}&apos;s rent</DialogTitle>
          <DialogDescription>
            Owes {money(due.amount_due_cents)}. Enter how many of each note.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {DENOMINATIONS.map((note) => {
            const count = notes[String(note)] ?? 0;
            return (
              <div
                key={note}
                className="grid grid-cols-[4rem_minmax(0,1fr)_5rem] items-center gap-3"
              >
                <span className="text-sm font-bold">${note}</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={count === 0 ? "" : count}
                  placeholder="0"
                  aria-label={`Number of $${note} notes`}
                  onChange={(e) =>
                    setNotes((n) => ({
                      ...n,
                      [String(note)]: Math.max(Math.floor(Number(e.target.value)) || 0, 0),
                    }))
                  }
                />
                <span className="text-right text-sm font-semibold text-muted-foreground">
                  {count > 0 ? money(count * note * 100) : "—"}
                </span>
              </div>
            );
          })}
        </div>

        <div className="rounded-2xl bg-surface-2 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">Counted</span>
            <span className="text-lg font-bold">{money(total)}</span>
          </div>
          {difference !== 0 ? (
            <p
              className={cn(
                "mt-1 text-xs font-semibold",
                difference < 0 ? "text-destructive" : "text-primary",
              )}
            >
              {difference < 0
                ? `${money(-difference)} short of what is due`
                : `${money(difference)} more than what is due`}
            </p>
          ) : (
            <p className="mt-1 text-xs font-semibold text-primary">Exactly right</p>
          )}
        </div>

        <DialogFooter>
          <Button
            className="h-11 w-full rounded-full"
            disabled={total === 0}
            onClick={() => onAccept(notes)}
          >
            <Check className="mr-1 h-4 w-4" /> Accept {money(total)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
