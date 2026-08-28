import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { RECIPES } from "@/data/recipes";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type {
  AppState,
  ShoppingTrip,
  CartItem,
  Category,
  Cuisine,
  InventoryItem,
  Recipe,
  Task,
} from "@/lib/types";

export const LOCAL_STORAGE_KEY = "bdp.state.v1";

const BUILTIN_IDS = new Set(RECIPES.map((r) => r.id));

/**
 * Sends a write the caller does not wait on.
 *
 * A PostgREST builder is lazy: it only issues its request once something calls
 * `then` on it. `void supabase.from(...).delete()...` therefore builds a
 * request and drops it — the screen updates, nothing reaches the server, and
 * the change is gone at the next load. Every unwaited write goes through here
 * so that it is actually sent, and a rejected one says so instead of vanishing.
 */
function send(write: PromiseLike<{ error: { message: string } | null }>, what: string) {
  void Promise.resolve(write).then(({ error }) => {
    if (!error) return;
    console.error(`[store] could not save ${what}:`, error.message);
    toast.error(`Could not save ${what}`, { id: `save-failed-${what}` });
  });
}

export const initialState: AppState = {
  plan: {},
  tasks: [],
  people: [],
  inventory: [],
  favorites: [],
  ratings: {},
  purchased: {},
  dismissed: {},
  overrides: {},
  trips: [],
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
  /** archive the finished shop and start the list over */
  finishShopping: (
    items: ShoppingTrip["items"],
    coversWeek: string,
    skipped: string[],
    details?: { store?: string | undefined; total?: number | undefined },
  ) => Promise<void>;
  /** drop an archived shop so its week's planned lines come back */
  undoShopping: (tripId: string) => Promise<void>;
  /** hide a generated grocery line; there is no row to delete, so it is flagged */
  dismissLine: (key: string) => void;
  restoreLine: (key: string) => void;
  /** pin a manual amount/unit onto a generated line */
  setLineOverride: (key: string, qty: number, unit: string) => void;
  clearLineOverride: (key: string) => void;
  updateCartItem: (id: string, patch: { qty?: number; unit?: string }) => void;
  ensureTasks: (date: string) => void;
  toggleTask: (id: string) => void;
  assignTask: (id: string, assignee?: string) => void;
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
  /** one-off import of data left over from the old offline-only version */
  importLocalData: () => Promise<number>;
  hasLocalData: boolean;
  reload: () => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

type RecipeRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  cuisine: string;
  servings: number;
  prep_min: number;
  cook_min: number;
  preparation_instructions: string[];
  cooking_instructions: string[];
  tags: string[];
  source_name: string;
  source_url: string;
  video_url: string | null;
  updated_at: string;
  updated_by: string | null;
};

function rowToRecipe(row: RecipeRow, ingredients: Recipe["ingredients"]): Recipe {
  return {
    id: row.slug,
    title: row.name,
    cuisine: row.cuisine as Cuisine,
    description: row.description,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    videoUrl: row.video_url ?? undefined,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by ?? undefined,
    prepMin: row.prep_min,
    cookMin: row.cook_min,
    baseServings: row.servings,
    ingredients,
    prepSteps: row.preparation_instructions ?? [],
    cookSteps: row.cooking_instructions ?? [],
    tags: row.tags ?? [],
  };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user, household, members } = useAuth();
  const [state, setState] = useState<AppState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [hasLocalData, setHasLocalData] = useState(false);
  const householdId = household?.id ?? null;
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      setHasLocalData(Boolean(localStorage.getItem(LOCAL_STORAGE_KEY)));
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    if (!householdId) {
      setState(initialState);
      setHydrated(false);
      return;
    }
    const [
      recipesRes,
      ingredientsRes,
      plansRes,
      planItemsRes,
      groceryRes,
      pantryRes,
      tasksRes,
      favRes,
      ratingRes,
      checksRes,
      logRes,
      tripsRes,
    ] = await Promise.all([
      supabase.from("recipes").select("*").eq("household_id", householdId),
      supabase.from("recipe_ingredients").select("*"),
      supabase.from("meal_plans").select("*").eq("household_id", householdId),
      supabase.from("meal_plan_items").select("*"),
      supabase.from("grocery_items").select("*").eq("household_id", householdId),
      supabase.from("pantry_items").select("*").eq("household_id", householdId),
      supabase.from("cooking_tasks").select("*").eq("household_id", householdId),
      supabase.from("recipe_favorites").select("*").eq("household_id", householdId),
      supabase.from("recipe_ratings").select("*").eq("household_id", householdId),
      supabase.from("grocery_checks").select("*").eq("household_id", householdId),
      supabase.from("cook_log").select("*").eq("household_id", householdId),
      // Capped: the archive is for glancing back a few weeks, and the whole
      // history would otherwise ride along on every load.
      supabase
        .from("shopping_trips")
        .select("id, done_on, covers_week, items, skipped, store, total")
        .eq("household_id", householdId)
        .order("done_on", { ascending: false })
        .limit(12),
    ]);

    const ingByRecipe = new Map<string, Recipe["ingredients"]>();
    for (const i of ingredientsRes.data ?? []) {
      const list = ingByRecipe.get(i.recipe_id) ?? [];
      list.push({
        name: i.name,
        qty: Number(i.qty),
        unit: i.unit,
        category: i.category as Category,
        staple: i.staple,
      });
      ingByRecipe.set(i.recipe_id, list);
    }

    const customRecipes: Recipe[] = [];
    const recipeEdits: Record<string, Partial<Recipe>> = {};
    for (const row of (recipesRes.data ?? []) as RecipeRow[]) {
      const recipe = rowToRecipe(row, ingByRecipe.get(row.id) ?? []);
      if (BUILTIN_IDS.has(row.slug)) recipeEdits[row.slug] = recipe;
      else customRecipes.push(recipe);
    }

    const planIdToDate = new Map<string, string>();
    const plan: AppState["plan"] = {};
    for (const p of plansRes.data ?? []) {
      planIdToDate.set(p.id, p.date);
      plan[p.date] = {
        date: p.date,
        recipeIds: [],
        servings: p.servings,
        cooked: p.cooked,
        note: p.note ?? undefined,
        updatedBy: p.updated_by ?? undefined,
      };
    }
    const items = [...(planItemsRes.data ?? [])].sort((a, b) => a.position - b.position);
    for (const it of items) {
      const date = planIdToDate.get(it.meal_plan_id);
      if (date && plan[date]) plan[date].recipeIds.push(it.recipe_ref);
    }

    const purchased: Record<string, boolean> = {};
    const dismissed: Record<string, boolean> = {};
    const overrides: AppState["overrides"] = {};
    for (const c of checksRes.data ?? []) {
      purchased[c.item_key] = c.purchased;
      dismissed[c.item_key] = c.dismissed;
      if (c.qty_override !== null && c.unit_override !== null) {
        overrides[c.item_key] = { qty: Number(c.qty_override), unit: c.unit_override };
      }
    }

    const ratings: Record<string, number> = {};
    for (const r of ratingRes.data ?? []) {
      if (r.user_id === user?.id) ratings[r.recipe_ref] = r.value;
    }

    setState({
      plan,
      tasks: (tasksRes.data ?? []).map((t) => ({
        id: t.task_key,
        date: t.date,
        recipeId: t.recipe_ref ?? undefined,
        kind: t.kind as Task["kind"],
        label: t.name,
        assignee: t.assigned_to ?? undefined,
        done: t.completed,
        updatedBy: t.updated_by ?? undefined,
      })),
      people: members.map((m) => ({ id: m.user_id, name: m.name })),
      inventory: (pantryRes.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category as Category,
        qty: Number(p.qty),
        unit: p.unit,
        recurring: p.recurring,
        updatedBy: p.updated_by ?? undefined,
      })),
      favorites: (favRes.data ?? []).map((f) => f.recipe_ref),
      ratings,
      purchased,
      dismissed,
      overrides,
      trips: (tripsRes.data ?? []).map((t) => ({
        id: t.id,
        doneOn: t.done_on,
        coversWeek: t.covers_week ?? t.done_on,
        skipped: (t.skipped ?? []) as string[],
        ...(t.store ? { store: t.store } : {}),
        ...(t.total !== null && t.total !== undefined ? { total: Number(t.total) } : {}),
        items: (t.items ?? []) as ShoppingTrip["items"],
      })),
      customRecipes,
      recipeEdits,
      cart: (groceryRes.data ?? [])
        .map((g) => ({
          id: g.id,
          name: g.name,
          qty: Number(g.qty),
          unit: g.unit,
          category: g.category as Category,
          recipeTitle: g.recipe_title ?? undefined,
          done: g.purchased,
          addedAt: g.created_at,
          assignedTo: g.assigned_to ?? undefined,
          updatedBy: g.updated_by ?? undefined,
        }))
        .sort((a, b) => a.addedAt.localeCompare(b.addedAt)),
      cookLog: (logRes.data ?? []).map((c) => ({ date: c.date, recipeId: c.recipe_ref })),
      defaultServings: household?.default_servings ?? 20,
    });
    setHydrated(true);
  }, [householdId, household?.default_servings, members, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => void load(), 250);
  }, [load]);

  // realtime: any change to household data refreshes everyone's screen
  useEffect(() => {
    if (!householdId) return;
    const tables = [
      "recipes",
      "recipe_ingredients",
      "meal_plans",
      "meal_plan_items",
      "grocery_items",
      "pantry_items",
      "cooking_tasks",
      "recipe_favorites",
      "recipe_ratings",
      "grocery_checks",
      "cook_log",
      "shopping_trips",
    ];
    const channel = supabase.channel(`household-${householdId}`);
    for (const table of tables) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () =>
        scheduleReload(),
      );
    }
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [householdId, scheduleReload]);

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
    const hid = householdId;
    const uid = user?.id ?? null;

    const saveRecipe = async (recipe: Recipe) => {
      if (!hid) return;
      const { data, error } = await supabase
        .from("recipes")
        .upsert(
          {
            household_id: hid,
            slug: recipe.id,
            name: recipe.title,
            description: recipe.description,
            cuisine: recipe.cuisine,
            servings: recipe.baseServings,
            prep_min: recipe.prepMin,
            cook_min: recipe.cookMin,
            preparation_instructions: recipe.prepSteps,
            cooking_instructions: recipe.cookSteps,
            tags: recipe.tags,
            source_name: recipe.sourceName,
            source_url: recipe.sourceUrl,
            video_url: recipe.videoUrl ?? null,
            created_by: uid,
            updated_by: uid,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "household_id,slug" },
        )
        .select("id")
        .single();
      if (error || !data) return;
      await supabase.from("recipe_ingredients").delete().eq("recipe_id", data.id);
      if (recipe.ingredients.length) {
        await supabase.from("recipe_ingredients").insert(
          recipe.ingredients.map((i, position) => ({
            recipe_id: data.id,
            name: i.name,
            qty: i.qty,
            unit: i.unit,
            category: i.category,
            staple: Boolean(i.staple),
            position,
          })),
        );
      }
    };

    const writeDay = async (date: string, recipeIds: string[], servings: number) => {
      if (!hid) return;
      const { data } = await supabase
        .from("meal_plans")
        .upsert(
          { household_id: hid, date, servings, updated_by: uid, updated_at: new Date().toISOString() },
          { onConflict: "household_id,date" },
        )
        .select("id")
        .single();
      if (!data) return;
      await supabase.from("meal_plan_items").delete().eq("meal_plan_id", data.id);
      if (recipeIds.length) {
        await supabase.from("meal_plan_items").insert(
          recipeIds.map((recipe_ref, position) => ({ meal_plan_id: data.id, recipe_ref, position })),
        );
      }
      await supabase.from("cooking_tasks").delete().eq("household_id", hid).eq("date", date);
    };

    const buildTasksFor = (date: string, plan: AppState["plan"]): Task[] => {
      const day = plan[date];
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

    const insertTasks = async (tasks: Task[]) => {
      if (!hid || !tasks.length) return;
      await supabase.from("cooking_tasks").upsert(
        tasks.map((t) => ({
          household_id: hid,
          task_key: t.id,
          date: t.date,
          recipe_ref: t.recipeId ?? null,
          kind: t.kind,
          name: t.label,
          assigned_to: t.assignee ?? null,
          completed: t.done,
          created_by: uid,
          updated_by: uid,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "household_id,task_key" },
      );
    };

    type TaskPatch = {
      assigned_to?: string | null;
      completed?: boolean;
      completed_at?: string | null;
      name?: string;
      kind?: string;
      date?: string;
      recipe_ref?: string | null;
      updated_by?: string | null;
      updated_at?: string;
    };

    /**
     * grocery_checks holds several independent flags for one line, and an
     * upsert replaces the whole row. Writing a patch on top of the current
     * local state keeps one field's write from resetting the others.
     */
    const writeCheck = async (
      key: string,
      patch: {
        purchased?: boolean;
        dismissed?: boolean;
        qty_override?: number | null;
        unit_override?: string | null;
      },
    ) => {
      if (!hid) return;
      const override = state.overrides[key];
      await supabase.from("grocery_checks").upsert(
        {
          household_id: hid,
          item_key: key,
          purchased: state.purchased[key] ?? false,
          dismissed: state.dismissed[key] ?? false,
          qty_override: override?.qty ?? null,
          unit_override: override?.unit ?? null,
          ...patch,
        },
        { onConflict: "household_id,item_key" },
      );
    };

    const patchTask = async (taskKey: string, patch: TaskPatch) => {
      if (!hid) return;
      await supabase
        .from("cooking_tasks")
        .update({ ...patch, updated_by: uid, updated_at: new Date().toISOString() })
        .eq("household_id", hid)
        .eq("task_key", taskKey);
    };

    return {
      state,
      hydrated,
      recipes,
      recipesById,
      update,
      hasLocalData,
      reload: load,
      toggleFavorite: (id) => {
        const on = state.favorites.includes(id);
        update((d) => {
          d.favorites = on ? d.favorites.filter((f) => f !== id) : [...d.favorites, id];
          return d;
        });
        if (!hid) return;
        send(
          on
            ? supabase
                .from("recipe_favorites")
                .delete()
                .eq("household_id", hid)
                .eq("recipe_ref", id)
            : supabase.from("recipe_favorites").insert({ household_id: hid, recipe_ref: id }),
          "the favourite",
        );
      },
      rate: (id, value) => {
        update((d) => {
          d.ratings[id] = value;
          return d;
        });
        if (!hid || !uid) return;
        send(
          supabase
            .from("recipe_ratings")
            .upsert(
              { household_id: hid, recipe_ref: id, user_id: uid, value },
              { onConflict: "household_id,recipe_ref,user_id" },
            ),
          "the rating",
        );
      },
      setDay: (date, recipeIds, servings) => {
        const next = servings ?? state.plan[date]?.servings ?? state.defaultServings;
        update((d) => {
          const prev = d.plan[date];
          d.plan[date] = {
            date,
            recipeIds,
            servings: next,
            ...(prev?.note !== undefined ? { note: prev.note } : {}),
            ...(prev?.cooked !== undefined ? { cooked: prev.cooked } : {}),
          };
          d.tasks = d.tasks.filter((t) => t.date !== date);
          return d;
        });
        void writeDay(date, recipeIds, next);
      },
      clearDay: (date) => {
        update((d) => {
          delete d.plan[date];
          d.tasks = d.tasks.filter((t) => t.date !== date);
          return d;
        });
        if (!hid) return;
        send(
          supabase.from("meal_plans").delete().eq("household_id", hid).eq("date", date),
          "the cleared day",
        );
        send(
          supabase.from("cooking_tasks").delete().eq("household_id", hid).eq("date", date),
          "the cleared day",
        );
      },
      setServings: (date, servings) => {
        update((d) => {
          if (d.plan[date]) d.plan[date].servings = servings;
          return d;
        });
        if (!hid) return;
        send(
          supabase
            .from("meal_plans")
            .update({ servings, updated_by: uid, updated_at: new Date().toISOString() })
            .eq("household_id", hid)
            .eq("date", date),
          "the servings",
        );
      },
      swapDays: (a, b) => {
        const pa = state.plan[a];
        const pb = state.plan[b];
        update((d) => {
          if (pb) d.plan[a] = { ...pb, date: a };
          else delete d.plan[a];
          if (pa) d.plan[b] = { ...pa, date: b };
          else delete d.plan[b];
          d.tasks = d.tasks.filter((t) => t.date !== a && t.date !== b);
          return d;
        });
        void (async () => {
          if (!hid) return;
          await supabase.from("meal_plans").delete().eq("household_id", hid).in("date", [a, b]);
          await supabase.from("cooking_tasks").delete().eq("household_id", hid).in("date", [a, b]);
          if (pb) await writeDay(a, pb.recipeIds, pb.servings);
          if (pa) await writeDay(b, pa.recipeIds, pa.servings);
        })();
      },
      markCooked: (date) => {
        const day = state.plan[date];
        if (!day) return;
        const cooked = !day.cooked;
        update((d) => {
          const target = d.plan[date];
          if (!target) return d;
          target.cooked = cooked;
          if (cooked) target.recipeIds.forEach((rid) => d.cookLog.push({ date, recipeId: rid }));
          else d.cookLog = d.cookLog.filter((c) => c.date !== date);
          return d;
        });
        if (!hid) return;
        send(
          supabase
            .from("meal_plans")
            .update({ cooked, updated_by: uid, updated_at: new Date().toISOString() })
            .eq("household_id", hid)
            .eq("date", date),
          "the cooked mark",
        );
        send(
          cooked
            ? supabase
                .from("cook_log")
                .insert(day.recipeIds.map((rid) => ({ household_id: hid, date, recipe_ref: rid })))
            : supabase.from("cook_log").delete().eq("household_id", hid).eq("date", date),
          "the cook log",
        );
      },
      togglePurchased: (key) => {
        const next = !state.purchased[key];
        update((d) => {
          d.purchased[key] = next;
          return d;
        });
        void writeCheck(key, { purchased: next });
      },
      dismissLine: (key) => {
        update((d) => {
          d.dismissed[key] = true;
          return d;
        });
        void writeCheck(key, { dismissed: true });
      },
      restoreLine: (key) => {
        update((d) => {
          d.dismissed[key] = false;
          return d;
        });
        void writeCheck(key, { dismissed: false });
      },
      setLineOverride: (key, qty, unit) => {
        update((d) => {
          d.overrides[key] = { qty, unit };
          return d;
        });
        void writeCheck(key, { qty_override: qty, unit_override: unit });
      },
      clearLineOverride: (key) => {
        update((d) => {
          delete d.overrides[key];
          return d;
        });
        void writeCheck(key, { qty_override: null, unit_override: null });
      },
      finishShopping: async (items, coversWeek, skipped, details) => {
        if (!hid) return;
        await supabase.from("shopping_trips").insert({
          household_id: hid,
          items,
          skipped,
          covers_week: coversWeek,
          store: details?.store?.trim() || null,
          total: details?.total ?? null,
          created_by: uid,
        });
        // The shop is done, so the list starts over: ticks, removals and pinned
        // amounts all belonged to this trip, as did the hand-added items.
        await supabase.from("grocery_checks").delete().eq("household_id", hid);
        await supabase.from("grocery_items").delete().eq("household_id", hid);
        await load();
      },
      undoShopping: async (tripId) => {
        if (!hid) return;
        // Removing the trip is enough: planned lines are derived, so they
        // reappear. Hand-added items were deleted when the shop was saved and
        // are not recoverable from the archive.
        await supabase.from("shopping_trips").delete().eq("id", tripId);
        await load();
      },
      clearPurchased: () => {
        update((d) => {
          d.purchased = {};
          d.dismissed = {};
          d.overrides = {};
          return d;
        });
        if (!hid) return;
        send(supabase.from("grocery_checks").delete().eq("household_id", hid), "the reset list");
      },
      ensureTasks: (date) => {
        if (state.tasks.some((t) => t.date === date)) return;
        const built = buildTasksFor(date, state.plan);
        if (!built.length) return;
        update((d) => {
          d.tasks = [...d.tasks, ...built];
          return d;
        });
        void insertTasks(built);
      },
      toggleTask: (id) => {
        const current = state.tasks.find((t) => t.id === id);
        const done = !current?.done;
        update((d) => {
          const t = d.tasks.find((x) => x.id === id);
          if (t) t.done = done;
          return d;
        });
        void patchTask(id, { completed: done, completed_at: done ? new Date().toISOString() : null });
      },
      assignTask: (id, assignee) => {
        update((d) => {
          const t = d.tasks.find((x) => x.id === id);
          if (t) t.assignee = assignee ?? undefined;
          return d;
        });
        void patchTask(id, { assigned_to: assignee ?? null });
      },
      addTask: (task) => {
        const created: Task = { ...task, id: `${task.date}-custom-${Date.now()}`, done: false };
        update((d) => {
          d.tasks.push(created);
          return d;
        });
        void insertTasks([created]);
      },
      removeTask: (id) => {
        update((d) => {
          d.tasks = d.tasks.filter((t) => t.id !== id);
          return d;
        });
        if (!hid) return;
        send(
          supabase.from("cooking_tasks").delete().eq("household_id", hid).eq("task_key", id),
          "the removed task",
        );
      },
      upsertInventory: (item) => {
        const existing = state.inventory.find((i) => i.id === item.id);
        update((d) => {
          const idx = d.inventory.findIndex((i) => i.id === item.id);
          if (idx >= 0) d.inventory[idx] = item;
          else d.inventory.push(item);
          return d;
        });
        if (!hid) return;
        const payload = {
          name: item.name,
          category: item.category,
          qty: item.qty,
          unit: item.unit,
          recurring: item.recurring,
          updated_by: uid,
          updated_at: new Date().toISOString(),
        };
        if (existing) {
          send(supabase.from("pantry_items").update(payload).eq("id", item.id), "the pantry item");
        } else {
          void supabase
            .from("pantry_items")
            .insert({ ...payload, household_id: hid, created_by: uid })
            .then(() => load());
        }
      },
      removeInventory: (id) => {
        update((d) => {
          d.inventory = d.inventory.filter((i) => i.id !== id);
          return d;
        });
        send(supabase.from("pantry_items").delete().eq("id", id), "the removed pantry item");
      },
      addPerson: () => {
        /* roommates join with the household invite code */
      },
      removePerson: (id) => {
        update((d) => {
          d.people = d.people.filter((p) => p.id !== id);
          return d;
        });
        if (!hid) return;
        send(
          supabase.from("household_members").delete().eq("household_id", hid).eq("user_id", id),
          "the removed member",
        );
      },
      addRecipe: (recipe) => {
        const stamped = { ...recipe, updatedAt: new Date().toISOString(), updatedBy: uid ?? undefined };
        update((d) => {
          d.customRecipes.push(stamped);
          return d;
        });
        void saveRecipe(stamped);
      },
      updateRecipe: (id, patch) => {
        const base = recipesById[id];
        if (!base) return;
        const next = { ...base, ...patch, id, updatedAt: new Date().toISOString(), updatedBy: uid ?? undefined } as Recipe;
        update((d) => {
          const custom = d.customRecipes.findIndex((r) => r.id === id);
          if (custom >= 0) d.customRecipes[custom] = next;
          else d.recipeEdits[id] = next;
          return d;
        });
        void saveRecipe(next);
      },
      resetRecipe: (id) => {
        update((d) => {
          delete d.recipeEdits[id];
          return d;
        });
        if (!hid) return;
        send(
          supabase.from("recipes").delete().eq("household_id", hid).eq("slug", id),
          "the reset recipe",
        );
      },
      addToCart: (item) => {
        if (!hid) return;
        const existing = state.cart.find(
          (c) =>
            c.name.toLowerCase() === item.name.toLowerCase() &&
            c.unit === item.unit &&
            c.recipeTitle === item.recipeTitle,
        );
        if (existing) {
          const qty = existing.qty + item.qty;
          update((d) => {
            const c = d.cart.find((x) => x.id === existing.id);
            if (c) c.qty = qty;
            return d;
          });
          send(
            supabase
              .from("grocery_items")
              .update({ qty, updated_by: uid, updated_at: new Date().toISOString() })
              .eq("id", existing.id),
            "the item",
          );
          return;
        }
        void supabase
          .from("grocery_items")
          .insert({
            household_id: hid,
            name: item.name,
            qty: item.qty,
            unit: item.unit,
            category: item.category,
            recipe_title: item.recipeTitle ?? null,
            created_by: uid,
            updated_by: uid,
            updated_at: new Date().toISOString(),
          })
          .then(() => load());
      },
      updateCartItem: (id, patch) => {
        update((d) => {
          const c = d.cart.find((x) => x.id === id);
          if (c) Object.assign(c, patch);
          return d;
        });
        send(
          supabase
            .from("grocery_items")
            .update({ ...patch, updated_by: uid, updated_at: new Date().toISOString() })
            .eq("id", id),
          "the amount",
        );
      },
      toggleCartItem: (id) => {
        const current = state.cart.find((c) => c.id === id);
        const done = !current?.done;
        update((d) => {
          const c = d.cart.find((x) => x.id === id);
          if (c) c.done = done;
          return d;
        });
        send(
          supabase
            .from("grocery_items")
            .update({ purchased: done, updated_by: uid, updated_at: new Date().toISOString() })
            .eq("id", id),
          "the tick",
        );
      },
      removeCartItem: (id) => {
        update((d) => {
          d.cart = d.cart.filter((c) => c.id !== id);
          return d;
        });
        send(supabase.from("grocery_items").delete().eq("id", id), "the removal");
      },
      clearCart: () => {
        update((d) => {
          d.cart = [];
          return d;
        });
        if (!hid) return;
        send(supabase.from("grocery_items").delete().eq("household_id", hid), "the cleared list");
      },
      reset: () => setState(initialState),
      importLocalData: async () => {
        if (!hid) return 0;
        let raw: string | null = null;
        try {
          raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        } catch {
          raw = null;
        }
        if (!raw) return 0;
        const local = JSON.parse(raw) as Partial<AppState>;
        let imported = 0;

        for (const recipe of local.customRecipes ?? []) {
          await saveRecipe(recipe);
          imported += 1;
        }
        for (const [slug, patch] of Object.entries(local.recipeEdits ?? {})) {
          const base = RECIPES.find((r) => r.id === slug);
          if (!base) continue;
          await saveRecipe({ ...base, ...patch } as Recipe);
          imported += 1;
        }
        for (const day of Object.values(local.plan ?? {})) {
          await writeDay(day.date, day.recipeIds, day.servings);
          imported += 1;
        }
        if (local.inventory?.length) {
          await supabase.from("pantry_items").insert(
            local.inventory.map((i) => ({
              household_id: hid,
              name: i.name,
              category: i.category,
              qty: i.qty,
              unit: i.unit,
              recurring: i.recurring,
              created_by: uid,
              updated_by: uid,
            })),
          );
          imported += local.inventory.length;
        }
        if (local.cart?.length) {
          await supabase.from("grocery_items").insert(
            local.cart.map((c) => ({
              household_id: hid,
              name: c.name,
              qty: c.qty,
              unit: c.unit,
              category: c.category,
              recipe_title: c.recipeTitle ?? null,
              purchased: c.done,
              created_by: uid,
            })),
          );
          imported += local.cart.length;
        }
        if (local.favorites?.length) {
          await supabase
            .from("recipe_favorites")
            .upsert(
              local.favorites.map((recipe_ref) => ({ household_id: hid, recipe_ref })),
              { onConflict: "household_id,recipe_ref" },
            );
          imported += local.favorites.length;
        }
        try {
          localStorage.setItem(`${LOCAL_STORAGE_KEY}.imported`, new Date().toISOString());
        } catch {
          /* ignore */
        }
        await load();
        return imported;
      },
    };
  }, [state, hydrated, recipes, recipesById, update, householdId, user?.id, load, hasLocalData]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
