import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Sparkles, Trash2, Users } from "lucide-react";
import { useState } from "react";

import { PageHeader, Screen } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  generateWeek,
  shortDayLabel,
  toISODate,
  weekDates,
  WEEKDAY_THEMES,
  parseISODate,
  suggestForDate,
} from "@/lib/planning";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/planner")({
  head: () => ({
    meta: [
      { title: "Weekly Menu Planner — Bachelor Dinner Planner" },
      {
        name: "description",
        content:
          "Plan a full week of pure-veg dinners for 10 roommates with an automatic Gujarati-first weekly rotation.",
      },
      { property: "og:title", content: "Weekly Menu Planner" },
      {
        property: "og:description",
        content: "Auto-generate or hand-pick every dinner of the week, then get the grocery list.",
      },
    ],
  }),
  component: Planner,
});

function Planner() {
  const store = useStore();
  const { state, recipes, recipesById } = store;
  const [offset, setOffset] = useState(0);
  const anchor = new Date();
  anchor.setDate(anchor.getDate() + offset * 7);
  const dates = weekDates(anchor).map(toISODate);
  const [moveFrom, setMoveFrom] = useState<string | null>(null);

  const generate = () => {
    const generated = generateWeek(dates, state);
    Object.entries(generated).forEach(([iso, ids]) => store.setDay(iso, ids));
  };

  return (
    <Screen>
      <PageHeader
        title="Weekly planner"
        subtitle={`${shortDayLabel(dates[0]!)} – ${shortDayLabel(dates[6]!)}`}
        action={
          <div className="flex shrink-0 gap-1">
            <Button
              variant="secondary"
              size="icon"
              className="h-11 w-11 rounded-full"
              onClick={() => setOffset((o) => o - 1)}
              aria-label="Previous week"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="h-11 w-11 rounded-full"
              onClick={() => setOffset((o) => o + 1)}
              aria-label="Next week"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid gap-2">
        <Button size="lg" className="h-12 rounded-full text-base" onClick={generate}>
          <Sparkles className="mr-2 h-5 w-5" /> Generate this week's menu
        </Button>
        <Button asChild variant="outline" size="lg" className="h-12 rounded-full text-base">
          <Link to="/grocery" search={{ week: offset }}>
            See what to buy for this week
          </Link>
        </Button>
      </div>

      <ul className="space-y-3">
        {dates.map((iso) => {
          const day = state.plan[iso];
          const theme = WEEKDAY_THEMES[parseISODate(iso).getDay()] ?? WEEKDAY_THEMES[0]!;
          const isToday = iso === toISODate(new Date());
          return (
            <li
              key={iso}
              className={cn("surface-card p-4", isToday && "ring-2 ring-primary")}
            >
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-primary">
                    {shortDayLabel(iso)} • {theme.label}
                  </p>
                  {day ? (
                    <>
                      <p className="mt-1 font-bold leading-tight">
                        {day.recipeIds
                          .map((id) => recipesById[id]?.title ?? "Unknown")
                          .join(" + ")}
                      </p>
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Users className="h-3.5 w-3.5" /> {day.servings} plates
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">{theme.hint}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <PickDialog
                    iso={iso}
                    onPick={(id) => store.setDay(iso, [id])}
                    recipes={recipes}
                  />
                  {day ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 rounded-full"
                      aria-label="Clear day"
                      onClick={() => store.clearDay(iso)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-full"
                  onClick={() => store.setDay(iso, [suggestForDate(iso, day?.recipeIds ?? [], state.favorites)])}
                >
                  Suggest
                </Button>
                <Button
                  variant={moveFrom === iso ? "default" : "outline"}
                  size="sm"
                  className="rounded-full"
                  onClick={() => {
                    if (moveFrom && moveFrom !== iso) {
                      store.swapDays(moveFrom, iso);
                      setMoveFrom(null);
                    } else {
                      setMoveFrom(moveFrom === iso ? null : iso);
                    }
                  }}
                >
                  {moveFrom === iso ? "Pick a day to swap with" : "Swap"}
                </Button>
                {day ? (
                  <div className="flex items-center gap-1">
                    {[10, 20, 30].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => store.setServings(iso, n)}
                        className={cn(
                          "rounded-full px-3 py-1.5 text-xs font-bold",
                          day.servings === n
                            ? "bg-primary text-primary-foreground"
                            : "bg-surface-2 text-muted-foreground",
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Screen>
  );
}

function PickDialog({
  iso,
  recipes,
  onPick,
}: {
  iso: string;
  recipes: ReturnType<typeof useStore>["recipes"];
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="rounded-full">
          Choose
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] max-w-md">
        <DialogHeader>
          <DialogTitle>Pick a dinner for {shortDayLabel(iso)}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-[60vh] pr-2">
          <ul className="space-y-2">
            {recipes.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="w-full rounded-xl bg-surface-2 px-4 py-3 text-left"
                  onClick={() => {
                    onPick(r.id);
                    setOpen(false);
                  }}
                >
                  <span className="block font-semibold">{r.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {r.cuisine} • {r.prepMin + r.cookMin} min
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
