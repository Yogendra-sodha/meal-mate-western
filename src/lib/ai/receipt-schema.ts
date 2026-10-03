import { z } from "zod";

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
function normaliseReceipt(raw: unknown): ParsedReceipt | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

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
    lines,
  };
}

/**
 * Coerces a number into range, falling back to the floor.
 *
 * The floor is zero for every field here, and zero already means "not shown on
 * the receipt" — so a value that is missing, negative, NaN or Infinity reads as
 * unknown rather than as an invented amount. Clamping Infinity up to the
 * ceiling instead would put a thousand of something on the list.
 */
function clamp(value: unknown, low: number, high: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return low;
  return Math.min(Math.max(n, low), high);
}

/** Validates and tidies a model reply, or null when it is not usable at all. */
export function parseReceiptOutput(payload: unknown): ReceiptResult | null {
  const envelope = envelopeSchema.safeParse(payload);
  if (!envelope.success) return null;

  if (!envelope.data.ok) {
    const reason = envelope.data.reason === "not_a_receipt" ? "not_a_receipt" : "unreadable";
    return { ok: false, reason };
  }

  const receipt = normaliseReceipt(envelope.data.receipt);
  if (!receipt) return null;
  // Nothing readable on it. Reported as unreadable rather than as a success
  // with an empty list, so the UI can say "try a clearer photo".
  if (!receipt.lines.length && !receipt.totalStated) return { ok: false, reason: "unreadable" };
  return { ok: true, receipt };
}

/**
 * Receipt lines that do not match anything on the shopping list.
 *
 * Deliberately arithmetic rather than another question for the model: the list
 * is already in hand, so comparing is free and exact. Matching is on the name
 * alone, lowercased, both ways around — a till prints "TOMATO RED" for what the
 * list calls "tomatoes", and either can be the longer string.
 */
export function unmatchedLines(lines: ReceiptLine[], listNames: string[]): ReceiptLine[] {
  const known = listNames.map((n) => n.toLowerCase().trim()).filter(Boolean);
  return lines.filter((line) => {
    const name = line.name.toLowerCase().trim();
    return !known.some((k) => k === name || k.includes(name) || name.includes(k));
  });
}
