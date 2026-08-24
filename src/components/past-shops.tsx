import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { formatQty, weekRangeLabel } from "@/lib/planning";
import type { ShoppingTrip } from "@/lib/types";
import { cn } from "@/lib/utils";

function shortDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function weekLabel(weekStartIso: string) {
  const end = new Date(weekStartIso + "T00:00:00");
  end.setDate(end.getDate() + 6);
  const endIso = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(
    end.getDate(),
  ).padStart(2, "0")}`;
  return weekRangeLabel(weekStartIso, endIso);
}

/**
 * Completed shops, newest first, collapsed until one is opened.
 *
 * The heading is the day the shopping was done and the line under it is the
 * week it was for. Several shops can land on one day — a top-up after the main
 * run, or shopping ahead — so the date alone does not tell them apart.
 */
export function PastShops({ trips, className }: { trips: ShoppingTrip[]; className?: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!trips.length) return null;

  return (
    <section className={cn("surface-card overflow-hidden", className)}>
      <h2 className="bg-surface-2 px-4 py-2.5 text-sm font-bold">🧾 Past shops</h2>
      <ul>
        {trips.map((trip) => {
          const open = openId === trip.id;
          return (
            <li key={trip.id} className="border-b border-border last:border-0">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : trip.id)}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left"
              >
                <span className="min-w-0">
                  <span className="block font-semibold">{shortDate(trip.doneOn)}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    For {weekLabel(trip.coversWeek)} • {trip.items.length} item
                    {trip.items.length === 1 ? "" : "s"}
                    {trip.store ? ` • ${trip.store}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {trip.total !== undefined ? (
                    <span className="font-bold text-primary">
                      {trip.total.toLocaleString(undefined, {
                        style: "currency",
                        currency: "USD",
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  ) : null}
                  <ChevronDown
                    className={cn("h-4 w-4 text-muted-foreground", open && "rotate-180")}
                  />
                </span>
              </button>
              {open ? (
                <ul className="bg-surface-2 px-4 py-2">
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
    </section>
  );
}
