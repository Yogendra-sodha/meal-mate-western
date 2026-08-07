import { RECIPES, RECIPE_INDEX } from "@/data/recipes";
import type { AppState, Ingredient, InventoryItem, Recipe } from "@/lib/types";

export const WEEKDAY_THEMES: { label: string; hint: string; pick: (r: Recipe) => boolean }[] = [
  // index 0 = Sunday
  { label: "Flexible", hint: "Repeat a favourite or try something new", pick: () => true },
  {
    label: "Traditional Gujarati",
    hint: "Roti, rice, dal or kadhi, shaak",
    pick: (r) => r.cuisine === "Gujarati",
  },
  {
    label: "Something different",
    hint: "Punjabi, Chinese, chaat, dosa, Mexican, pizza, pasta",
    pick: (r) =>
      ["Punjabi", "Indian Chinese", "Chaat", "South Indian", "Mexican", "Italian"].includes(
        r.cuisine,
      ),
  },
  {
    label: "Light meal",
    hint: "Dal fry, jeera rice, khichdi, kadhi",
    pick: (r) => r.tags.includes("light"),
  },
  {
    label: "Roti & green vegetables",
    hint: "Bhindi bateta, ringan bateta, dudhi chana, kobi bateta",
    pick: (r) => r.tags.includes("green"),
  },
  { label: "Keep it simple", hint: "Low effort, fast to cook", pick: (r) => r.tags.includes("quick") },
  {
    label: "Special meal",
    hint: "Restaurant style: paneer, dosa, chaat, pizza, pasta, Mexican",
    pick: (r) => r.tags.includes("special"),
  },
];

export function toISODate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseISODate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function startOfWeek(d: Date, weekStartsOn = 1) {
  const copy = new Date(d);
  const diff = (copy.getDay() - weekStartsOn + 7) % 7;
  copy.setDate(copy.getDate() - diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function weekDates(anchor: Date) {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function dayLabel(iso: string) {
  return parseISODate(iso).toLocaleDateString(undefined, { weekday: "long" });
}

export function shortDayLabel(iso: string) {
  return parseISODate(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

/** Suggest a recipe for a date, respecting the weekday theme and avoiding recent repeats. */
export function suggestForDate(iso: string, avoid: string[], favorites: string[] = []): string {
  const theme = WEEKDAY_THEMES[parseISODate(iso).getDay()];
  const pool = RECIPES.filter((r) => theme.pick(r) && !avoid.includes(r.id));
  const list = (pool.length ? pool : RECIPES.filter((r) => !avoid.includes(r.id))).slice();
  if (!list.length) return RECIPES[0].id;
  const favoured = list.filter((r) => favorites.includes(r.id));
  const from = favoured.length && Math.random() > 0.5 ? favoured : list;
  return from[Math.floor(Math.random() * from.length)].id;
}

export function generateWeek(dates: string[], state: AppState) {
  const recent = Object.values(state.plan)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 10)
    .flatMap((p) => p.recipeIds);
  const chosen: string[] = [];
  const plan: Record<string, string[]> = {};
  for (const iso of dates) {
    const id = suggestForDate(iso, [...recent.slice(0, 5), ...chosen], state.favorites);
    chosen.push(id);
    plan[iso] = [id];
  }
  return plan;
}

export function scaleIngredient(ing: Ingredient, servings: number, base: number): Ingredient {
  const factor = servings / base;
  return { ...ing, qty: ing.qty * factor };
}

export function formatQty(qty: number, unit: string) {
  const rounded = qty >= 10 ? Math.round(qty) : Math.round(qty * 100) / 100;
  return `${rounded} ${unit}`;
}

export interface GroceryLine {
  key: string;
  name: string;
  unit: string;
  qty: number;
  category: Ingredient["category"];
  staple: boolean;
  recipes: string[];
  inStock: number;
  needed: number;
}

export function buildGroceryList(
  dates: string[],
  state: AppState,
  recipesById: Record<string, Recipe>,
): GroceryLine[] {
  const map = new Map<string, GroceryLine>();
  for (const iso of dates) {
    const day = state.plan[iso];
    if (!day) continue;
    for (const rid of day.recipeIds) {
      const recipe = recipesById[rid];
      if (!recipe) continue;
      for (const ing of recipe.ingredients) {
        const scaled = scaleIngredient(ing, day.servings || 20, recipe.baseServings);
        const key = `${ing.name.toLowerCase()}|${ing.unit}`;
        const existing = map.get(key);
        if (existing) {
          existing.qty += scaled.qty;
          if (!existing.recipes.includes(recipe.title)) existing.recipes.push(recipe.title);
        } else {
          map.set(key, {
            key,
            name: ing.name,
            unit: ing.unit,
            qty: scaled.qty,
            category: ing.category,
            staple: !!ing.staple,
            recipes: [recipe.title],
            inStock: 0,
            needed: scaled.qty,
          });
        }
      }
    }
  }
  const inventory = new Map<string, InventoryItem>(
    state.inventory.map((i) => [`${i.name.toLowerCase()}|${i.unit}`, i]),
  );
  return Array.from(map.values())
    .map((line) => {
      const inv = inventory.get(line.key);
      const inStock = inv ? inv.qty : 0;
      return { ...line, inStock, needed: Math.max(0, line.qty - inStock) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export { RECIPE_INDEX };
