import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  ArrowLeft,
  ExternalLink,
  Heart,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Star,
  Trash2,
  Youtube,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Screen } from "@/components/app-shell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { RecipeEditor } from "@/components/recipe-editor";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatQty,
  formatUpdatedAt,
  scaleIngredient,
  toISODate,
  youtubeLink,
} from "@/lib/planning";
import { useStore } from "@/lib/store";
import { CATEGORIES } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/recipes/$recipeId")({
  head: () => ({
    meta: [
      { title: "Recipe — Bachelor Dinner Planner" },
      {
        name: "description",
        content:
          "Shopping list, preparation steps and cooking instructions scaled for 20 plates, without onion or garlic.",
      },
      { property: "og:title", content: "Recipe — Bachelor Dinner Planner" },
      {
        property: "og:description",
        content: "Shopping, preparation and cooking in three clear sections.",
      },
    ],
  }),
  component: RecipeDetail,
});

function RecipeDetail() {
  const { recipeId } = Route.useParams();
  const store = useStore();
  const recipe = store.recipesById[recipeId];
  const archived = store.state.archived.includes(recipeId);
  const [servings, setServings] = useState(20);
  const [editing, setEditing] = useState(false);

  if (!recipe) {
    return (
      <Screen>
        <div className="surface-card mt-10 p-6 text-center">
          <p className="font-bold">Recipe not found</p>
          <Button asChild className="mt-4 rounded-full">
            <Link to="/recipes">Back to recipes</Link>
          </Button>
        </div>
      </Screen>
    );
  }

  const fav = store.state.favorites.includes(recipe.id);
  const rating = store.state.ratings[recipe.id] ?? 0;
  const ingredients = recipe.ingredients.map((i) =>
    scaleIngredient(i, servings, recipe.baseServings),
  );
  const updated = formatUpdatedAt(recipe.updatedAt);

  return (
    <Screen>
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-1 px-1 pt-5 pb-3">
        <Button asChild variant="ghost" size="icon" className="h-11 w-11 rounded-full">
          <Link to="/recipes" aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <p className="truncate text-sm font-bold uppercase tracking-wide text-primary">
          {recipe.cuisine}
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 rounded-full"
          aria-label="Edit recipe"
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 rounded-full"
          aria-label="Toggle favourite"
          onClick={() => store.toggleFavorite(recipe.id)}
        >
          <Heart className={cn("h-5 w-5", fav && "fill-secondary text-secondary")} />
        </Button>
      </header>

      {archived ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3">
          <p className="min-w-0 text-sm">
            <span className="font-bold">Deleted</span>
            <span className="block text-xs text-muted-foreground">
              Kept here, but never suggested or offered when planning.
            </span>
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0 rounded-full"
            onClick={() => {
              store.restoreRecipe(recipe.id);
              toast.success(`${recipe.title} is back in the list`);
            }}
          >
            <RotateCcw className="mr-1 h-4 w-4" /> Restore
          </Button>
        </div>
      ) : null}

      <h1 className="text-2xl font-bold leading-tight">{recipe.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {recipe.description}{" "}
        <a
          href={youtubeLink(recipe)}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 font-semibold text-primary underline underline-offset-2"
        >
          <Youtube className="h-4 w-4" /> Watch on YouTube
        </a>
      </p>

      {updated ? (
        <p className="mt-2 text-xs font-semibold text-muted-foreground">Last updated {updated}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-muted-foreground">
        <span>Prep {recipe.prepMin}m</span>
        <span>•</span>
        <span>Cook {recipe.cookMin}m</span>
      </div>

      {editing ? (
        <RecipeEditor
          key={recipe.updatedAt ?? recipe.id}
          mode="edit"
          open={editing}
          onOpenChange={setEditing}
          recipe={recipe}
          onSave={(next) => store.updateRecipe(recipe.id, next)}
        />
      ) : null}


      <div className="mt-4 flex flex-wrap gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`Rate ${n}`}
            onClick={() => store.rate(recipe.id, n)}
          >
            <Star className={cn("h-6 w-6", n <= rating ? "fill-primary text-primary" : "text-muted-foreground")} />
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-primary-container px-4 py-3 text-primary-container-foreground">
        <span className="text-sm font-bold">Plates</span>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="icon"
            className="h-10 w-10 rounded-full"
            aria-label="Fewer plates"
            onClick={() => setServings((s) => Math.max(2, s - 2))}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <span className="w-10 text-center text-lg font-bold">{servings}</span>
          <Button
            variant="secondary"
            size="icon"
            className="h-10 w-10 rounded-full"
            aria-label="More plates"
            onClick={() => setServings((s) => s + 2)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Tabs defaultValue="shopping" className="mt-5">
        <TabsList className="grid h-12 w-full grid-cols-3 rounded-full">
          <TabsTrigger value="shopping" className="rounded-full">
            Shopping
          </TabsTrigger>
          <TabsTrigger value="prep" className="rounded-full">
            Prep
          </TabsTrigger>
          <TabsTrigger value="cook" className="rounded-full">
            Cook
          </TabsTrigger>
        </TabsList>

        <TabsContent value="shopping" className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3">
            <p className="text-sm font-semibold text-muted-foreground">
              Tap + to send an item to the grocery cart
            </p>
            <Button
              size="sm"
              className="rounded-full"
              onClick={() => {
                ingredients.forEach((i) =>
                  store.addToCart({
                    name: i.name,
                    qty: Math.round(i.qty * 100) / 100,
                    unit: i.unit,
                    category: i.category,
                    recipeTitle: recipe.title,
                  }),
                );
                toast.success(`All items added for ${recipe.title}`);
              }}
            >
              Add all
            </Button>
          </div>
          {CATEGORIES.map(({ id, label, emoji }) => {
            const items = ingredients.filter((i) => i.category === id);
            if (!items.length) return null;
            return (
              <section key={id} className="surface-card overflow-hidden">
                <h2 className="bg-surface-2 px-4 py-2.5 text-sm font-bold">
                  {emoji} {label}
                </h2>
                <ul>
                  {items.map((i) => (
                    <li
                      key={i.name}
                      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-0"
                    >
                      <span className="min-w-0 truncate">
                        {i.name}
                        {i.staple ? (
                          <span className="ml-2 text-xs text-muted-foreground">pantry staple</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 font-bold text-primary">
                        {formatQty(i.qty, i.unit)}
                      </span>
                      <Button
                        variant="secondary"
                        size="icon"
                        className="h-9 w-9 shrink-0 rounded-full"
                        aria-label={`Add ${i.name} to grocery cart`}
                        onClick={() => {
                          store.addToCart({
                            name: i.name,
                            qty: Math.round(i.qty * 100) / 100,
                            unit: i.unit,
                            category: i.category,
                            recipeTitle: recipe.title,
                          });
                          toast.success(
                            `${i.name} ${formatQty(i.qty, i.unit)} added for ${recipe.title}`,
                          );
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>

            );
          })}
        </TabsContent>

        <TabsContent value="prep" className="mt-4">
          <StepList steps={recipe.prepSteps} />
        </TabsContent>
        <TabsContent value="cook" className="mt-4">
          <StepList steps={recipe.cookSteps} />
        </TabsContent>
      </Tabs>

      <div className="mt-6 grid gap-2">
        <Button
          size="lg"
          className="h-12 rounded-full text-base"
          onClick={() => store.setDay(toISODate(new Date()), [recipe.id], servings)}
        >
          Cook this tonight
        </Button>
        <Button asChild variant="outline" size="lg" className="h-12 rounded-full text-base">
          <a href={recipe.sourceUrl} target="_blank" rel="noreferrer noopener">
            <ExternalLink className="mr-2 h-4 w-4" /> Original recipe on {recipe.sourceName}
          </a>
        </Button>

        {/* At the bottom and behind a confirm: destructive, and easy to hit by
            accident anywhere nearer the top. */}
        {archived ? null : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="lg" className="h-12 rounded-full text-base">
                <Trash2 className="mr-2 h-4 w-4" /> Delete this recipe
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="rounded-3xl">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {recipe.title}?</AlertDialogTitle>
                <AlertDialogDescription>
                  It moves to Deleted rather than being destroyed: it stops being suggested and
                  stops appearing when picking a dish, and days already planned with it keep
                  working. You can put it back at any time.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="rounded-full">Keep it</AlertDialogCancel>
                <AlertDialogAction
                  className="rounded-full"
                  onClick={() => {
                    store.archiveRecipe(recipe.id);
                    toast(`${recipe.title} moved to Deleted`, {
                      action: { label: "Undo", onClick: () => store.restoreRecipe(recipe.id) },
                    });
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </Screen>
  );
}

function StepList({ steps }: { steps: string[] }) {
  const [done, setDone] = useState<number[]>([]);
  return (
    <ol className="space-y-2">
      {steps.map((step, i) => {
        const checked = done.includes(i);
        return (
          <li key={step}>
            <button
              type="button"
              onClick={() => setDone((d) => (checked ? d.filter((x) => x !== i) : [...d, i]))}
              className={cn(
                "flex w-full gap-3 rounded-2xl px-4 py-3 text-left",
                checked ? "bg-accent text-accent-foreground" : "bg-surface-2",
              )}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                {i + 1}
              </span>
              <span className={cn("min-w-0 flex-1 text-sm", checked && "line-through opacity-70")}>
                {step}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export { notFound };
