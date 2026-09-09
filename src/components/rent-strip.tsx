import { BanknoteArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { isWithinWindow, windowLabel } from "@/lib/rent";
import { cn } from "@/lib/utils";

interface Board {
  cycle_id: string;
  period: string;
  window_start: string;
  window_end: string;
  paid: number;
  total: number;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

/**
 * What the house sees about rent: how many have paid, and by when.
 *
 * A count and two dates, and that is the whole of it. Names and amounts are
 * not withheld by this component — they never reach the browser, because the
 * function behind it returns neither. Nothing here can leak what it does not
 * have.
 *
 * Shows only while there is something to act on: during the collection week,
 * or afterwards while someone still owes. The rest of the month it renders
 * nothing at all, which is most of the month.
 */
export function RentStrip() {
  const [board, setBoard] = useState<Board | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.rpc("rent_board").then(({ data }) => {
      if (active) setBoard((data as Board | null) ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!board || board.total === 0) return null;

  const now = today();
  const open = isWithinWindow(now, board.window_start, board.window_end);
  const overdue = now > board.window_end;
  const settled = board.paid >= board.total;

  // Nothing owed, or nothing yet to do: stay out of the way.
  if (settled || (!open && !overdue)) return null;

  return (
    <section
      className={cn(
        "mb-4 flex items-center gap-3 rounded-2xl px-4 py-3",
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
          {board.paid} of {board.total} paid — hand yours to Yogi in cash.
        </p>
      </div>
    </section>
  );
}
