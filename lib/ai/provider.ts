/**
 * Common LLM provider interface. Both the local Ollama client and cloud
 * providers (OpenRouter, OpenAI, ...) implement this so the API route
 * can stay provider-agnostic.
 *
 * The provider is responsible for:
 *   1) Verifying that the model is reachable (ensureReady).
 *   2) Running the chat completion with strict JSON output.
 *   3) Returning the raw text; the caller parses + validates it.
 *
 * Provider selection: set LLM_PROVIDER=ollama | openrouter in env.
 * Default is "openrouter" so the Vercel deployment Just Works when
 * OPENROUTER_API_KEY is set. Local development can opt back into
 * Ollama with LLM_PROVIDER=ollama.
 */

import type { Analysis } from "./schemas";
import { OpenRouterProvider } from "./openrouter";
import { OllamaProvider } from "./ollama-provider";

export type ProviderName = "ollama" | "openrouter";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderOptions {
  model?: string;
  /** Hard timeout for the chat call, in milliseconds. */
  timeoutMs?: number;
}

export interface LlmProvider {
  readonly name: ProviderName;
  /** Resolve the model id that will actually be used. */
  resolveModel(options?: ProviderOptions): string;
  /** Throw LlmError if the provider / model is not reachable. */
  ensureReady(options?: ProviderOptions): Promise<void>;
  /** Run a chat completion and return the raw text. */
  chat(messages: ChatMessage[], options?: ProviderOptions): Promise<string>;
}

export class LlmError extends Error {
  constructor(
    public readonly kind:
      | "unavailable"
      | "model_missing"
      | "timeout"
      | "empty"
      | "http"
      | "parse"
      | "schema"
      | "auth"
      | "rate_limit",
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/**
 * Try to parse a model's text output as strict JSON. The provider is
 * instructed to return JSON only, but in practice models sometimes wrap
 * the payload in ```json fences or add a leading sentence.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new LlmError("empty", "Model returned an empty response");
  }
  // Direct parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // Strip code fences
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fence) {
      try {
        return JSON.parse(fence[1].trim());
      } catch (err) {
        throw new LlmError("parse", "Could not parse fenced JSON from model", err);
      }
    }
    // Take the first {...} block
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch (err) {
        throw new LlmError("parse", "Could not parse JSON from model output", err);
      }
    }
    throw new LlmError("parse", "Model output did not contain JSON");
  }
}

function pickProviderName(): ProviderName {
  const raw = (process.env.LLM_PROVIDER ?? "openrouter").toLowerCase().trim();
  if (raw === "ollama" || raw === "openrouter") return raw;
  return "openrouter";
}

let cached: LlmProvider | null = null;
let cachedName: ProviderName | null = null;

/** Lazy provider singleton. Re-instantiated if the env value changes. */
export function getProvider(): LlmProvider {
  const name = pickProviderName();
  if (cached && cachedName === name) return cached;
  // Resolve synchronously via the statically-imported classes. Both files
  // are bundled together by Next/Turbopack and have no side effects, so
  // there is no win to a dynamic require here.
  if (name === "openrouter") {
    cached = new OpenRouterProvider();
  } else {
    cached = new OllamaProvider();
  }
  cachedName = name;
  return cached;
}

/** Reset the cached provider. Tests use this between cases. */
export function _resetProviderForTests(): void {
  cached = null;
  cachedName = null;
}

/**
 * High-level pipeline: ensure the model is ready, run the chat, parse,
 * validate against the Zod schema. Shared by every provider.
 */
export async function analyzeTranscript(
  transcript: string,
  options: ProviderOptions = {},
): Promise<{ analysis: Analysis; provider: ProviderName; model: string }> {
  const { SYSTEM_PROMPT, buildUserPrompt } = await import("./prompts");
  const { AnalysisSchema } = await import("./schemas");

  const provider = getProvider();
  await provider.ensureReady(options);
  const model = provider.resolveModel(options);
  const text = await provider.chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(transcript) },
    ],
    { ...options, model },
  );
  const raw = extractJson(text);
  const parsed = AnalysisSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LlmError(
      "schema",
      "Model output did not match the expected schema: " + parsed.error.message,
      parsed.error,
    );
  }
  return { analysis: parsed.data, provider: provider.name, model };
}
