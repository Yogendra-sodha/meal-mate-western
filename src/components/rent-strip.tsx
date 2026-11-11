import { BanknoteArrowUp, Check, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { NoteCounterDialog } from "@/components/note-counter-dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { money, type NoteCounts, windowLabel } from "@/lib/rent";
import { cn } from "@/lib/utils";

interface Board {
  cycle_id: string;
  period: string;
  /** open right now — by the window's dates, or by the collector holding it open */
  is_open: boolean;
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
  /** whose rent they said they are also paying */
  covers?: string[];
  /** set when someone else paid this row */
  paid_by?: string | null;
}

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
 *
 * It shows while collection is open — from the window's first day to its
 * last, by itself, unless the collector is holding it open or shut.
 *
 * Someone handing over another person's rent too says so here, by name only.
 * They are never shown what anyone else owes; the collector checks the total.
 */
export function RentStrip() {
  const { user, members } = useAuth();
  const [board, setBoard] = useState<Board | null>(null);
  const [mine, setMine] = useState<MyDue | null>(null);
  const [counting, setCounting] = useState(false);
  const [covers, setCovers] = useState<string[]>([]);
  const nameOf = (id: string) => members.find((m) => m.user_id === id)?.name ?? "someone";

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("rent_board");
    const next = (data as Board | null) ?? null;
    setBoard(next);
    if (!next || !user) {
      setMine(null);
      return;
    }
    // Filtered by user rather than left to RLS. A housemate only ever has one
    // row to find, but the collector is an admin and can read every row in the
    // cycle — without this the query returns all of them, maybeSingle errors,
    // and the collector is the one person who cannot enter their own rent.
    // * rather than named columns, so a column the database does not have yet
    // is simply missing instead of failing the query and hiding the row.
    const { data: due } = await supabase
      .from("rent_dues")
      .select("*")
      .eq("cycle_id", next.cycle_id)
      .eq("user_id", user.id)
      .maybeSingle();
    setMine((due as MyDue | null) ?? null);
    setCovers((due as MyDue | null)?.covers ?? []);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const declare = async (notes: NoteCounts) => {
    // Covers sent only when there are some, so an ordinary declaration still
    // works on a database that has not had the update yet.
    const { data, error } = await supabase.rpc(
      "declare_rent_notes",
      covers.length ? { _notes: notes, _covers: covers } : { _notes: notes },
    );
    setCounting(false);
    const result = data as { ok: boolean; reason?: string; declared_cents?: number } | null;
    if (error || !result?.ok) {
      toast.error(
        result?.reason === "already_accepted"
          ? "Yogi has already accepted this — ask him to change it"
          : result?.reason === "window_closed"
            ? "Rent collection is closed right now"
            : result?.reason === "not_on_rent"
              ? "Someone you ticked is not on this month's rent"
              : covers.length && error
                ? "Paying for someone else needs an app update on Yogi's side — tell him"
                : "Could not save that",
      );
      return;
    }
    await load();
    toast.success(
      covers.length
        ? `Noted ${money(result.declared_cents ?? 0)} for you and ${covers.map(nameOf).join(", ")} — hand it to Yogi`
        : `Noted ${money(result.declared_cents ?? 0)} — hand it to Yogi to be accepted`,
    );
  };

  // The switch is the whole gate: closed means there is nothing to show.
  if (!board || !board.is_open || board.total === 0) return null;

  return (
    <section className="mb-4 overflow-hidden rounded-2xl">
      <div className="flex items-center gap-3 bg-primary-container px-4 py-3 text-primary-container-foreground">
        <BanknoteArrowUp className="h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-bold">
            Rent collection is open · {windowLabel(board.window_start, board.window_end)}
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
              <Check className="h-4 w-4" />
              {mine.paid_by
                ? `Your rent is paid · by ${nameOf(mine.paid_by)}`
                : `Your rent is accepted · ${money(mine.amount_paid_cents)}`}
            </p>
          ) : (
            <>
              <p className="min-w-0 text-sm">
                <span className="font-bold">You owe {money(mine.amount_due_cents)}</span>
                {mine.declared_cents > 0 ? (
                  (mine.covers?.length ?? 0) > 0 ? (
                    <span className="block text-xs text-muted-foreground">
                      You entered {money(mine.declared_cents)} for you and{" "}
                      {(mine.covers ?? []).map(nameOf).join(", ")} — waiting to be accepted
                    </span>
                  ) : mine.declared_cents < mine.amount_due_cents ? (
                    <span className="block text-xs font-semibold text-destructive">
                      You entered {money(mine.declared_cents)} —{" "}
                      {money(mine.amount_due_cents - mine.declared_cents)} short, so it cannot be
                      accepted yet
                    </span>
                  ) : (
                    <span className="block text-xs text-muted-foreground">
                      You entered {money(mine.declared_cents)} — waiting to be accepted
                    </span>
                  )
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
          description={
            covers.length
              ? `Your rent is ${money(mine.amount_due_cents)}, plus theirs — Yogi checks the total. Enter how many of each note you are giving.`
              : `Your rent is ${money(mine.amount_due_cents)}. Enter how many of each note you are giving.`
          }
          // Compared with your own rent only when it is only yours; with someone
          // else's in it the total is for the collector to check.
          dueCents={covers.length ? undefined : mine.amount_due_cents}
          initialNotes={mine.declared_notes}
          confirmLabel="That's"
          onClose={() => setCounting(false)}
          onConfirm={(notes) => void declare(notes)}
        >
          {members.length > 1 ? (
            <div>
              <p className="text-sm font-bold">Also paying for</p>
              <p className="text-xs text-muted-foreground">
                Tick anyone whose rent is in this pile too.
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {members
                  .filter((m) => m.user_id !== user?.id)
                  .map((m) => {
                    const on = covers.includes(m.user_id);
                    return (
                      <button
                        key={m.user_id}
                        type="button"
                        onClick={() =>
                          setCovers((list) =>
                            on ? list.filter((id) => id !== m.user_id) : [...list, m.user_id],
                          )
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
            </div>
          ) : null}
        </NoteCounterDialog>
      ) : null}
    </section>
  );
}
