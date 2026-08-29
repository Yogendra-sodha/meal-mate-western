import { z } from "zod";

import { CATEGORIES, CUISINES } from "@/lib/types";
import type { Category, Cuisine, Recipe } from "@/lib/types";

/** Bounds on the pasted text, checked before a call is ever reserved. */
export const MIN_PASTE_LENGTH = 40;
export const MAX_PASTE_LENGTH = 8000;

const categoryIds = CATEGORIES.map((c) => c.id) as [Category, ...Category[]];
const cuisineNames = CUISINES as [Cuisine, ...Cuisine[]];

/**
 * What the model is allowed to return.
 *
 * Every bound here is deliberate. The model is told to return this shape, but
 * being told and complying are different things, so the server re-checks the
 * response against this before any of it reaches the browser.
 */
export const parsedIngredientSchema = z.object({
  name: z.string().min(1).max(80),
  // Zero is allowed and means "no amount was given" — "salt to taste" is an
  // ordinary line in a handwritten recipe, and the editor shows it as a blank
  // to fill in. Requiring a positive number here threw away whole recipes over
  // one unmeasured ingredient.
  qty: z.number().min(0).max(10000),
  unit: z.string().max(20),
  category: z.enum(categoryIds),
});

export const parsedRecipeSchema = z.object({
  title: z.string().min(1).max(120),
  cuisine: z.enum(cuisineNames),
  description: z.string().max(400),
  prepMin: z.number().int().min(0).max(600),
  cookMin: z.number().int().min(0).max(600),
  baseServings: z.number().int().min(1).max(500),
  ingredients: z.array(parsedIngredientSchema).max(60),
  prepSteps: z.array(z.string().min(1).max(500)).max(40),
  cookSteps: z.array(z.string().min(1).max(500)).max(40),
  tags: z.array(z.string().min(1).max(30)).max(10),
});

/**
 * The model answers with one of two shapes and nothing else.
 *
 * This is what stops the endpoint being a general-purpose chatbot. Constrained
 * to this union, "write me a Python script" has no shape to come back as
 * except `not_a_recipe` — it cannot return prose even if the text asks it to.
 */
export const aiResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), recipe: parsedRecipeSchema }),
  z.object({ ok: z.literal(false), reason: z.enum(["not_a_recipe", "too_little_detail"]) }),
]);

export type ParsedRecipe = z.infer<typeof parsedRecipeSchema>;
export type AiResult = z.infer<typeof aiResultSchema>;

/**
 * The same shape as JSON Schema, for the provider's structured-output mode.
 *
 * Hand-written rather than generated so it stays readable, and kept beside the
 * zod schema above so the two are edited together. zod remains the authority:
 * this only shapes the request, the validation that matters happens on the way
 * back.
 */
export const RECIPE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "reason", "recipe"],
  properties: {
    ok: { type: "boolean" },
    reason: { type: ["string", "null"], enum: ["not_a_recipe", "too_little_detail", null] },
    recipe: {
      type: ["object", "null"],
      additionalProperties: false,
      required: [
        "title",
        "cuisine",
        "description",
        "prepMin",
        "cookMin",
        "baseServings",
        "ingredients",
        "prepSteps",
        "cookSteps",
        "tags",
      ],
      properties: {
        title: { type: "string" },
        cuisine: { type: "string", enum: [...CUISINES] },
        description: { type: "string" },
        prepMin: { type: "integer" },
        cookMin: { type: "integer" },
        baseServings: { type: "integer" },
        ingredients: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "qty", "unit", "category"],
            properties: {
              name: { type: "string" },
              qty: { type: "number" },
              unit: { type: "string" },
              category: { type: "string", enum: categoryIds },
            },
          },
        },
        prepSteps: { type: "array", items: { type: "string" } },
        cookSteps: { type: "array", items: { type: "string" } },
        tags: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

/**
 * Validates a model response, or rejects it.
 *
 * Structured-output mode wants every key present and nullable rather than a
 * real union, so the flat `{ ok, reason, recipe }` envelope it returns is
 * narrowed here into the union the rest of the code works with. `null` means
 * the response did not survive validation and nothing should be shown for it —
 * a model claiming `ok: true` with a broken recipe fails here, not later in
 * the UI.
 */
export function parseModelOutput(raw: unknown): AiResult | null {
  const envelope = z
    .object({
      ok: z.boolean(),
      reason: z.string().nullish(),
      recipe: z.unknown().nullish(),
    })
    .safeParse(raw);
  if (!envelope.success) return null;

  if (envelope.data.ok) {
    const normalised = normaliseRecipe(envelope.data.recipe);
    if (!normalised) return null;
    const recipe = parsedRecipeSchema.safeParse(normalised);
    return recipe.success ? { ok: true, recipe: recipe.data } : null;
  }
  return {
    ok: false,
    reason: envelope.data.reason === "too_little_detail" ? "too_little_detail" : "not_a_recipe",
  };
}

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** Whole minutes and plate counts. */
const whole = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
};

/** Amounts keep two decimals, so 2.5 kg survives. */
const amount = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n * 100) / 100, min), max);
};

const list = (value: unknown) => (Array.isArray(value) ? value : []);

/**
 * Brings a model response inside the bounds instead of rejecting it for being
 * outside them.
 *
 * The bounds exist to keep unbounded data out of the database, and clamping
 * achieves that just as well as refusing — while refusing costs the cook a
 * whole recipe over a description four characters too long, or a category the
 * model spelled its own way. Both would be visible and fixable in the editor;
 * neither is worth discarding the parse for.
 *
 * A missing title is the one thing that cannot be salvaged, because there is
 * no recipe without one. Everything else has a safe reading.
 */
function normaliseRecipe(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const title = text(r["title"], 120);
  if (!title) return null;

  const cuisine = CUISINES.find((c) => c === r["cuisine"]) ?? "Gujarati";
  const steps = (value: unknown) =>
    list(value)
      .map((s) => text(s, 500))
      .filter(Boolean)
      .slice(0, 40);

  return {
    title,
    cuisine,
    description: text(r["description"], 400),
    prepMin: whole(r["prepMin"], 0, 600, 0),
    cookMin: whole(r["cookMin"], 0, 600, 0),
    baseServings: whole(r["baseServings"], 1, 500, 20),
    ingredients: list(r["ingredients"])
      .map((item) => {
        const i = (typeof item === "object" && item !== null ? item : {}) as Record<
          string,
          unknown
        >;
        return {
          name: text(i["name"], 80),
          qty: amount(i["qty"], 0, 10000, 0),
          unit: text(i["unit"], 20),
          category: categoryIds.find((c) => c === i["category"]) ?? "pantry",
        };
      })
      .filter((i) => i.name)
      .slice(0, 60),
    prepSteps: steps(r["prepSteps"]),
    cookSteps: steps(r["cookSteps"]),
    tags: list(r["tags"])
      .map((t) => text(t, 30))
      .filter(Boolean)
      .slice(0, 10),
  };
}

/**
 * Turns a validated parse into the draft the recipe editor opens on.
 *
 * The id is left empty so the editor slugs it from the title on save, exactly
 * as it does for a recipe typed by hand — an imported recipe is an ordinary
 * recipe from here on.
 */
export function toRecipeDraft(parsed: ParsedRecipe): Recipe {
  return {
    id: "",
    title: parsed.title,
    cuisine: parsed.cuisine,
    description: parsed.description,
    sourceName: "Pasted text",
    sourceUrl: "",
    videoUrl: "",
    prepMin: parsed.prepMin,
    cookMin: parsed.cookMin,
    baseServings: parsed.baseServings,
    ingredients: parsed.ingredients.map((i) => ({
      name: i.name,
      qty: i.qty,
      unit: i.unit,
      category: i.category,
    })),
    prepSteps: parsed.prepSteps,
    cookSteps: parsed.cookSteps,
    tags: parsed.tags,
  };
}
