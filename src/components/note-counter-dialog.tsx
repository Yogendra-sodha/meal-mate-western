import { Check } from "lucide-react";
import { useState } from "react";

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
import { countedCents, DENOMINATIONS, money, type NoteCounts } from "@/lib/rent";
import { cn } from "@/lib/utils";

/**
 * Counts a pile of notes and says what it comes to.
 *
 * Shared by the person handing the cash over and the person receiving it, so
 * both are looking at the same arithmetic. The total is always the notes and
 * never a typed figure, which is what stops the number saying one thing while
 * the cash says another.
 */
export function NoteCounterDialog({
  title,
  description,
  dueCents,
  requireCents,
  initialNotes,
  confirmLabel = "Save",
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  /** what is owed, so a shortfall can be shown; omit to hide the comparison */
  dueCents?: number | undefined;
  /** when set, the total must reach this before the action is allowed */
  requireCents?: number | undefined;
  initialNotes?: NoteCounts | undefined;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (notes: NoteCounts) => void;
}) {
  const [notes, setNotes] = useState<NoteCounts>(initialNotes ?? {});
  const total = countedCents(notes);
  const difference = dueCents === undefined ? 0 : total - dueCents;
  const short = requireCents !== undefined && total < requireCents;

  return (
    <Dialog open onOpenChange={(v) => (v ? null : onClose())}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto rounded-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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
          {dueCents === undefined ? null : difference !== 0 ? (
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

        <DialogFooter className="flex-col gap-1.5 sm:flex-col">
          <Button
            className="h-11 w-full rounded-full"
            disabled={total === 0 || short}
            onClick={() => onConfirm(notes)}
          >
            <Check className="mr-1 h-4 w-4" /> {confirmLabel} {money(total)}
          </Button>
          {short ? (
            <p className="w-full text-center text-xs font-semibold text-destructive">
              The full rent has to be handed over before it can be accepted.
            </p>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
