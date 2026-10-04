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
  | "model_busy"
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
  /** what is on the shopping list, so lines can be matched back to it */
  listNames: z.array(z.string()).default([]),
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

    const { supabase } = context;

    // Which model reads it is the household's choice, so that both can be
    // tried on real receipts without a deploy between attempts. The row may
    // not exist yet — claim_ai_call creates it — in which case the default
    // applies, same as the column's.
    const { data: settings } = await supabase
      .from("ai_settings")
      .select("receipt_provider")
      .limit(1)
      .maybeSingle();
    const prefer = settings?.receipt_provider === "openai" ? "openai" : "gemini";

    const { getImageProviders, isBusyError } = await import("@/lib/ai/provider.server");
    const providers = getImageProviders(prefer);
    if (!providers.length) return { ok: false, refusal: "not_configured" };
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

    const { buildReceiptPrompt } = await import("@/lib/ai/prompt.server");
    const prompt = buildReceiptPrompt(data.listNames);

    // "This model is currently experiencing high demand" is far and away the
    // most common way a scan fails, and it is not a reason to give up: the
    // other provider is configured and is almost never busy at the same
    // moment. Only a busy refusal moves on — a bad key or a wrong model id
    // would fail the same way twice, so those stop here.
    let completion;
    let used = providers[0]!;
    let lastError: unknown;
    for (const candidate of providers) {
      used = candidate;
      try {
        completion = await candidate.completeFromImage(prompt, data.imageBase64, data.mimeType);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (!isBusyError(error)) break;
        console.warn(`[ai] ${candidate.model} was busy, trying the next provider`);
      }
    }

    if (!completion) {
      // Still counted: a call that failed after reaching the provider may have
      // been billed, and an uncounted failure is a way to make free ones.
      const { status, detail } = lastError as { status?: number; detail?: string };
      await finish(status ? `provider_${status}` : "provider_error", used.model, 0, 0);
      console.error("[ai] receipt scan failed:", lastError);
      return {
        ok: false,
        refusal: isBusyError(lastError) ? "model_busy" : "provider_error",
        ...(detail ? { detail } : {}),
      };
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

    const result = parseReceiptOutput(payload, data.listNames);
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
