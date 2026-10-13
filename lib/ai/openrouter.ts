/**
 * OpenRouter provider.
 * OpenRouter exposes an OpenAI-compatible /chat/completions endpoint, so the
 * request/response shape is standard. We force JSON output via response_format.
 *
 * Env:
 *   OPENROUTER_API_KEY    (required) e.g. sk-or-v1-...
 *   OPENROUTER_MODEL      (optional) defaults to "qwen/qwen-2.5-7b-instruct"
 *   OPENROUTER_BASE_URL   (optional) defaults to https://openrouter.ai/api/v1
 *   MEETTRACE_TIMEOUT_MS  (optional) request timeout in ms
 */

import { LlmError, type LlmProvider, type ChatMessage, type ProviderOptions } from "./provider";

function resolveApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    throw new LlmError(
      "auth",
      "OPENROUTER_API_KEY is not set. Add it to your environment or .env.local.",
    );
  }
  return key;
}

function resolveBaseUrl(): string {
  return (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
}

function resolveDefaultModel(): string {
  return process.env.OPENROUTER_MODEL ?? "qwen/qwen-2.5-7b-instruct";
}

function resolveTimeoutMs(): number {
  const raw = process.env.MEETTRACE_TIMEOUT_MS;
  const n = raw ? Number(raw) : 120_000;
  return Number.isFinite(n) && n > 0 ? n : 120_000;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string; cause?: { code?: string } };
    if (e?.name === "AbortError") {
      throw new LlmError("timeout", `OpenRouter request timed out after ${timeoutMs}ms`);
    }
    if (e?.cause?.code === "ECONNREFUSED" || /ECONNREFUSED|fetch failed/i.test(String(e?.message))) {
      throw new LlmError("unavailable", "OpenRouter is not reachable", err);
    }
    throw new LlmError("http", "Failed to reach OpenRouter: " + (e?.message ?? "unknown"), err);
  } finally {
    clearTimeout(timer);
  }
}

export class OpenRouterProvider implements LlmProvider {
  readonly name = "openrouter" as const;

  resolveModel(options: ProviderOptions = {}): string {
    return options.model ?? resolveDefaultModel();
  }

  async ensureReady(_options: ProviderOptions = {}): Promise<void> {
    // Validate the API key is set + looks plausible. We don't ping OpenRouter
    // here to avoid burning a free-tier request on every page load — the chat
    // call itself will surface auth/connectivity issues with a better error.
    const key = process.env.OPENROUTER_API_KEY?.trim();
    if (!key) {
      throw new LlmError(
        "auth",
        "OPENROUTER_API_KEY is not set. Add it to your environment or .env.local.",
      );
    }
    if (!key.startsWith("sk-or-")) {
      throw new LlmError(
        "auth",
        "OPENROUTER_API_KEY does not look like a valid OpenRouter key (expected prefix 'sk-or-').",
      );
    }
  }

  async chat(messages: ChatMessage[], options: ProviderOptions = {}): Promise<string> {
    const apiKey = resolveApiKey();
    const baseUrl = resolveBaseUrl();
    const model = this.resolveModel(options);
    const timeoutMs = options.timeoutMs ?? resolveTimeoutMs();

    const body = {
      model,
      messages,
      // Encourage deterministic, faithful extraction.
      temperature: 0.1,
      top_p: 0.9,
      // OpenRouter / OpenAI JSON mode: the model is constrained to emit JSON.
      response_format: { type: "json_object" as const },
      // Optional but recommended by OpenRouter for attribution in their dashboard.
      usage: { include: true },
    };

    let res: Response;
    try {
      res = await fetchWithTimeout(
        `${baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            // OpenRouter best-practice headers. Safe to omit but improve routing.
            "HTTP-Referer": process.env.OPENROUTER_REFERER ?? "https://meettrace.local",
            "X-Title": process.env.OPENROUTER_TITLE ?? "MeetTrace",
          },
          body: JSON.stringify(body),
        },
        timeoutMs,
      );
    } catch (err) {
      if (err instanceof LlmError) throw err;
      throw new LlmError("http", "Failed to reach OpenRouter", err);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        throw new LlmError(
          "auth",
          `OpenRouter rejected the API key (HTTP ${res.status}). Check OPENROUTER_API_KEY. Body: ${text.slice(0, 300)}`,
        );
      }
      if (res.status === 404) {
        throw new LlmError(
          "model_missing",
          `OpenRouter model "${model}" not found or not available. Set OPENROUTER_MODEL to a different one. Body: ${text.slice(0, 300)}`,
        );
      }
      if (res.status === 429) {
        throw new LlmError(
          "rate_limit",
          `OpenRouter rate limit hit (HTTP 429). Try again later or switch model. Body: ${text.slice(0, 300)}`,
        );
      }
      throw new LlmError("http", `OpenRouter returned HTTP ${res.status}: ${text.slice(0, 500)}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data?.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) {
      throw new LlmError("empty", "OpenRouter returned an empty message body");
    }
    return content;
  }
}
