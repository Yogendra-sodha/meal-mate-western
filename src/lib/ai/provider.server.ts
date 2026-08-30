import { RECIPE_JSON_SCHEMA } from "./recipe-schema";

export interface CompletionResult {
  /** raw JSON text from the model, still unvalidated */
  text: string;
  /** the provider's stop reason, e.g. "stop" or "length" */
  finishReason: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface LlmProvider {
  model: string;
  /** Asks for one schema-shaped answer. Throws on a provider or transport error. */
  complete(system: string, user: string): Promise<CompletionResult>;
}

/**
 * Hard ceiling on generated tokens, so a jailbreak still cannot run up a bill.
 *
 * Roomier than a recipe needs because on a reasoning model this budget covers
 * thinking as well as the answer: too tight and the reply is cut off before
 * any JSON is written, which reads as a broken feature rather than a limit.
 */
const MAX_OUTPUT_TOKENS = 6000;

/**
 * Any provider speaking the OpenAI chat-completions API.
 *
 * That covers OpenAI itself and most hosted Qwen, Llama and Mistral endpoints,
 * which is the whole reason the model is reached over this shape rather than a
 * vendor SDK: swapping to one of them is AI_BASE_URL and AI_MODEL, not a
 * rewrite.
 */
class OpenAiCompatibleProvider implements LlmProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    readonly model: string,
  ) {}

  async complete(system: string, user: string): Promise<CompletionResult> {
    // Newer OpenAI models reject `max_tokens` and demand
    // `max_completion_tokens`; several compatible hosts only know the older
    // name. Try the new one and fall back — the rejection arrives before any
    // tokens are generated, so a wrong first guess costs nothing.
    let response = await this.post(system, user, "max_completion_tokens");
    if (!response.ok) {
      const detail = await response.clone().text();
      if (/max_tokens/i.test(detail)) response = await this.post(system, user, "max_tokens");
    }

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Model provider returned ${response.status}: ${detail.slice(0, 300)}`);
    }

    const body = (await response.json()) as {
      model?: string;
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    return {
      text: body.choices?.[0]?.message?.content ?? "",
      // Carried through so an empty reply can say why — "length" means the
      // token budget ran out, which is a different fix from a malformed one.
      finishReason: body.choices?.[0]?.finish_reason ?? "",
      model: body.model ?? this.model,
      promptTokens: body.usage?.prompt_tokens ?? 0,
      completionTokens: body.usage?.completion_tokens ?? 0,
    };
  }

  private post(system: string, user: string, tokenLimitKey: string) {
    return fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        [tokenLimitKey]: MAX_OUTPUT_TOKENS,
        // No temperature: some models accept only their default, and this task
        // wants the least inventive answer available anyway.
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "recipe_import", strict: true, schema: RECIPE_JSON_SCHEMA },
        },
      }),
    });
  }
}

/**
 * Builds the configured provider, or returns null when the key is absent.
 *
 * Null rather than a throw: a household without a key configured should be
 * told the feature is not set up, not shown a crash.
 */
export function getProvider(): LlmProvider | null {
  const apiKey = process.env["AI_API_KEY"] ?? process.env["OPENAI_API_KEY"];
  if (!apiKey) return null;
  const baseUrl = process.env["AI_BASE_URL"] ?? "https://api.openai.com/v1";
  const model = process.env["AI_MODEL"] ?? "gpt-5.6-luna";
  return new OpenAiCompatibleProvider(apiKey, baseUrl, model);
}

/** A model that can watch a video, which the chat-completions shape cannot express. */
export interface VideoProvider {
  model: string;
  /** Reads the video at `youtubeUrl` and answers the system prompt about it. */
  completeFromVideo(system: string, youtubeUrl: string): Promise<CompletionResult>;
}

/**
 * Gemini, reached over its REST API.
 *
 * A separate interface from the text provider because the difference is real:
 * this one is handed a URL it fetches and watches itself, and is billed by the
 * video's duration rather than by the length of a prompt.
 *
 * No response schema is sent — only `application/json`. Gemini's schema
 * dialect differs from OpenAI's, and a mismatch there fails the whole call,
 * while the validation that actually protects the app runs on the reply
 * either way.
 */
class GeminiVideoProvider implements VideoProvider {
  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async completeFromVideo(system: string, youtubeUrl: string): Promise<CompletionResult> {
    // Low media resolution samples the frames coarsely, which is a third of
    // the token cost. A cook's spoken narration is where the amounts are, and
    // the audio track is charged the same at either setting.
    let response = await this.post(system, youtubeUrl, true);
    if (!response.ok) {
      const detail = await response.clone().text();
      // Older or differently-configured endpoints reject the field outright.
      if (/mediaResolution|media_resolution/i.test(detail)) {
        response = await this.post(system, youtubeUrl, false);
      }
    }

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Gemini returned ${response.status}: ${detail.slice(0, 300)}`);
    }

    const body = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const candidate = body.candidates?.[0];

    return {
      text: (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join(""),
      finishReason: candidate?.finishReason ?? "",
      model: this.model,
      promptTokens: body.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }

  private post(system: string, youtubeUrl: string, lowResolution: boolean) {
    const base = process.env["GEMINI_BASE_URL"] ?? "https://generativelanguage.googleapis.com";
    return fetch(`${base.replace(/\/$/, "")}/v1beta/models/${this.model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [
          {
            role: "user",
            parts: [
              { fileData: { fileUri: youtubeUrl, mimeType: "video/*" } },
              { text: "Convert this cooking video into the JSON object described above." },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          ...(lowResolution ? { mediaResolution: "MEDIA_RESOLUTION_LOW" } : {}),
        },
      }),
    });
  }
}

/** Builds the video provider, or null when no Gemini key is configured. */
export function getVideoProvider(): VideoProvider | null {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) return null;
  const model = process.env["GEMINI_MODEL"] ?? "gemini-3.1-flash-lite";
  return new GeminiVideoProvider(apiKey, model);
}
