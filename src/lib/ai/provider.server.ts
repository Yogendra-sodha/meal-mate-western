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
 * How long one attempt gets before it is abandoned.
 *
 * The whole request has to finish inside the serverless function's budget, and
 * a scan may try a second provider after the first turns one down. Capping
 * each attempt is what makes room for the second: without it one hung call
 * eats the entire budget and the fallback never runs.
 */
const ATTEMPT_TIMEOUT_MS = 20000;

/**
 * True when the provider turned the call down for load rather than refusing it.
 *
 * Both providers say this differently — 429 and 503, "overloaded",
 * "high demand", UNAVAILABLE, RESOURCE_EXHAUSTED — and the difference matters:
 * a busy model is worth asking somewhere else, while a bad key or a wrong
 * model id would fail exactly the same way twice.
 */
export function isBusyError(error: unknown): boolean {
  const { status, detail } = (error ?? {}) as { status?: number; detail?: string };
  if (status === 429 || status === 503 || status === 529) return true;
  if (status === 500 || status === 502 || status === 504) return true;
  return /overload|high demand|unavailable|resource[_ ]exhausted|capacity|try again/i.test(
    detail ?? "",
  );
}

/** fetch with a deadline, so one slow provider cannot spend the whole budget. */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    // An abort reads as a busy provider: same cause, same remedy.
    if ((error as { name?: string }).name === "AbortError") {
      throw Object.assign(new Error("The model took too long to answer"), {
        status: 504,
        detail: "The model took too long to answer",
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

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
      const body = await response.text();
      throw Object.assign(new Error(`Model provider returned ${response.status}`), {
        status: response.status,
        detail: readProviderMessage(body),
      });
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
    return fetchWithTimeout(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
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
      const body = await response.text();
      // The status and the provider's own words are carried on the error so the
      // failure can name itself instead of arriving as "could not reach the
      // model", which says nothing and sends whoever is debugging to the logs.
      throw Object.assign(new Error(`Gemini returned ${response.status}`), {
        status: response.status,
        detail: readProviderMessage(body),
      });
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
    return fetchWithTimeout(
      `${base.replace(/\/$/, "")}/v1beta/models/${this.model}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [
            {
              role: "user",
              parts: [
                // No mimeType: a YouTube link is given as the uri alone, and a
                // wildcard like "video/*" is not a mime type the API accepts.
                { fileData: { fileUri: youtubeUrl } },
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
      },
    );
  }
}

/** Builds the video provider, or null when no Gemini key is configured. */
export function getVideoProvider(): VideoProvider | null {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) return null;
  const model = process.env["GEMINI_MODEL"] ?? "gemini-3.1-flash-lite";
  return new GeminiVideoProvider(apiKey, model);
}

/** A model that can read a photograph. */
export interface ImageProvider {
  model: string;
  /** Reads the image and answers the system prompt about it. */
  completeFromImage(
    system: string,
    imageBase64: string,
    mimeType: string,
  ): Promise<CompletionResult>;
}

/**
 * Gemini again, handed the bytes rather than a link.
 *
 * Its own interface for the same reason the video one has its own: a photo is
 * sent inline as base64 and billed by the number of tiles the image covers,
 * which is nothing like a prompt's length or a video's duration. Media
 * resolution is left at the default here — the whole job is reading small
 * printed text, and sampling it coarsely to save tokens would defeat it.
 */
class GeminiImageProvider implements ImageProvider {
  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  async completeFromImage(
    system: string,
    imageBase64: string,
    mimeType: string,
  ): Promise<CompletionResult> {
    const base = process.env["GEMINI_BASE_URL"] ?? "https://generativelanguage.googleapis.com";
    const response = await fetchWithTimeout(
      `${base.replace(/\/$/, "")}/v1beta/models/${this.model}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [
            {
              role: "user",
              parts: [
                // Inline bytes need their real mime type, unlike a YouTube uri
                // which takes none.
                { inlineData: { mimeType, data: imageBase64 } },
                { text: "Read this receipt into the JSON object described above." },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          },
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw Object.assign(new Error(`Gemini returned ${response.status}`), {
        status: response.status,
        detail: readProviderMessage(body),
      });
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
}

/**
 * The OpenAI-compatible route to the same job, for comparison.
 *
 * Published receipt-extraction benchmarks put Gemini ahead on both accuracy
 * and tokens per image, which is why it is the default — but a benchmark run
 * on American invoices says little about an Indian grocery till slip printing
 * "GV PNR 400G", so the choice is a setting and this is the other option.
 *
 * Asked for json_object rather than a strict schema: the prompt already spells
 * the shape out for Gemini's benefit, and the validator on the reply is the
 * actual gate either way. One shape of prompt, two providers.
 */
class OpenAiImageProvider implements ImageProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    readonly model: string,
  ) {}

  async completeFromImage(
    system: string,
    imageBase64: string,
    mimeType: string,
  ): Promise<CompletionResult> {
    // Same two spellings of the token limit as the text path, for the same
    // reason: newer models reject max_tokens, older hosts only know it.
    let response = await this.post(system, imageBase64, mimeType, "max_completion_tokens");
    if (!response.ok) {
      const detail = await response.clone().text();
      if (/max_tokens/i.test(detail)) {
        response = await this.post(system, imageBase64, mimeType, "max_tokens");
      }
    }

    if (!response.ok) {
      const body = await response.text();
      throw Object.assign(new Error(`Model provider returned ${response.status}`), {
        status: response.status,
        detail: readProviderMessage(body),
      });
    }

    const body = (await response.json()) as {
      model?: string;
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    return {
      text: body.choices?.[0]?.message?.content ?? "",
      finishReason: body.choices?.[0]?.finish_reason ?? "",
      model: body.model ?? this.model,
      promptTokens: body.usage?.prompt_tokens ?? 0,
      completionTokens: body.usage?.completion_tokens ?? 0,
    };
  }

  private post(system: string, imageBase64: string, mimeType: string, tokenLimitKey: string) {
    return fetchWithTimeout(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        [tokenLimitKey]: MAX_OUTPUT_TOKENS,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              { type: "text", text: "Read this receipt into the JSON object described above." },
              // Inline bytes travel as a data URL on this API, not as a field
              // of their own the way Gemini takes them.
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });
  }
}

/** Which model reads the photo. Gemini unless the household has said otherwise. */
export type ImageProviderChoice = "gemini" | "openai";

/**
 * Builds the chosen image provider, falling back to the other when its key is
 * missing, or null when neither is configured.
 *
 * Falling back rather than failing: both keys live in the same place, and a
 * household that has only one of them should get a working scanner rather than
 * "not set up" because a setting names the key they do not have.
 */
/**
 * Both image providers, preferred one first.
 *
 * A busy model is the common failure by far — "experiencing high demand" comes
 * back far more often than anything else — and waiting and asking the same one
 * again mostly just spends the budget. Two keys are already configured, so the
 * second attempt goes somewhere that is not busy instead.
 */
export function getImageProviders(prefer: ImageProviderChoice = "gemini"): ImageProvider[] {
  const both =
    prefer === "openai" ? (["openai", "gemini"] as const) : (["gemini", "openai"] as const);
  const built = both.map((choice) => buildImageProvider(choice));
  return built.filter((p): p is ImageProvider => p !== null);
}

function buildImageProvider(choice: ImageProviderChoice): ImageProvider | null {
  if (choice === "gemini") {
    const key = process.env["GEMINI_API_KEY"];
    if (!key) return null;
    const model =
      process.env["GEMINI_IMAGE_MODEL"] ?? process.env["GEMINI_MODEL"] ?? "gemini-3.1-flash-lite";
    return new GeminiImageProvider(key, model);
  }
  const key = process.env["AI_API_KEY"] ?? process.env["OPENAI_API_KEY"];
  if (!key) return null;
  const baseUrl = process.env["AI_BASE_URL"] ?? "https://api.openai.com/v1";
  // The text model unless a vision-specific one is named: on a multimodal
  // model they are the same id, and where they are not this is the override.
  const model = process.env["AI_VISION_MODEL"] ?? process.env["AI_MODEL"] ?? "gpt-5.6-luna";
  return new OpenAiImageProvider(key, baseUrl, model);
}

export function getImageProvider(prefer: ImageProviderChoice = "gemini"): ImageProvider | null {
  return getImageProviders(prefer)[0] ?? null;
}

/**
 * Digs the human-readable part out of a provider's error body.
 *
 * Both providers wrap the useful sentence — "model not found", "API key not
 * valid" — inside an envelope, and the raw JSON is no use in a toast.
 */
function readProviderMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; status?: string } };
    return parsed.error?.message ?? parsed.error?.status ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}
