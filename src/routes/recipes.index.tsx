import { createFileRoute, Link } from "@tanstack/react-router";
import { Heart, Plus, Search, Sparkles, Star } from "lucide-react";
import { useMemo, useState } from "react";

import { PageHeader, Screen } from "@/components/app-shell";
import { EditedBy } from "@/components/edited-by";
import { PasteRecipeDialog } from "@/components/paste-recipe-dialog";
import { RecipeEditor } from "@/components/recipe-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatUpdatedAt } from "@/lib/planning";
import { useStore } from "@/lib/store";
import { CUISINES, type Recipe } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/recipes/")({
  head: () => ({
    meta: [
      { title: "Recipe Library — Bachelor Dinner Planner" },
      {
        name: "description",
        content:
          "Pure vegetarian, no onion no garlic recipes for 20 plates across Gujarati, Punjabi, South Indian, Chinese, chaat, Mexican and Italian.",
      },
      { property: "og:title", content: "Recipe Library" },
      {
        property: "og:description",
        content: "Search, rate and favourite no onion no garlic recipes scaled for 10 roommates.",
      },
    ],
  }),
  component: RecipeList,
});

function RecipeList() {
  const store = useStore();
  const [q, setQ] = useState("");
  const [cuisine, setCuisine] = useState<string | null>(null);
  const [favOnly, setFavOnly] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pasting, setPasting] = useState(false);
  // A parsed import lands here and opens the editor, so it is reviewed and
  // saved exactly like a recipe typed by hand.
  const [imported, setImported] = useState<Recipe | null>(null);

  const list = useMemo(
    () =>
      store.recipes.filter((r) => {
        if (favOnly && !store.state.favorites.includes(r.id)) return false;
        if (cuisine && r.cuisine !== cuisine) return false;
        if (q && !`${r.title} ${r.description} ${r.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase()))
          return false;
        return true;
      }),
    [store.recipes, store.state.favorites, q, cuisine, favOnly],
  );

  return (
    <Screen>
      <PageHeader
        title="Recipes"
        subtitle={`${list.length} pure-veg dishes, no onion or garlic`}
        action={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="icon"
              className="h-11 w-11 rounded-full"
              onClick={() => setPasting(true)}
              aria-label="Paste a recipe"
            >
              <Sparkles className="h-5 w-5" />
            </Button>
            <Button className="h-11 rounded-full" onClick={() => setCreating(true)}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </div>
        }
      />

      {creating ? (
        <RecipeEditor
          mode="create"
          open={creating}
          onOpenChange={setCreating}
          onSave={(r) => store.addRecipe(r)}
        />
      ) : null}

      <PasteRecipeDialog
        open={pasting}
        onOpenChange={setPasting}
        onParsed={(r) => {
          setPasting(false);
          setImported(r);
        }}
      />

      {imported ? (
        <RecipeEditor
          mode="create"
          open
          onOpenChange={(v) => {
            if (!v) setImported(null);
          }}
          recipe={imported}
          onSave={(r) => store.addRecipe(r)}
        />
      ) : null}

      <div className="relative mb-3">
        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search dishes..."
          className="h-12 rounded-full pl-11"
        />
      </div>

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={favOnly} onClick={() => setFavOnly((v) => !v)}>
          ♥ Favourites
        </Chip>
        <Chip active={!cuisine} onClick={() => setCuisine(null)}>
          All
        </Chip>
        {CUISINES.map((c) => (
          <Chip key={c} active={cuisine === c} onClick={() => setCuisine(c)}>
            {c}
          </Chip>
        ))}
      </div>

      <ul className="space-y-3">
        {list.map((r) => {
          const fav = store.state.favorites.includes(r.id);
          const rating = store.state.ratings[r.id] ?? 0;
          return (
            <li key={r.id} className="surface-card p-4">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                <Link
                  to="/recipes/$recipeId"
                  params={{ recipeId: r.id }}
                  className="min-w-0"
                >
                  <p className="text-xs font-bold uppercase tracking-wide text-primary">{r.cuisine}</p>
                  <h2 className="mt-0.5 font-bold leading-tight">{r.title}</h2>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{r.description}</p>
                  <p className="mt-2 text-xs font-semibold text-muted-foreground">
                    Prep {r.prepMin}m • Cook {r.cookMin}m • {r.baseServings} plates
                    {rating ? ` • ${"★".repeat(rating)}` : ""}
                  </p>
                  {formatUpdatedAt(r.updatedAt) ? (
                    <p className="mt-1 text-xs font-semibold text-primary">
                      Updated {formatUpdatedAt(r.updatedAt)}
                    </p>
                  ) : null}
                  <EditedBy userId={r.updatedBy} className="mt-0.5 block" />
                </Link>
                <button
                  type="button"
                  aria-label="Toggle favourite"
                  onClick={() => store.toggleFavorite(r.id)}
                  className="grid h-11 w-11 shrink-0 place-items-center self-start rounded-full bg-surface-2"
                >
                  <Heart className={cn("h-5 w-5", fav ? "fill-secondary text-secondary" : "text-muted-foreground")} />
                </button>
              </div>
            </li>
          );
        })}
        {!list.length ? (
          <li className="surface-card p-6 text-center text-sm text-muted-foreground">
            No recipes match. Try a different filter.
          </li>
        ) : null}
      </ul>

      <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
        <Star className="h-3.5 w-3.5" /> Recipes link to free public sites — no paid APIs used.
      </p>
    </Screen>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-4 py-2 text-sm font-bold",
        active ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}
