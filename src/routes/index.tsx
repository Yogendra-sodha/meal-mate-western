import { createFileRoute, Link } from "@tanstack/react-router";
import { BarChart3, CheckCircle2, Clock, RefreshCw, Users, Utensils } from "lucide-react";
import { useEffect, useMemo } from "react";

import { PageHeader, Screen } from "@/components/app-shell";
import { DailyVat } from "@/components/daily-vat";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  buildGroceryList,
  dayLabel,
  formatQty,
  suggestForDate,
  toISODate,
  WEEKDAY_THEMES,
  parseISODate,
} from "@/lib/planning";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tonight's Dinner — Bachelor Dinner Planner" },
      {
        name: "description",
        content:
          "Plan tonight's pure-veg, no onion no garlic dinner for 20 plates: menu, groceries, prep tasks and who cooks what.",
      },
      { property: "og:title", content: "Tonight's Dinner — Bachelor Dinner Planner" },
      {
        property: "og:description",
        content: "Dinner, groceries and kitchen tasks for a household of 10 roommates.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const store = useStore();
  const { state, recipesById, hydrated } = store;
  const today = toISODate(new Date());
  const day = state.plan[today];
  const theme = WEEKDAY_THEMES[parseISODate(today).getDay()] ?? WEEKDAY_THEMES[0]!;

  useEffect(() => {
    if (hydrated && day) store.ensureTasks(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, day?.recipeIds.join(","), today]);

  const tasks = state.tasks.filter((t) => t.date === today);
  const prep = tasks.filter((t) => t.kind === "prep");
  const cook = tasks.filter((t) => t.kind === "cook");
  const doneCount = tasks.filter((t) => t.done).length;
  const pct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;

  const groceries = useMemo(
    () => buildGroceryList([today], state, recipesById).filter((l) => l.needed > 0),
    [today, state, recipesById],
  );

  const recipes = (day?.recipeIds ?? []).map((id) => recipesById[id]).filter(Boolean);
  const totalTime = recipes.reduce((sum, r) => sum + (r?.prepMin ?? 0) + (r?.cookMin ?? 0), 0);

  return (
    <Screen>
      <PageHeader
        title={`${dayLabel(today)} dinner`}
        subtitle={theme.label + " • " + theme.hint}
        action={<ThemeToggle />}
      />

      <DailyVat />

      {!day ? (
        <div className="surface-card p-6 text-center">
          <Utensils className="mx-auto h-8 w-8 text-primary" />
          <h2 className="mt-3 text-lg font-bold">Nothing planned yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {theme.hint}. Pick a dish or let the planner suggest one.
          </p>
          <div className="mt-4 grid gap-2">
            <Button
              size="lg"
              className="h-12 rounded-full text-base"
              onClick={() =>
                store.setDay(today, [suggestForDate(today, [], state.favorites)])
              }
            >
              Suggest tonight's dinner
            </Button>
            <Button asChild variant="outline" size="lg" className="h-12 rounded-full text-base">
              <Link to="/planner">Plan the whole week</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <section className="surface-card overflow-hidden">
            <div className="bg-primary-container px-5 py-4 text-primary-container-foreground">
              <p className="text-xs font-bold uppercase tracking-wide opacity-80">On the menu</p>
              <h2 className="mt-1 text-xl font-bold leading-tight">
                {recipes.map((r) => r!.title).join(" + ")}
              </h2>
              <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
                <span className="inline-flex items-center gap-1">
                  <Users className="h-4 w-4" /> {day.servings} plates
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-4 w-4" /> ~{totalTime} min
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 p-4">
              {recipes.map((r) => (
                <Button key={r!.id} asChild variant="secondary" className="rounded-full">
                  <Link to="/recipes/$recipeId" params={{ recipeId: r!.id }}>
                    Open {r!.title.split(" ")[0]}
                  </Link>
                </Button>
              ))}
              <Button
                variant="outline"
                className="rounded-full"
                onClick={() =>
                  store.setDay(today, [
                    suggestForDate(today, day.recipeIds, state.favorites),
                  ])
                }
              >
                <RefreshCw className="mr-1 h-4 w-4" /> Swap
              </Button>
              <Button
                variant={day.cooked ? "default" : "outline"}
                className="rounded-full"
                onClick={() => store.markCooked(today)}
              >
                <CheckCircle2 className="mr-1 h-4 w-4" />
                {day.cooked ? "Cooked" : "Mark cooked"}
              </Button>
            </div>
          </section>

          <section className="surface-card p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-bold">Kitchen progress</h3>
              <span className="text-sm font-semibold text-muted-foreground">
                {doneCount}/{tasks.length}
              </span>
            </div>
            <Progress value={pct} className="mt-3 h-2.5" />
            <div className="mt-4 space-y-4">
              <TaskGroup title="Preparation" tasks={prep} />
              <TaskGroup title="Cooking" tasks={cook} />
              <TaskGroup title="Chores" tasks={tasks.filter((t) => t.kind === "chore")} />
            </div>
            <Button
              variant="secondary"
              className="mt-4 h-11 w-full rounded-full"
              onClick={() => store.autoAssign(today)}
            >
              Auto-assign tasks to roommates
            </Button>
          </section>

          <section className="surface-card p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-bold">Buy today</h3>
              <Link to="/grocery" search={{ week: 0 }} className="text-sm font-semibold text-primary">
                Full list
              </Link>
            </div>
            {groceries.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Everything needed is already in the pantry.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {groceries.slice(0, 8).map((line) => (
                  <li key={line.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">{line.name}</span>
                    <span className="shrink-0 font-semibold text-muted-foreground">
                      {formatQty(line.needed, line.unit)}
                    </span>
                  </li>
                ))}
                {groceries.length > 8 ? (
                  <li className="text-sm text-muted-foreground">
                    +{groceries.length - 8} more items
                  </li>
                ) : null}
              </ul>
            )}
          </section>

          <Button asChild variant="ghost" className="h-12 w-full rounded-full">
            <Link to="/stats">
              <BarChart3 className="mr-2 h-4 w-4" /> Meal statistics
            </Link>
          </Button>
        </div>
      )}
    </Screen>
  );
}

function TaskGroup({ title, tasks }: { title: string; tasks: ReturnType<typeof useStore>["state"]["tasks"] }) {
  const store = useStore();
  if (!tasks.length) return null;
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {tasks.map((t) => {
          const person = store.state.people.find((p) => p.id === t.assignee);
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => store.toggleTask(t.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
                  t.done ? "bg-accent text-accent-foreground" : "bg-surface-2",
                )}
              >
                <CheckCircle2
                  className={cn("mt-0.5 h-5 w-5 shrink-0", t.done ? "opacity-100" : "opacity-30")}
                />
                <span className="min-w-0 flex-1">
                  <span className={cn("block", t.done && "line-through opacity-70")}>{t.label}</span>
                  {person ? (
                    <span className="text-xs font-semibold text-muted-foreground">{person.name}</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
