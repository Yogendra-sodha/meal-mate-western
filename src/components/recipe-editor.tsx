import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { RecipeImportPanel } from "@/components/recipe-import-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORIES, CUISINES } from "@/lib/types";
import type { Category, Cuisine, Ingredient, Recipe } from "@/lib/types";

function blankRecipe(): Recipe {
  return {
    id: "",
    title: "",
    cuisine: "Gujarati",
    description: "",
    sourceName: "Home kitchen",
    sourceUrl: "",
    videoUrl: "",
    prepMin: 30,
    cookMin: 45,
    baseServings: 20,
    ingredients: [{ name: "", qty: 1, unit: "kg", category: "vegetables" }],
    prepSteps: [],
    cookSteps: [],
    tags: [],
  };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || `recipe-${Date.now()}`;

export function RecipeEditor({
  open,
  onOpenChange,
  recipe,
  onSave,
  mode,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recipe?: Recipe | undefined;
  onSave: (recipe: Recipe) => void;
  mode: "edit" | "create";
}) {
  const [draft, setDraft] = useState<Recipe>(recipe ? { ...recipe } : blankRecipe());

  const set = <K extends keyof Recipe>(key: K, value: Recipe[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const setIngredient = (i: number, patch: Partial<Ingredient>) =>
    setDraft((d) => ({
      ...d,
      ingredients: d.ingredients.map((ing, idx) => (idx === i ? { ...ing, ...patch } : ing)),
    }));

  const save = () => {
    if (!draft.title.trim()) {
      toast.error("Give the dish a name");
      return;
    }
    const cleaned: Recipe = {
      ...draft,
      id: draft.id || slug(draft.title),
      ingredients: draft.ingredients.filter((i) => i.name.trim()),
    };
    onSave(cleaned);
    onOpenChange(false);
    toast.success(mode === "create" ? "Recipe added" : "Recipe updated");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto rounded-3xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add a recipe" : "Edit recipe"}</DialogTitle>
          <DialogDescription>
            Update quantities whenever a batch was not enough — the change is saved with a timestamp.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {mode === "create" ? (
            <RecipeImportPanel
              plates={draft.baseServings}
              onPlatesChange={(n) => set("baseServings", n)}
              onImported={(imported) => setDraft(imported)}
            />
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="re-title">Dish name</Label>
            <Input
              id="re-title"
              value={draft.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Paneer bhurji"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="re-desc">Description</Label>
            <Textarea
              id="re-desc"
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              rows={2}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="re-video">YouTube video link</Label>
            <Input
              id="re-video"
              value={draft.videoUrl ?? ""}
              onChange={(e) => set("videoUrl", e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="re-prep">Prep (min)</Label>
              <Input
                id="re-prep"
                type="number"
                inputMode="numeric"
                value={draft.prepMin}
                onChange={(e) => set("prepMin", Number(e.target.value) || 0)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="re-cook">Cook (min)</Label>
              <Input
                id="re-cook"
                type="number"
                inputMode="numeric"
                value={draft.cookMin}
                onChange={(e) => set("cookMin", Number(e.target.value) || 0)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="re-plates">Plates</Label>
              <Input
                id="re-plates"
                type="number"
                inputMode="numeric"
                value={draft.baseServings}
                onChange={(e) => set("baseServings", Number(e.target.value) || 1)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="re-cuisine">Cuisine</Label>
            <select
              id="re-cuisine"
              value={draft.cuisine}
              onChange={(e) => set("cuisine", e.target.value as Cuisine)}
              className="h-11 rounded-xl border border-border bg-background px-3 text-sm"
            >
              {CUISINES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label>Ingredients for {draft.baseServings} plates</Label>
            {draft.ingredients.map((ing, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_auto] gap-1.5">
                <Input
                  aria-label="Ingredient name"
                  value={ing.name}
                  onChange={(e) => setIngredient(i, { name: e.target.value })}
                  placeholder="Tomato"
                />
                <Input
                  aria-label="Quantity"
                  type="number"
                  inputMode="decimal"
                  value={ing.qty}
                  onChange={(e) => setIngredient(i, { qty: Number(e.target.value) || 0 })}
                />
                <Input
                  aria-label="Unit"
                  value={ing.unit}
                  onChange={(e) => setIngredient(i, { unit: e.target.value })}
                />
                <div className="flex items-center gap-1">
                  <select
                    aria-label="Category"
                    value={ing.category}
                    onChange={(e) => setIngredient(i, { category: e.target.value as Category })}
                    className="h-11 w-16 rounded-xl border border-border bg-background px-1 text-xs"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.emoji}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${ing.name || "ingredient"}`}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        ingredients: d.ingredients.filter((_, idx) => idx !== i),
                      }))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  ingredients: [
                    ...d.ingredients,
                    { name: "", qty: 1, unit: "kg", category: "vegetables" },
                  ],
                }))
              }
            >
              <Plus className="mr-1 h-4 w-4" /> Add ingredient
            </Button>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="re-prepsteps">Preparation steps (one per line)</Label>
            <Textarea
              id="re-prepsteps"
              rows={4}
              value={draft.prepSteps.join("\n")}
              onChange={(e) =>
                set("prepSteps", e.target.value.split("\n").filter((s) => s.trim()))
              }
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="re-cooksteps">Cooking steps (one per line)</Label>
            <Textarea
              id="re-cooksteps"
              rows={5}
              value={draft.cookSteps.join("\n")}
              onChange={(e) =>
                set("cookSteps", e.target.value.split("\n").filter((s) => s.trim()))
              }
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="rounded-full" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="rounded-full" onClick={save}>
            {mode === "create" ? "Add recipe" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
