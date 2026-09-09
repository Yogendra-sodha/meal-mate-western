import { BanknoteArrowUp, Check, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { NoteCounterDialog } from "@/components/note-counter-dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { isWithinWindow, money, type NoteCounts, windowLabel } from "@/lib/rent";
import { cn } from "@/lib/utils";

interface Board {
  cycle_id: string;
  period: string;
  window_start: string;
  window_end: string;
  paid: number;
  total: number;
}

interface MyDue {
  amount_due_cents: number;
  amount_paid_cents: number;
  declared_notes: NoteCounts;
  declared_cents: number;
  paid: boolean;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

/**
 * Rent, as the house sees it.
 *
 * Two different things, and the difference is the point. The count is what
 * everyone may know: how many have paid, and by when — no names, no amounts,
 * because the function behind it returns none. Below it, a person's own row:
 * their rent, what they entered, whether it has been accepted. Row-level
 * security returns exactly one such row, so nobody's own view is a window
 * onto anyone else's.
 *
 * Entering notes is a claim, not a payment. The tick comes when the cash is
 * actually handed over and accepted.
 */
export function RentStrip() {
  const [board, setBoard] = useState<Board | null>(null);
  const [mine, setMine] = useState<MyDue | null>(null);
  const [counting, setCounting] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("rent_board");
    const next = (data as Board | null) ?? null;
    setBoard(next);
    if (!next) {
      setMine(null);
      return;
    }
    // RLS narrows this to the caller's own row; there is no other to fetch.
    const { data: due } = await supabase
      .from("rent_dues")
      .select("amount_due_cents, amount_paid_cents, declared_notes, declared_cents, paid")
      .eq("cycle_id", next.cycle_id)
      .maybeSingle();
    setMine((due as MyDue | null) ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const declare = async (notes: NoteCounts) => {
    const { data, error } = await supabase.rpc("declare_rent_notes", { _notes: notes });
    setCounting(false);
    const result = data as { ok: boolean; reason?: string; declared_cents?: number } | null;
    if (error || !result?.ok) {
      toast.error(
        result?.reason === "already_accepted"
          ? "Yogi has already accepted this — ask him to change it"
          : "Could not save that",
      );
      return;
    }
    await load();
    toast.success(`Noted ${money(result.declared_cents ?? 0)} — hand it to Yogi to be accepted`);
  };

  if (!board || board.total === 0) return null;

  const now = today();
  const open = isWithinWindow(now, board.window_start, board.window_end);
  const overdue = now > board.window_end;
  const settled = board.paid >= board.total;

  // Nothing to act on, and nothing of one's own outstanding: stay out of the way.
  if (!open && !overdue && !(mine && !mine.paid)) return null;
  if (settled && !mine) return null;

  return (
    <section className="mb-4 overflow-hidden rounded-2xl">
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-3",
          overdue
            ? "bg-surface-2 text-foreground"
            : "bg-primary-container text-primary-container-foreground",
        )}
      >
        <BanknoteArrowUp className="h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-bold">
            {overdue ? "Rent is overdue" : "Rent week is open"} ·{" "}
            {windowLabel(board.window_start, board.window_end)}
          </p>
          <p className="text-xs opacity-80">
            {board.paid} of {board.total} paid
          </p>
        </div>
      </div>

      {mine ? (
        <div className="flex items-center justify-between gap-3 bg-surface-2 px-4 py-3">
          {mine.paid ? (
            <p className="flex items-center gap-1.5 text-sm font-bold text-primary">
              <Check className="h-4 w-4" /> Your rent is accepted · {money(mine.amount_paid_cents)}
            </p>
          ) : (
            <>
              <p className="min-w-0 text-sm">
                <span className="font-bold">You owe {money(mine.amount_due_cents)}</span>
                {mine.declared_cents > 0 ? (
                  <span className="block text-xs text-muted-foreground">
                    You entered {money(mine.declared_cents)} — waiting to be accepted
                  </span>
                ) : (
                  <span className="block text-xs text-muted-foreground">
                    Enter the notes you are handing over
                  </span>
                )}
              </p>
              <Button
                size="sm"
                variant={mine.declared_cents > 0 ? "secondary" : "default"}
                className="shrink-0 rounded-full"
                onClick={() => setCounting(true)}
              >
                <Wallet className="mr-1 h-4 w-4" />
                {mine.declared_cents > 0 ? "Change" : "Enter notes"}
              </Button>
            </>
          )}
        </div>
      ) : null}

      {counting && mine ? (
        <NoteCounterDialog
          title="What you are handing over"
          description={`Your rent is ${money(mine.amount_due_cents)}. Enter how many of each note you are giving.`}
          dueCents={mine.amount_due_cents}
          initialNotes={mine.declared_notes}
          confirmLabel="That's"
          onClose={() => setCounting(false)}
          onConfirm={(notes) => void declare(notes)}
        />
      ) : null}
    </section>
  );
}
