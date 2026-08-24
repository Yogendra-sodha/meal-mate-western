import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { formatQty, weekRangeLabel } from "@/lib/planning";
import type { ShoppingTrip } from "@/lib/types";
import { cn } from "@/lib/utils";

function endOfWeekIso(weekStartIso: string) {
  const end = new Date(weekStartIso + "T00:00:00");
  end.setDate(end.getDate() + 6);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(
    end.getDate(),
  ).padStart(2, "0")}`;
}

const weekLabel = (weekStartIso: string) =>
  weekRangeLabel(weekStartIso, endOfWeekIso(weekStartIso));

const dayLabel = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });

const money = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** Chevron that points down once its row is open. */
function Caret({ open }: { open: boolean }) {
  return (
    <ChevronRight
      className={cn(
        "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
        open && "rotate-90",
      )}
    />
  );
}

interface WeekGroup {
  weekStart: string;
  trips: ShoppingTrip[];
  itemCount: number;
  spend: number | null;
}

/**
 * Past shops as Week → Shop → Items, each level opening on tap.
 *
 * Grouping by week rather than listing shops flat is what makes several shops
 * on one day readable: a top-up run and the main run sit under the week they
 * were for, instead of as repeated identical dates.
 *
 * `onlyWeek` narrows to a single week — the grocery list uses it to show just
 * the week being planned, and opens that week by default since it is the only
 * one there.
 */
export function PastShops({
  trips,
  className,
  onlyWeek,
  title = "Past shops",
}: {
  trips: ShoppingTrip[];
  className?: string;
  onlyWeek?: string | undefined;
  title?: string;
}) {
  const weeks = useMemo<WeekGroup[]>(() => {
    const byWeek = new Map<string, ShoppingTrip[]>();
    for (const trip of trips) {
      if (onlyWeek && trip.coversWeek !== onlyWeek) continue;
      const list = byWeek.get(trip.coversWeek) ?? [];
      list.push(trip);
      byWeek.set(trip.coversWeek, list);
    }
    return [...byWeek.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([weekStart, list]) => {
        const sorted = [...list].sort((a, b) => b.doneOn.localeCompare(a.doneOn));
        const withTotals = sorted.filter((t) => t.total !== undefined);
        return {
          weekStart,
          trips: sorted,
          itemCount: sorted.reduce((n, t) => n + t.items.length, 0),
          // Only a partial figure if some shops went unpriced, so show nothing
          // rather than a total that looks complete but is not.
          spend:
            withTotals.length === sorted.length && withTotals.length > 0
              ? withTotals.reduce((n, t) => n + (t.total ?? 0), 0)
              : null,
        };
      });
  }, [trips, onlyWeek]);

  const [openWeeks, setOpenWeeks] = useState<string[]>(() => (onlyWeek ? [onlyWeek] : []));
  const [openTrips, setOpenTrips] = useState<string[]>([]);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  if (!weeks.length) return null;

  return (
    <section className={cn("surface-card overflow-hidden", className)}>
      <h2 className="bg-surface-2 px-4 py-2.5 text-sm font-bold">🧾 {title}</h2>
      <ul>
        {weeks.map((week) => {
          const weekOpen = openWeeks.includes(week.weekStart);
          return (
            <li key={week.weekStart} className="border-b border-border last:border-0">
              <button
                type="button"
                onClick={() => toggle(openWeeks, setOpenWeeks, week.weekStart)}
                aria-expanded={weekOpen}
                className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left"
              >
                <Caret open={weekOpen} />
                <span className="min-w-0">
                  <span className="block font-bold">{weekLabel(week.weekStart)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {week.trips.length} shop{week.trips.length === 1 ? "" : "s"} • {week.itemCount}{" "}
                    item{week.itemCount === 1 ? "" : "s"}
                  </span>
                </span>
                {week.spend !== null ? (
                  <span className="shrink-0 text-sm font-bold text-primary">
                    {money(week.spend)}
                  </span>
                ) : null}
              </button>

              {weekOpen ? (
                <ul className="border-t border-border bg-surface-2/40">
                  {week.trips.map((trip) => {
                    const tripOpen = openTrips.includes(trip.id);
                    return (
                      <li key={trip.id} className="border-b border-border/60 last:border-0">
                        <button
                          type="button"
                          onClick={() => toggle(openTrips, setOpenTrips, trip.id)}
                          aria-expanded={tripOpen}
                          className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-2.5 pl-9 pr-4 text-left"
                        >
                          <Caret open={tripOpen} />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">
                              {dayLabel(trip.doneOn)}
                              {trip.store ? ` • ${trip.store}` : ""}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {trip.items.length} item{trip.items.length === 1 ? "" : "s"}
                            </span>
                          </span>
                          {trip.total !== undefined ? (
                            <span className="shrink-0 text-sm font-semibold text-primary">
                              {money(trip.total)}
                            </span>
                          ) : null}
                        </button>

                        {tripOpen ? (
                          <ul className="pb-2 pl-16 pr-4">
                            {trip.items.map((item, i) => (
                              <li
                                key={`${item.name}-${i}`}
                                className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-1 text-sm"
                              >
                                <span className="min-w-0 truncate">{item.name}</span>
                                <span className="shrink-0 font-semibold text-primary">
                                  {formatQty(item.qty, item.unit)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
