import { Check } from "lucide-react";
import { useMemo, useState } from "react";

import { NoteGrid } from "@/components/note-counter-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { countedCents, money, type NoteCounts, settle } from "@/lib/rent";
import { cn } from "@/lib/utils";

export interface Coverable {
  userId: string;
  name: string;
  dueCents: number;
}

export interface Acceptance {
  notes: NoteCounts;
  change: NoteCounts;
  changeFromPocket: boolean;
  covers: string[];
}

/**
 * Accepting a handover: whose rent it covers, what came in, what went back.
 *
 * Three questions in the order they are answered at the table. Who is this
 * for — sometimes one person brings two rents. What did they hand over. And,
 * only once it comes to more than is owed, what was given back.
 *
 * Accept stays disabled until handed over, less change, is exactly what is
 * owed. The database checks the same thing; checking here as well means the
 * collector sees the problem while still holding the notes.
 */
export function RentAcceptDialog({
  payerName,
  payerDueCents,
  coverable,
  initialNotes,
  initialCovers,
  onClose,
  onAccept,
}: {
  payerName: string;
  payerDueCents: number;
  /** others on this month's rent who have not paid, any of whom this payment may cover */
  coverable: Coverable[];
  initialNotes: NoteCounts;
  initialCovers: string[];
  onClose: () => void;
  onAccept: (acceptance: Acceptance) => void;
}) {
  const [notes, setNotes] = useState<NoteCounts>(initialNotes);
  const [change, setChange] = useState<NoteCounts>({});
  const [fromPocket, setFromPocket] = useState(false);
  const [covers, setCovers] = useState<string[]>(
    initialCovers.filter((id) => coverable.some((c) => c.userId === id)),
  );

  const covered = coverable.filter((c) => covers.includes(c.userId));
  const owedCents = payerDueCents + covered.reduce((n, c) => n + c.dueCents, 0);
  const handedCents = countedCents(notes);
  const changeCents = countedCents(change);
  const result = useMemo(
    () => settle({ handedCents, changeCents, owedCents }),
    [handedCents, changeCents, owedCents],
  );
  // Only asked about once there is something to give back, so the usual exact
  // payment is not cluttered with a section that does not apply.
  const showChange = handedCents > owedCents || changeCents > 0;

  return (
    <Dialog open onOpenChange={(v) => (v ? null : onClose())}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto rounded-3xl">
        <DialogHeader>
          <DialogTitle>Accept {payerName}'s rent</DialogTitle>
          <DialogDescription>
            {covered.length
              ? `Owes ${money(owedCents)} — ${payerName} ${money(payerDueCents)}${covered
                  .map((c) => ` + ${c.name} ${money(c.dueCents)}`)
                  .join("")}.`
              : `Owes ${money(payerDueCents)}.`}
          </DialogDescription>
        </DialogHeader>

        {coverable.length ? (
          <div>
            <p className="text-sm font-bold">Also paying for</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {coverable.map((c) => {
                const on = covers.includes(c.userId);
                return (
                  <button
                    key={c.userId}
                    type="button"
                    onClick={() =>
                      setCovers((list) =>
                        on ? list.filter((id) => id !== c.userId) : [...list, c.userId],
                      )
                    }
                    className={cn(
                      "rounded-full px-3 py-1.5 text-xs font-bold",
                      on
                        ? "bg-primary text-primary-foreground"
                        : "bg-surface-2 text-muted-foreground",
                    )}
                  >
                    {c.name} · {money(c.dueCents)}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div>
          <p className="mb-2 text-sm font-bold">Handed over</p>
          <NoteGrid notes={notes} onChange={setNotes} label="notes handed over" />
        </div>

        {showChange ? (
          <div className="rounded-2xl border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold">Change given back</p>
              <p className="text-sm font-bold text-primary">
                {money(Math.max(handedCents - owedCents, 0))} owed
              </p>
            </div>
            <div className="mt-2">
              <NoteGrid notes={change} onChange={setChange} label="notes given back" />
            </div>
            <label className="mt-3 flex items-center justify-between gap-3">
              <span className="min-w-0 text-xs text-muted-foreground">
                From my own pocket, not the rent pile — the notes collected stay as they are
              </span>
              <Switch
                checked={fromPocket}
                onCheckedChange={setFromPocket}
                aria-label="Change from my own pocket"
              />
            </label>
          </div>
        ) : null}

        <div className="rounded-2xl bg-surface-2 p-3 text-sm">
          <Row label="Handed over" value={money(handedCents)} />
          {changeCents > 0 ? <Row label="Given back" value={`− ${money(changeCents)}`} /> : null}
          <Row label="Rent received" value={money(result.netCents)} strong />
          <p
            className={cn(
              "mt-1 text-xs font-semibold",
              result.status === "exact" ? "text-primary" : "text-destructive",
            )}
          >
            {result.status === "exact"
              ? "Exactly what is owed"
              : result.status === "short"
                ? `${money(result.shortCents)} short — the full rent has to be handed over`
                : result.status === "over"
                  ? `${money(result.changeStillOwedCents)} over — record the change you give back`
                  : "More given back than was handed over"}
          </p>
        </div>

        <DialogFooter>
          <Button
            className="h-11 w-full rounded-full"
            disabled={result.status !== "exact" || handedCents === 0}
            onClick={() =>
              onAccept({
                notes,
                change,
                changeFromPocket: fromPocket && changeCents > 0,
                covers,
              })
            }
          >
            <Check className="mr-1 h-4 w-4" /> Accept {money(owedCents)}
            {covered.length ? ` for ${covered.length + 1} people` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between", strong && "font-bold")}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
