import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { RECIPES } from "@/data/recipes";
import type { AppState, CartItem, InventoryItem, Recipe, Task } from "@/lib/types";

const STORAGE_KEY = "bdp.state.v1";

const DEFAULT_PEOPLE = [
  "Amit",
  "Bhavesh",
  "Chirag",
  "Dhruv",
  "Harsh",
  "Jay",
  "Kunal",
  "Mehul",
  "Nirav",
  "Parth",
].map((name, i) => ({ id: `p${i + 1}`, name }));

const DEFAULT_INVENTORY: InventoryItem[] = [
  { id: "i1", name: "Rice", category: "grains", qty: 5, unit: "kg", recurring: true },
  { id: "i2", name: "Whole wheat flour", category: "grains", qty: 10, unit: "kg", recurring: true },
  { id: "i3", name: "Cooking oil", category: "pantry", qty: 5, unit: "ml", recurring: true },
  { id: "i4", name: "Salt", category: "spices", qty: 1000, unit: "g", recurring: true },
  { id: "i5", name: "Turmeric", category: "spices", qty: 200, unit: "g", recurring: true },
  { id: "i6", name: "Cumin seeds", category: "spices", qty: 250, unit: "g", recurring: true },
  { id: "i7", name: "Mustard seeds", category: "spices", qty: 200, unit: "g", recurring: true },
  { id: "i8", name: "Ghee", category: "dairy", qty: 1000, unit: "g", recurring: true },
];

export const initialState: AppState = {
  plan: {},
  tasks: [],
  people: DEFAULT_PEOPLE,
  inventory: DEFAULT_INVENTORY,
  favorites: ["kadhi-khichdi", "paneer-butter-masala"],
  ratings: {},
  purchased: {},
  customRecipes: [],
  recipeEdits: {},
  cart: [],
  cookLog: [],
  defaultServings: 20,
};

interface StoreValue {
  state: AppState;
  hydrated: boolean;
  update: (fn: (draft: AppState) => AppState) => void;
  recipes: Recipe[];
  recipesById: Record<string, Recipe>;
  toggleFavorite: (id: string) => void;
  rate: (id: string, value: number) => void;
  setDay: (date: string, recipeIds: string[], servings?: number) => void;
  clearDay: (date: string) => void;
  setServings: (date: string, servings: number) => void;
  swapDays: (a: string, b: string) => void;
  markCooked: (date: string) => void;
  togglePurchased: (key: string) => void;
  clearPurchased: () => void;
  ensureTasks: (date: string) => void;
  toggleTask: (id: string) => void;
  assignTask: (id: string, assignee?: string) => void;
  autoAssign: (date: string) => void;
  addTask: (task: Omit<Task, "id" | "done">) => void;
  removeTask: (id: string) => void;
  upsertInventory: (item: InventoryItem) => void;
  removeInventory: (id: string) => void;
  addPerson: (name: string) => void;
  removePerson: (id: string) => void;
  addRecipe: (recipe: Recipe) => void;
  updateRecipe: (id: string, patch: Partial<Recipe>) => void;
  resetRecipe: (id: string) => void;
  addToCart: (item: Omit<CartItem, "id" | "done" | "addedAt">) => void;
  toggleCartItem: (id: string) => void;
  removeCartItem: (id: string) => void;
  clearCart: () => void;
  reset: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState({ ...initialState, ...(JSON.parse(raw) as AppState) });
    } catch {
      /* ignore corrupt state */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota */
    }
  }, [state, hydrated]);

  const update = useCallback((fn: (draft: AppState) => AppState) => {
    setState((prev) => fn(structuredClone(prev)));
  }, []);

  const recipes = useMemo(
    () =>
      [...RECIPES, ...state.customRecipes].map((r) => {
        const patch = state.recipeEdits[r.id];
        return patch ? ({ ...r, ...patch } as Recipe) : r;
      }),
    [state.customRecipes, state.recipeEdits],
  );
  const recipesById = useMemo(
    () => Object.fromEntries(recipes.map((r) => [r.id, r])),
    [recipes],
  );


  const value = useMemo<StoreValue>(() => {
    const buildTasksFor = (date: string, draft: AppState): Task[] => {
      const day = draft.plan[date];
      if (!day) return [];
      const tasks: Task[] = [];
      day.recipeIds.forEach((rid) => {
        const recipe = recipesById[rid];
        if (!recipe) return;
        recipe.prepSteps.forEach((label, i) =>
          tasks.push({ id: `${date}-${rid}-prep-${i}`, date, recipeId: rid, kind: "prep", label, done: false }),
        );
        recipe.cookSteps.forEach((label, i) =>
          tasks.push({ id: `${date}-${rid}-cook-${i}`, date, recipeId: rid, kind: "cook", label, done: false }),
        );
      });
      tasks.push(
        { id: `${date}-chore-lunch`, date, kind: "chore", label: "Pack 10 lunch boxes for tomorrow", done: false },
        { id: `${date}-chore-dishes`, date, kind: "chore", label: "Wash dishes & clean kitchen", done: false },
        { id: `${date}-chore-table`, date, kind: "chore", label: "Set the table, water, salad & papad", done: false },
      );
      return tasks;
    };

    return {
      state,
      hydrated,
      recipes,
      recipesById,
      update,
      toggleFavorite: (id) =>
        update((d) => {
          d.favorites = d.favorites.includes(id)
            ? d.favorites.filter((f) => f !== id)
            : [...d.favorites, id];
          return d;
        }),
      rate: (id, value) =>
        update((d) => {
          d.ratings[id] = value;
          return d;
        }),
      setDay: (date, recipeIds, servings) =>
        update((d) => {
          const prev = d.plan[date];
          d.plan[date] = {
            date,
            recipeIds,
            servings: servings ?? prev?.servings ?? d.defaultServings,
            ...(prev?.note !== undefined ? { note: prev.note } : {}),
            ...(prev?.cooked !== undefined ? { cooked: prev.cooked } : {}),
          };
          d.tasks = d.tasks.filter((t) => t.date !== date);
          return d;
        }),
      clearDay: (date) =>
        update((d) => {
          delete d.plan[date];
          d.tasks = d.tasks.filter((t) => t.date !== date);
          return d;
        }),
      setServings: (date, servings) =>
        update((d) => {
          if (d.plan[date]) d.plan[date].servings = servings;
          return d;
        }),
      swapDays: (a, b) =>
        update((d) => {
          const pa = d.plan[a];
          const pb = d.plan[b];
          if (pb) d.plan[a] = { ...pb, date: a };
          else delete d.plan[a];
          if (pa) d.plan[b] = { ...pa, date: b };
          else delete d.plan[b];
          d.tasks = d.tasks.filter((t) => t.date !== a && t.date !== b);
          return d;
        }),
      markCooked: (date) =>
        update((d) => {
          const day = d.plan[date];
          if (!day) return d;
          day.cooked = !day.cooked;
          if (day.cooked) {
            day.recipeIds.forEach((rid) => d.cookLog.push({ date, recipeId: rid }));
          } else {
            d.cookLog = d.cookLog.filter((c) => c.date !== date);
          }
          return d;
        }),
      togglePurchased: (key) =>
        update((d) => {
          d.purchased[key] = !d.purchased[key];
          return d;
        }),
      clearPurchased: () =>
        update((d) => {
          d.purchased = {};
          return d;
        }),
      ensureTasks: (date) =>
        update((d) => {
          if (d.tasks.some((t) => t.date === date)) return d;
          d.tasks = [...d.tasks, ...buildTasksFor(date, d)];
          return d;
        }),
      toggleTask: (id) =>
        update((d) => {
          const t = d.tasks.find((x) => x.id === id);
          if (t) t.done = !t.done;
          return d;
        }),
      assignTask: (id, assignee) =>
        update((d) => {
          const t = d.tasks.find((x) => x.id === id);
          if (t) t.assignee = assignee ?? undefined;
          return d;
        }),
      autoAssign: (date) =>
        update((d) => {
          const people = d.people;
          if (!people.length) return d;
          let i = Math.floor(Math.random() * people.length);
          d.tasks
            .filter((t) => t.date === date)
            .forEach((t) => {
              t.assignee = people[i % people.length]!.id;
              i += 1;
            });
          return d;
        }),
      addTask: (task) =>
        update((d) => {
          d.tasks.push({ ...task, id: `${task.date}-custom-${Date.now()}`, done: false });
          return d;
        }),
      removeTask: (id) =>
        update((d) => {
          d.tasks = d.tasks.filter((t) => t.id !== id);
          return d;
        }),
      upsertInventory: (item) =>
        update((d) => {
          const idx = d.inventory.findIndex((i) => i.id === item.id);
          if (idx >= 0) d.inventory[idx] = item;
          else d.inventory.push(item);
          return d;
        }),
      removeInventory: (id) =>
        update((d) => {
          d.inventory = d.inventory.filter((i) => i.id !== id);
          return d;
        }),
      addPerson: (name) =>
        update((d) => {
          d.people.push({ id: `p${Date.now()}`, name });
          return d;
        }),
      removePerson: (id) =>
        update((d) => {
          d.people = d.people.filter((p) => p.id !== id);
          d.tasks.forEach((t) => {
            if (t.assignee === id) delete t.assignee;
          });
          return d;
        }),
      addRecipe: (recipe) =>
        update((d) => {
          d.customRecipes.push(recipe);
          return d;
        }),
      reset: () => setState(initialState),
    };
  }, [state, hydrated, recipes, recipesById, update]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
