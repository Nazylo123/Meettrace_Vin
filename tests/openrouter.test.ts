import { describe, expect, it, vi, beforeEach } from "vitest";
import { LlmError, _resetProviderForTests } from "@/lib/ai";

/**
 * The OpenRouter provider talks to https://openrouter.ai/api/v1/chat/completions.
 * We never call the real network — instead we stub fetch with canned responses
 * that match OpenRouter's OpenAI-compatible shape.
 */

const SAMPLE_TRANSCRIPT =
  "An initially proposed PostgreSQL. Binh argued SQL Server was a better fit because the company already uses it. After discussion, the manager decided to use SQL Server.";

const OPENAI_SHAPED_RESPONSE = {
  id: "gen-1",
  choices: [
    {
      message: { role: "assistant", content: '{"summary":"ok"}' },
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

describe("OpenRouterProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.LLM_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-fake-test-key";
    process.env.OPENROUTER_MODEL = "qwen/qwen-2.5-7b-instruct";
    delete process.env.OPENROUTER_BASE_URL;
    _resetProviderForTests();
  });

  it("ensureReady throws auth error when key is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    _resetProviderForTests();
    const { getProvider } = await import("@/lib/ai");
    await expect(getProvider().ensureReady()).rejects.toMatchObject({ kind: "auth" });
  });

  it("ensureReady throws auth error when key has wrong prefix", async () => {
    process.env.OPENROUTER_API_KEY = "sk-wrong-prefix";
    _resetProviderForTests();
    const { getProvider } = await import("@/lib/ai");
    await expect(getProvider().ensureReady()).rejects.toMatchObject({ kind: "auth" });
  });

  it("ensureReady passes when key looks valid", async () => {
    const { getProvider } = await import("@/lib/ai");
    await expect(getProvider().ensureReady()).resolves.toBeUndefined();
  });

  it("chat returns the assistant content on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify(OPENAI_SHAPED_RESPONSE), { status: 200 });
      }),
    );
    const { getProvider } = await import("@/lib/ai");
    const provider = getProvider();
    expect(provider.name).toBe("openrouter");
    const text = await provider.chat([
      { role: "system", content: "you are a parser" },
      { role: "user", content: SAMPLE_TRANSCRIPT },
    ]);
    expect(text).toBe('{"summary":"ok"}');
  });

  it("chat sends Authorization header and JSON body shape", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify(OPENAI_SHAPED_RESPONSE), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { getProvider } = await import("@/lib/ai");
    await getProvider().chat([{ role: "user", content: "hi" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toContain("/chat/completions");
    expect(url).toContain("openrouter.ai");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-or-v1-fake-test-key");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("qwen/qwen-2.5-7b-instruct");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].role).toBe("user");
  });

  it("surfaces model_missing on HTTP 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({ error: { message: "model not found" } }),
          { status: 404 },
        );
      }),
    );
    const { getProvider } = await import("@/lib/ai");
    await expect(
      getProvider().chat([{ role: "user", content: "x" }]),
    ).rejects.toMatchObject({ kind: "model_missing" });
  });

  it("surfaces auth error on HTTP 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response("unauthorized", { status: 401 });
      }),
    );
    const { getProvider } = await import("@/lib/ai");
    await expect(
      getProvider().chat([{ role: "user", content: "x" }]),
    ).rejects.toMatchObject({ kind: "auth" });
  });

  it("surfaces rate_limit on HTTP 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response("rate limited", { status: 429 });
      }),
    );
    const { getProvider } = await import("@/lib/ai");
    await expect(
      getProvider().chat([{ role: "user", content: "x" }]),
    ).rejects.toMatchObject({ kind: "rate_limit" });
  });

  it("surfaces empty error when response has no content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ choices: [{ message: { content: "  " } }] }), {
          status: 200,
        });
      }),
    );
    const { getProvider } = await import("@/lib/ai");
    await expect(
      getProvider().chat([{ role: "user", content: "x" }]),
    ).rejects.toMatchObject({ kind: "empty" });
  });

  it("LlmError carries the right kind on parse failures", () => {
    try {
      throw new LlmError("parse", "bad json");
    } catch (e) {
      expect(e).toBeInstanceOf(LlmError);
      expect((e as LlmError).kind).toBe("parse");
    }
  });
});
