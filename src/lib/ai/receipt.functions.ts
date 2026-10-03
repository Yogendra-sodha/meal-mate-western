import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BASE64,
  parseReceiptOutput,
  type ParsedReceipt,
} from "@/lib/ai/receipt-schema";

/** Why a scan produced nothing. Each maps to one message in the UI. */
export type ScanRefusal =
  | "not_configured"
  | "no_household"
  | "disabled"
  | "daily_limit"
  | "monthly_cap"
  | "bad_image"
  | "too_large"
  | "not_a_receipt"
  | "unreadable"
  | "invalid_output"
  | "provider_error";

export type ScanResult =
  | { ok: true; receipt: ParsedReceipt; remainingToday: number }
  | { ok: false; refusal: ScanRefusal; limit?: number; detail?: string };

const inputSchema = z.object({
  /** the photo, base64 with no data: prefix */
  imageBase64: z.string(),
  mimeType: z.string(),
});

/**
 * Reads a photographed receipt, metered exactly like the recipe imports.
 *
 * Server-only, for the same two reasons as those: the Gemini key never reaches
 * the browser, and the allowance is claimed in Postgres before the provider is
 * contacted — so calling this directly instead of through the button is limited
 * identically.
 *
 * The provider and prompt are imported inside the handler on purpose. This file
 * reaches the client bundle; a top-level import would take the key handling and
 * the prompt with it.
 */
export const scanReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data, context }): Promise<ScanResult> => {
    // Checked before the quota, so a wrong file type or an oversized photo does
    // not burn one of the day's calls.
    if (!ALLOWED_IMAGE_TYPES.includes(data.mimeType)) return { ok: false, refusal: "bad_image" };
    if (!data.imageBase64) return { ok: false, refusal: "bad_image" };
    if (data.imageBase64.length > MAX_IMAGE_BASE64) return { ok: false, refusal: "too_large" };

    const { getImageProvider } = await import("@/lib/ai/provider.server");
    const provider = getImageProvider();
    if (!provider) return { ok: false, refusal: "not_configured" };

    const { supabase } = context;
    const { data: claim, error: claimError } = await supabase.rpc("claim_ai_call");
    if (claimError) throw new Error(`Could not check the AI allowance: ${claimError.message}`);

    const claimed = claim as {
      allowed: boolean;
      reason?: ScanRefusal;
      usage_id?: string;
      remaining_today?: number;
      limit?: number;
    };
    if (!claimed.allowed) {
      return {
        ok: false,
        refusal: claimed.reason ?? "disabled",
        ...(claimed.limit !== undefined ? { limit: claimed.limit } : {}),
      };
    }

    const usageId = claimed.usage_id!;
    const finish = (
      outcome: string,
      model: string,
      promptTokens: number,
      completionTokens: number,
    ) =>
      supabase.rpc("record_ai_call", {
        _usage_id: usageId,
        _model: model,
        _prompt_tokens: promptTokens,
        _completion_tokens: completionTokens,
        _outcome: outcome,
        // Its own source, so the spend is costed at the image rates rather
        // than borrowing the text or video ones and reporting the wrong total.
        _source: "receipt",
      });

    const { RECEIPT_SYSTEM_PROMPT } = await import("@/lib/ai/prompt.server");

    let completion;
    try {
      completion = await provider.completeFromImage(
        RECEIPT_SYSTEM_PROMPT,
        data.imageBase64,
        data.mimeType,
      );
    } catch (error) {
      // Still counted: a call that failed after reaching the provider may have
      // been billed, and an uncounted failure is a way to make free ones.
      const { status, detail } = error as { status?: number; detail?: string };
      await finish(status ? `provider_${status}` : "provider_error", provider.model, 0, 0);
      console.error("[ai] receipt scan failed:", error);
      return { ok: false, refusal: "provider_error", ...(detail ? { detail } : {}) };
    }

    const record = (outcome: string) =>
      finish(outcome, completion.model, completion.promptTokens, completion.completionTokens);

    if (!completion.text.trim()) {
      await record(completion.finishReason === "length" ? "out_of_budget" : "empty_reply");
      console.error(
        `[ai] empty receipt reply from ${completion.model} (finish_reason: ${completion.finishReason || "unknown"})`,
      );
      return { ok: false, refusal: "invalid_output" };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(completion.text);
    } catch {
      await record("bad_json");
      console.error(`[ai] unparseable receipt reply: ${completion.text.slice(0, 400)}`);
      return { ok: false, refusal: "invalid_output" };
    }

    const result = parseReceiptOutput(payload);
    if (!result) {
      await record("bad_shape");
      console.error(
        `[ai] receipt reply failed validation: ${JSON.stringify(payload).slice(0, 400)}`,
      );
      return { ok: false, refusal: "invalid_output" };
    }
    if (!result.ok) {
      await record(result.reason);
      return { ok: false, refusal: result.reason };
    }

    await record("ok");
    return { ok: true, receipt: result.receipt, remainingToday: claimed.remaining_today ?? 0 };
  });
