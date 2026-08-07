export type Category = "vegetables" | "dairy" | "grains" | "spices" | "pantry";

export const CATEGORIES: { id: Category; label: string; emoji: string }[] = [
  { id: "vegetables", label: "Vegetables", emoji: "🥬" },
  { id: "dairy", label: "Dairy", emoji: "🥛" },
  { id: "grains", label: "Grains & Flour", emoji: "🌾" },
  { id: "spices", label: "Spices", emoji: "🌶️" },
  { id: "pantry", label: "Pantry", emoji: "🫙" },
];

export type Cuisine =
  | "Gujarati"
  | "Punjabi"
  | "South Indian"
  | "Indian Chinese"
  | "Chaat"
  | "Mexican"
  | "Italian"
  | "Dessert";

export const CUISINES: Cuisine[] = [
  "Gujarati",
  "Punjabi",
  "South Indian",
  "Indian Chinese",
  "Chaat",
  "Mexican",
  "Italian",
  "Dessert",
];

export interface Ingredient {
  name: string;
  qty: number;
  unit: string;
  category: Category;
  /** staple items usually already in the pantry */
  staple?: boolean;
}

export interface Recipe {
  id: string;
  title: string;
  cuisine: Cuisine;
  description: string;
  sourceName: string;
  sourceUrl: string;
  prepMin: number;
  cookMin: number;
  /** all quantities are stated for this many plates */
  baseServings: number;
  ingredients: Ingredient[];
  prepSteps: string[];
  cookSteps: string[];
  tags: string[];
}

export interface DayPlan {
  /** yyyy-mm-dd */
  date: string;
  recipeIds: string[];
  servings: number;
  note?: string;
  cooked?: boolean;
}

export interface Person {
  id: string;
  name: string;
}

export type TaskKind = "prep" | "cook" | "chore";

export interface Task {
  id: string;
  date: string;
  recipeId?: string;
  kind: TaskKind;
  label: string;
  assignee?: string;
  done: boolean;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: Category;
  qty: number;
  unit: string;
  recurring: boolean;
}

export interface AppState {
  plan: Record<string, DayPlan>;
  tasks: Task[];
  people: Person[];
  inventory: InventoryItem[];
  favorites: string[];
  ratings: Record<string, number>;
  purchased: Record<string, boolean>;
  customRecipes: Recipe[];
  cookLog: { date: string; recipeId: string; cost?: number }[];
  defaultServings: number;
}
