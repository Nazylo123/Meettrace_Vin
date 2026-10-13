/**
 * Ollama provider (local). Same contract as OpenRouterProvider, so the
 * route handler is provider-agnostic.
 *
 * Env:
 *   OLLAMA_BASE_URL  (optional) defaults to http://127.0.0.1:11434
 *   OLLAMA_MODEL     (optional) defaults to qwen3:8b
 *   MEETTRACE_TIMEOUT_MS (optional) request timeout in ms
 */

import { LlmError, type LlmProvider, type ChatMessage, type ProviderOptions } from "./provider";

function resolveBaseUrl(): string {
  return process.env.OLLAMA_BASE_URL?.replace(/\/$/, "") || "http://127.0.0.1:11434";
}

function resolveDefaultModel(): string {
  return process.env.OLLAMA_MODEL || "qwen3:8b";
}

function resolveTimeoutMs(): number {
  const raw = process.env.MEETTRACE_TIMEOUT_MS;
  const n = raw ? Number(raw) : 360_000;
  return Number.isFinite(n) && n > 0 ? n : 360_000;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string; cause?: { code?: string } };
    if (e?.name === "AbortError") {
      throw new LlmError("timeout", `Ollama request timed out after ${timeoutMs}ms`);
    }
    if (e?.cause?.code === "ECONNREFUSED" || /ECONNREFUSED|fetch failed/i.test(String(e?.message))) {
      throw new LlmError("unavailable", "Ollama is not reachable at " + url, err);
    }
    throw new LlmError("http", "Failed to reach Ollama: " + (e?.message ?? "unknown"), err);
  } finally {
    clearTimeout(timer);
  }
}

export class OllamaProvider implements LlmProvider {
  readonly name = "ollama" as const;

  resolveModel(options: ProviderOptions = {}): string {
    return options.model ?? resolveDefaultModel();
  }

  async ensureReady(_options: ProviderOptions = {}): Promise<void> {
    const baseUrl = resolveBaseUrl();
    const model = this.resolveModel();
    try {
      const res = await fetchWithTimeout(`${baseUrl}/api/tags`, { method: "GET" }, 10_000);
      if (!res.ok) {
        throw new LlmError("http", `Ollama /api/tags returned ${res.status}`);
      }
      const data = (await res.json()) as { models?: { name: string }[] };
      const installed = (data.models ?? []).map((m) => m.name);
      if (!installed.some((name) => name === model || name.startsWith(model + ":"))) {
        throw new LlmError(
          "model_missing",
          `Model "${model}" is not installed locally. Run: ollama pull ${model}`,
        );
      }
    } catch (err) {
      if (err instanceof LlmError) throw err;
      throw new LlmError("unavailable", "Could not verify Ollama model", err);
    }
  }

  async chat(messages: ChatMessage[], options: ProviderOptions = {}): Promise<string> {
    const baseUrl = resolveBaseUrl();
    const model = this.resolveModel(options);
    const timeoutMs = options.timeoutMs ?? resolveTimeoutMs();

    const body = {
      model,
      messages,
      stream: false,
      format: "json",
      options: {
        temperature: 0.1,
        top_p: 0.9,
        repeat_penalty: 1.05,
      },
    };

    const res = await fetchWithTimeout(
      `${baseUrl}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      timeoutMs,
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (/model['\s]+['"]?not found/i.test(text) || /not found/i.test(text)) {
        throw new LlmError(
          "model_missing",
          `Model "${model}" is not installed. Run: ollama pull ${model}. Server said: ${text}`,
        );
      }
      throw new LlmError("http", `Ollama returned HTTP ${res.status}: ${text.slice(0, 500)}`);
    }

    const data = (await res.json()) as { message?: { content?: string } };
    const content = data?.message?.content ?? "";
    if (!content.trim()) {
      throw new LlmError("empty", "Ollama returned an empty message body");
    }
    return content;
  }
}
