import { createFileRoute } from "@tanstack/react-router";

import { PageHeader, Screen } from "@/components/app-shell";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/stats")({
  head: () => ({
    meta: [
      { title: "Meal Statistics — Bachelor Dinner Planner" },
      {
        name: "description",
        content: "See most and least cooked dishes, favourite cuisines and cooking frequency.",
      },
      { property: "og:title", content: "Meal Statistics" },
      { property: "og:description", content: "What the household actually cooks, over time." },
    ],
  }),
  component: Stats,
});

function Stats() {
  const { state, recipesById, recipes } = useStore();
  const counts = new Map<string, number>();
  state.cookLog.forEach((c) => counts.set(c.recipeId, (counts.get(c.recipeId) ?? 0) + 1));

  const ranked = recipes
    .map((r) => ({ recipe: r, count: counts.get(r.id) ?? 0 }))
    .sort((a, b) => b.count - a.count);
  const cuisineCounts = new Map<string, number>();
  state.cookLog.forEach((c) => {
    const cuisine = recipesById[c.recipeId]?.cuisine;
    if (cuisine) cuisineCounts.set(cuisine, (cuisineCounts.get(cuisine) ?? 0) + 1);
  });
  const topCuisines = [...cuisineCounts.entries()].sort((a, b) => b[1] - a[1]);
  const max = ranked[0]?.count ?? 0;

  return (
    <Screen>
      <PageHeader title="Statistics" subtitle={`${state.cookLog.length} dinners cooked so far`} />

      <section className="surface-card mb-4 p-4">
        <h2 className="font-bold">Most cooked</h2>
        <ul className="mt-3 space-y-2">
          {ranked.slice(0, 5).map(({ recipe, count }) => (
            <li key={recipe.id}>
              <div className="flex items-center justify-between gap-3 text-sm font-semibold">
                <span className="min-w-0 truncate">{recipe.title}</span>
                <span className="shrink-0 text-muted-foreground">{count}×</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${max ? (count / max) * 100 : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="surface-card mb-4 p-4">
        <h2 className="font-bold">Least cooked</h2>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          {ranked
            .slice(-5)
            .reverse()
            .map(({ recipe, count }) => (
              <li key={recipe.id} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{recipe.title}</span>
                <span className="shrink-0">{count}×</span>
              </li>
            ))}
        </ul>
      </section>

      <section className="surface-card p-4">
        <h2 className="font-bold">Favourite cuisines</h2>
        {topCuisines.length ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {topCuisines.map(([cuisine, count]) => (
              <li
                key={cuisine}
                className="rounded-full bg-primary-container px-3 py-1.5 text-sm font-bold text-primary-container-foreground"
              >
                {cuisine} · {count}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Mark dinners as cooked on the dashboard to build up statistics.
          </p>
        )}
      </section>
    </Screen>
  );
}
