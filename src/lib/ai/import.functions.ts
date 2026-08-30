import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DEFAULT_PLATES,
  MAX_PASTE_LENGTH,
  MIN_PASTE_LENGTH,
  parseModelOutput,
  PLATE_OPTIONS,
  scaleToPlates,
  type ParsedRecipe,
} from "@/lib/ai/recipe-schema";
import { canonicalYoutubeUrl } from "@/lib/ai/youtube";

/** Why an import did not produce a recipe. Each maps to one message in the UI. */
export type ImportRefusal =
  | "not_configured"
  | "no_household"
  | "disabled"
  | "daily_limit"
  | "monthly_cap"
  | "too_short"
  | "too_long"
  | "bad_url"
  | "video_not_configured"
  | "not_a_recipe"
  | "too_little_detail"
  | "invalid_output"
  | "provider_error";

export type ImportResult =
  | {
      ok: true;
      recipe: ParsedRecipe;
      remainingToday: number;
      /** false when the source never said what it makes, so nothing was scaled */
      scaled: boolean;
      plates: number;
    }
  | { ok: false; refusal: ImportRefusal; limit?: number };

const inputSchema = z.object({
  source: z.enum(["text", "video"]),
  /** pasted notes, for source "text" */
  text: z.string().default(""),
  /** a YouTube link, for source "video" */
  url: z.string().default(""),
  plates: z.number(),
});

/**
 * Converts pasted text into a recipe draft, metered.
 *
 * Runs only on the server: the model key never reaches the browser, and the
 * quota is claimed in Postgres before the provider is contacted, so a client
 * that skips the UI and calls this directly is limited exactly the same way.
 *
 * The provider and prompt are imported inside the handler on purpose — this
 * file ships to the client bundle, and a top-level import would take the key
 * handling and prompt with it.
 */
export const importRecipe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data, context }): Promise<ImportResult> => {
    const isVideo = data.source === "video";
    const text = data.text.trim();

    // Only a plate count the app actually offers; the number is arithmetic on
    // every quantity, so an arbitrary one is not something to accept on trust.
    const plates = PLATE_OPTIONS.includes(data.plates) ? data.plates : DEFAULT_PLATES;

    // The input is checked before the quota so a stray tap on an empty box, or
    // a link that is not a video, does not burn one of the day's five.
    let videoUrl: string | null = null;
    if (isVideo) {
      videoUrl = canonicalYoutubeUrl(data.url);
      if (!videoUrl) return { ok: false, refusal: "bad_url" };
    } else {
      if (text.length < MIN_PASTE_LENGTH) return { ok: false, refusal: "too_short" };
      if (text.length > MAX_PASTE_LENGTH) return { ok: false, refusal: "too_long" };
    }

    const { getProvider, getVideoProvider } = await import("@/lib/ai/provider.server");
    const provider = isVideo ? getVideoProvider() : getProvider();
    if (!provider) {
      return { ok: false, refusal: isVideo ? "video_not_configured" : "not_configured" };
    }

    const { supabase } = context;
    const { data: claim, error: claimError } = await supabase.rpc("claim_ai_call");
    if (claimError) throw new Error(`Could not check the AI allowance: ${claimError.message}`);

    const claimed = claim as {
      allowed: boolean;
      reason?: ImportRefusal;
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
        _source: data.source,
      });

    const { SYSTEM_PROMPT, VIDEO_SYSTEM_PROMPT, buildUserMessage } =
      await import("@/lib/ai/prompt.server");

    let completion;
    try {
      completion =
        "completeFromVideo" in provider
          ? await provider.completeFromVideo(VIDEO_SYSTEM_PROMPT, videoUrl!)
          : await provider.complete(SYSTEM_PROMPT, buildUserMessage(text));
    } catch (error) {
      // The attempt still counts: a request that fails after reaching the
      // provider may well have been billed, and an uncounted failure is a way
      // to make unlimited calls.
      await finish("provider_error", provider.model, 0, 0);
      console.error("[ai] provider call failed:", error);
      return { ok: false, refusal: "provider_error" };
    }

    const record = (outcome: string) =>
      finish(outcome, completion.model, completion.promptTokens, completion.completionTokens);

    if (!completion.text.trim()) {
      await record(completion.finishReason === "length" ? "out_of_budget" : "empty_reply");
      console.error(
        `[ai] empty reply from ${completion.model} (finish_reason: ${completion.finishReason || "unknown"})`,
      );
      return { ok: false, refusal: "invalid_output" };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(completion.text);
    } catch {
      // The specific outcome is what the admin log shows, so a future failure
      // names itself instead of being one undifferentiated "malformed".
      await record("bad_json");
      console.error(`[ai] unparseable reply: ${completion.text.slice(0, 400)}`);
      return { ok: false, refusal: "invalid_output" };
    }

    const result = parseModelOutput(payload);
    if (!result) {
      await record("bad_shape");
      console.error(`[ai] reply failed validation: ${JSON.stringify(payload).slice(0, 400)}`);
      return { ok: false, refusal: "invalid_output" };
    }
    if (!result.ok) {
      await record(result.reason);
      return { ok: false, refusal: result.reason };
    }

    await record("ok");
    // Scaling is arithmetic, so it happens here rather than being asked of the
    // model: exact, free, and it cannot come back wrong.
    const { recipe, scaled } = scaleToPlates(result.recipe, plates);
    return { ok: true, recipe, scaled, plates, remainingToday: claimed.remaining_today ?? 0 };
  });
