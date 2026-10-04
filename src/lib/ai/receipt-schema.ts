import { z } from "zod";

import { CATEGORIES, type Category } from "@/lib/types";

const categoryIds = CATEGORIES.map((c) => c.id) as [Category, ...Category[]];

/**
 * Ceiling on the image sent to the model, measured on the base64 payload.
 *
 * The browser shrinks a photo before it ever gets here, so anything this large
 * is not a till receipt — and the limit is checked on the server because the
 * shrinking happens on the client, where it can be skipped.
 */
export const MAX_IMAGE_BASE64 = 6_000_000;

/** What a phone camera produces. Anything else is not a photo of a receipt. */
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

export const receiptLineSchema = z.object({
  name: z.string().min(1).max(80),
  /** 0 when the receipt shows no count, which is most of them */
  qty: z.number().min(0).max(1000),
  unit: z.string().max(20),
  /** in the receipt's own currency, matching shopping_trips.total */
  price: z.number().min(0).max(100000),
  /**
   * The shopping-list item this line is, named exactly as the list names it,
   * or "" for something that was not on the list.
   *
   * This one judgement is the model's, against a list handed to it with the
   * photo, because it is the thing a model is genuinely better at than code:
   * a till prints "TOM RED LB" and "GV PNR 400G" for what the list calls
   * tomatoes and paneer, and no amount of substring matching gets there.
   * Whatever comes back is checked against the list that was sent, so a name
   * the model invented is dropped rather than trusted.
   */
  matches: z.string().max(120).default(""),
  /**
   * The product in plain words, for a line that has to go onto the list.
   *
   * The printed name is kept above because it is what the receipt says and is
   * the honest record. It is useless as a list item though — nobody recognises
   * "GV PNR 400G" a week later — so the model is asked for the everyday name
   * as well, and that is what gets added.
   */
  cleanName: z.string().max(80).default(""),
  /** which aisle it belongs under, so an added item files itself */
  category: z.enum(categoryIds).default("pantry"),
  /** how many receipt lines were merged into this one */
  mergedFrom: z.number().int().min(1).default(1),
});

export const parsedReceiptSchema = z.object({
  store: z.string().max(80),
  total: z.number().min(0).max(1000000),
  /**
   * False when no total was printed or it could not be read. The difference
   * matters: a missing total must leave the field alone rather than write a
   * confident zero over what someone already typed.
   */
  totalStated: z.boolean(),
  lines: z.array(receiptLineSchema).max(120),
});

export const receiptResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), receipt: parsedReceiptSchema }),
  z.object({ ok: z.literal(false), reason: z.enum(["not_a_receipt", "unreadable"]) }),
]);

export type ReceiptLine = z.infer<typeof receiptLineSchema>;
export type ParsedReceipt = z.infer<typeof parsedReceiptSchema>;
export type ReceiptResult = z.infer<typeof receiptResultSchema>;

/** The envelope, before the strict shapes above are applied to its contents. */
const envelopeSchema = z.object({
  ok: z.boolean(),
  reason: z.string().nullish(),
  receipt: z.unknown().nullish(),
});

/**
 * Trims a receipt into range rather than rejecting it.
 *
 * Learned from the recipe importer: one field a few characters too long threw
 * away a whole good answer, and the person who pasted it got "malformed" with
 * nothing to act on. A receipt is worse to lose, because re-taking the photo
 * costs another metered call. So every field is clamped into the shape above,
 * and only a reply with no usable line at all is refused.
 */
function normaliseReceipt(raw: unknown, listNames: string[] = []): ParsedReceipt | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  // The list as it was sent, keyed for lookup. A match is only honoured when
  // it names something that was actually on the list.
  const byKey = new Map(listNames.map((n) => [n.toLowerCase().trim(), n]));

  const lines: ReceiptLine[] = [];
  for (const entry of Array.isArray(r["lines"]) ? r["lines"] : []) {
    if (!entry || typeof entry !== "object") continue;
    const line = entry as Record<string, unknown>;
    const name = String(line["name"] ?? "")
      .trim()
      .slice(0, 80);
    if (!name) continue;
    lines.push({
      name,
      qty: clamp(line["qty"], 0, 1000),
      unit: String(line["unit"] ?? "")
        .trim()
        .slice(0, 20),
      price: clamp(line["price"], 0, 100000),
      matches:
        byKey.get(
          String(line["matches"] ?? "")
            .toLowerCase()
            .trim(),
        ) ?? "",
      // Falls back to the printed name: an added item with an odd name beats
      // one with no name at all, which could not be shown or deleted.
      cleanName:
        String(line["cleanName"] ?? "")
          .trim()
          .slice(0, 80) || name,
      category: asCategory(line["category"]),
      mergedFrom: 1,
    });
    if (lines.length >= 120) break;
  }

  const total = clamp(r["total"], 0, 1000000);
  return {
    store: String(r["store"] ?? "")
      .trim()
      .slice(0, 80),
    total,
    // A total of zero is not a total, whatever the model claimed.
    totalStated: r["totalStated"] === true && total > 0,
    lines: mergeDuplicates(lines),
  };
}

/**
 * Folds repeated purchases of one thing into a single line.
 *
 * A till prints a line per scan, so two bags of the same rice are two lines at
 * the same price — correct on paper, and wrong in a list of what was bought.
 * They are added together here: the quantities sum, the prices sum, and the
 * line says how many it came from so the total still reconciles against the
 * printed one.
 *
 * Lines the model matched to the same list item are merged on that, which
 * catches a till that abbreviates the same product two different ways.
 * Everything else merges on name and unit together, so 1 kg and 1 packet of
 * the same thing stay apart — they are not the same purchase.
 */
function mergeDuplicates(lines: ReceiptLine[]): ReceiptLine[] {
  const merged: ReceiptLine[] = [];
  const seen = new Map<string, ReceiptLine>();

  for (const line of lines) {
    const key = line.matches
      ? `match:${line.matches.toLowerCase()}`
      : `name:${line.name.toLowerCase().trim()}|${line.unit.toLowerCase().trim()}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, line);
      merged.push(line);
      continue;
    }
    existing.qty = Math.min(existing.qty + line.qty, 1000);
    existing.price = Math.min(existing.price + line.price, 100000);
    existing.mergedFrom += 1;
  }

  return merged;
}

/**
 * Coerces a number into range, falling back to the floor.
 *
 * The floor is zero for every field here, and zero already means "not shown on
 * the receipt" — so a value that is missing, negative, NaN or Infinity reads as
 * unknown rather than as an invented amount. Clamping Infinity up to the
 * ceiling instead would put a thousand of something on the list.
 */
/** Only an aisle the app actually has; anything else files under pantry. */
function asCategory(value: unknown): Category {
  const id = String(value ?? "")
    .toLowerCase()
    .trim();
  return CATEGORIES.find((c) => c.id === id)?.id ?? "pantry";
}

function clamp(value: unknown, low: number, high: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return low;
  return Math.min(Math.max(n, low), high);
}

/**
 * Validates and tidies a model reply, or null when it is not usable at all.
 *
 * `listNames` is the shopping list that was sent with the photo; a match the
 * reply claims is kept only when it names one of these.
 */
export function parseReceiptOutput(
  payload: unknown,
  listNames: string[] = [],
): ReceiptResult | null {
  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success) return null;

  if (!envelope.data.ok) {
    const reason = envelope.data.reason === "not_a_receipt" ? "not_a_receipt" : "unreadable";
    return { ok: false, reason };
  }

  const receipt = normaliseReceipt(envelope.data.receipt, listNames);
  if (!receipt) return null;

  // Nothing readable on it. Reported as unreadable rather than as a success
  // with an empty list, so the UI can say "try a clearer photo".
  if (!receipt.lines.length && !receipt.totalStated) return { ok: false, reason: "unreadable" };

  // The second gate on "that is not a receipt", and the one that does not
  // depend on the model agreeing.
  //
  // Asking it to refuse is necessary but not sufficient: photograph a recipe
  // and a model keen to be useful produces a tidy list of ingredient names
  // with every price at zero, which passes every check above. What separates a
  // till slip from any other list of food words is that money is printed on
  // it. No price anywhere and no total means this was not a receipt, whatever
  // the reply claimed.
  const showsMoney = receipt.totalStated || receipt.lines.some((line) => line.price > 0);
  if (!showsMoney) return { ok: false, reason: "not_a_receipt" };

  return { ok: true, receipt };
}

/**
 * Receipt lines that were not on the shopping list.
 *
 * This used to compare names here rather than ask the model, on the grounds
 * that the list was already in hand and comparing is free. That held while the
 * answer was only shown to a person, who could see that "GV PNR 400G" was the
 * paneer. It stopped holding once a match started ticking items off by itself,
 * because substring matching on till abbreviations is wrong often enough to
 * tick the wrong thing. The match now comes back with the line, checked
 * against the list that was sent.
 */
export function unmatchedLines(lines: ReceiptLine[]): ReceiptLine[] {
  return lines.filter((line) => !line.matches);
}

/** The list items this receipt accounts for, deduplicated. */
export function matchedListNames(lines: ReceiptLine[]): string[] {
  return [...new Set(lines.map((line) => line.matches).filter(Boolean))];
}
