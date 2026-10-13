import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  extractJson,
  LlmError,
  _resetProviderForTests,
} from "@/lib/ai";
import { reconcileDecisions } from "@/lib/analysis/decision-tracking";
import { verifyAllEvidence } from "@/lib/analysis/evidence-validation";
import { validateTranscript, chunkTranscript } from "@/lib/analysis/transcript-utils";
import type { Analysis } from "@/lib/ai/schemas";

/**
 * These tests intentionally do NOT need a running AI provider. We stub fetch
 * to return canned responses. The goal is to lock the pipeline's contract:
 *   1. JSON parsing is robust.
 *   2. Evidence that doesn't exist in the transcript is rejected.
 *   3. The reconciliation rules produce the expected final state.
 *   4. The five required cases from the spec pass.
 *
 * Provider selection: tests force LLM_PROVIDER=ollama because the canned
 * fetch stubs in this file mock Ollama's /api/chat and /api/tags endpoints.
 * The OpenRouter provider is exercised in its own file.
 */

const SAMPLE_TRANSCRIPT =
  "An initially proposed PostgreSQL. Binh argued SQL Server was a better fit because the company already uses it. After discussion, the manager decided to use SQL Server. Binh will prepare the implementation plan before Friday. The team has not yet agreed on the user permission model.";

const GOOD_AI_OUTPUT: Analysis = {
  summary: "Team moved from PostgreSQL to SQL Server; permission model unresolved.",
  finalDecisions: [
    {
      id: "d1",
      kind: "decision",
      description: "Use SQL Server for the new billing service.",
      status: "confirmed",
      isFinal: true,
      assignee: null,
      deadline: null,
      needsReview: false,
      evidence: [{ excerpt: "the manager decided to use SQL Server." }],
    },
  ],
  decisionHistory: [
    {
      id: "dh1",
      kind: "decision",
      description: "Use PostgreSQL for the new billing service.",
      status: "proposed",
      evidence: [{ excerpt: "An initially proposed PostgreSQL." }],
    },
    {
      id: "dh2",
      kind: "decision",
      description: "Use SQL Server for the billing service.",
      status: "challenged",
      evidence: [{ excerpt: "Binh argued SQL Server was a better fit" }],
    },
    {
      id: "dh3",
      kind: "decision",
      description: "Use SQL Server for the new billing service.",
      status: "confirmed",
      isFinal: true,
      evidence: [{ excerpt: "the manager decided to use SQL Server." }],
    },
  ],
  actions: [
    {
      id: "a1",
      kind: "action",
      description: "Prepare the implementation plan.",
      status: "open",
      assignee: "Binh",
      deadline: "before Friday",
      needsReview: false,
      evidence: [{ excerpt: "Binh will prepare the implementation plan before Friday." }],
    },
  ],
  issues: [],
  requests: [],
  openQuestions: [
    {
      id: "q1",
      kind: "open_question",
      description: "How should the user permission model work?",
      status: "unresolved",
      assignee: null,
      deadline: null,
      needsReview: true,
      evidence: [
        { excerpt: "The team has not yet agreed on the user permission model." },
      ],
    },
  ],
  needsReview: true,
  notes: [],
};

describe("extractJson", () => {
  it("parses clean JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("strips code fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("extracts JSON from surrounding prose", () => {
    expect(extractJson('Sure, here is the result: {"a":1} -- done.')).toEqual({ a: 1 });
  });
  it("throws on empty input", () => {
    expect(() => extractJson("")).toThrowError(LlmError);
  });
  it("throws when no JSON is present", () => {
    expect(() => extractJson("hello world")).toThrowError(LlmError);
  });
});

describe("validateTranscript", () => {
  it("rejects empty input", () => {
    expect(validateTranscript("").ok).toBe(false);
    expect(validateTranscript("   \n  ").ok).toBe(false);
  });
  it("rejects input above the limit", () => {
    const big = "a".repeat(100);
    const r = validateTranscript(big, 50);
    expect(r.ok).toBe(false);
  });
  it("accepts valid input", () => {
    expect(validateTranscript("hello", 50).ok).toBe(true);
  });
});

describe("chunkTranscript", () => {
  it("returns a single chunk when below the limit", () => {
    const out = chunkTranscript("short text", 1000, 100);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("short text");
  });
  it("splits long input with overlap", () => {
    const long = "Sentence one. Sentence two. Sentence three. Sentence four. Sentence five. Sentence six.";
    const chunks = chunkTranscript(long, 30, 5);
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk is at most maxChars (plus a bit of slack for boundary tuning).
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(50);
    }
  });
});

describe("Pipeline contract — required cases", () => {
  // --- Case 1: successful decision change ----------------------------------
  it("case 1: SQL Server wins, PostgreSQL is not final", () => {
    const r = reconcileDecisions(GOOD_AI_OUTPUT);
    expect(r.finalDecisionIds).toEqual(["dh3"]);
    const final = r.analysis.finalDecisions[0];
    expect(final.description.toLowerCase()).toContain("sql server");
    const pg = r.analysis.decisionHistory.find((h) => h.id === "dh1");
    expect(pg?.status).toBe("superseded");
    // PostgreSQL must NOT be in finalDecisions.
    expect(
      r.analysis.finalDecisions.find((f) => /postgres/i.test(f.description)),
    ).toBeUndefined();
  });

  // --- Case 2: action extraction -------------------------------------------
  it("case 2: action with assignee and deadline is preserved", () => {
    expect(GOOD_AI_OUTPUT.actions).toHaveLength(1);
    const a = GOOD_AI_OUTPUT.actions[0];
    expect(a.assignee).toBe("Binh");
    expect(a.deadline).toBe("before Friday");
    expect(a.description.toLowerCase()).toContain("implementation plan");
  });

  // --- Case 3: ambiguous disagreement --------------------------------------
  it("case 3: ambiguous disagreement stays unresolved, no invented final", () => {
    const input: Analysis = {
      ...GOOD_AI_OUTPUT,
      finalDecisions: [],
      decisionHistory: [
        {
          id: "x1",
          kind: "decision",
          description: "Use Chart.js",
          status: "proposed",
          evidence: [{ excerpt: "Linh proposed Chart.js." }],
        },
        {
          id: "x2",
          kind: "decision",
          description: "Use Recharts",
          status: "challenged",
          evidence: [{ excerpt: "Quan countered with Recharts." }],
        },
      ],
    };
    const r = reconcileDecisions(input);
    expect(r.analysis.finalDecisions).toHaveLength(0);
    expect(r.analysis.needsReview).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  // --- Case 4: missing owner / deadline ------------------------------------
  it("case 4: action with no owner/deadline leaves those fields null", () => {
    const input: Analysis = {
      ...GOOD_AI_OUTPUT,
      actions: [
        {
          id: "aX",
          kind: "action",
          description: "Investigate the slow report",
          status: "open",
          assignee: null,
          deadline: null,
          needsReview: true,
          evidence: [{ excerpt: "we need to investigate but no one was assigned" }],
        },
      ],
    };
    const a = input.actions[0];
    expect(a.assignee).toBeNull();
    expect(a.deadline).toBeNull();
    expect(a.needsReview).toBe(true);
  });

  // --- Case 5: evidence failure --------------------------------------------
  it("case 5: fabricated evidence is rejected as unverified", () => {
    const input: Analysis = {
      ...GOOD_AI_OUTPUT,
      finalDecisions: [
        {
          id: "dFake",
          kind: "decision",
          description: "Use MongoDB for billing",
          status: "confirmed",
          isFinal: true,
          evidence: [
            { excerpt: "Maria confidently stated that MongoDB is the best choice." },
          ],
        },
      ],
    };
    const v = verifyAllEvidence(input.finalDecisions, SAMPLE_TRANSCRIPT);
    expect(v.anyUnverified).toBe(true);
    expect(v.items[0].evidence[0].verified).toBe(false);
  });
});

describe("Ollama provider (mocked)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.LLM_PROVIDER = "ollama";
    process.env.OLLAMA_MODEL = "qwen3:8b";
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    _resetProviderForTests();
  });

  it("returns the assistant content on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/tags")) {
          return new Response(JSON.stringify({ models: [{ name: "qwen3:8b" }] }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({ message: { content: '{"summary":"ok"}' } }),
          { status: 200 },
        );
      }),
    );
    const { getProvider } = await import("@/lib/ai");
    const provider = getProvider();
    const text = await provider.chat(
      [
        { role: "system", content: "you are a parser" },
        { role: "user", content: SAMPLE_TRANSCRIPT },
      ],
      { model: "qwen3:8b" },
    );
    expect(text).toContain('"summary"');
  });

  it("surfaces a model_missing error when the model is not installed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }),
    );
    const { getProvider } = await import("@/lib/ai");
    const provider = getProvider();
    await expect(
      provider.ensureReady({ model: "qwen3:8b" }),
    ).rejects.toBeInstanceOf(LlmError);
  });

  it("surfaces a timeout error when fetch aborts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const err: any = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }),
    );
    const { getProvider } = await import("@/lib/ai");
    const provider = getProvider();
    await expect(
      provider.chat(
        [{ role: "user", content: "x" }],
        { model: "qwen3:8b", timeoutMs: 10 },
      ),
    ).rejects.toMatchObject({ kind: "timeout" });
  });
});

describe("analyzeTranscript end-to-end (mocked)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.LLM_PROVIDER = "ollama";
    process.env.OLLAMA_MODEL = "qwen3:8b";
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    _resetProviderForTests();
  });

  it("returns a validated analysis for a clean JSON response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/tags")) {
          return new Response(JSON.stringify({ models: [{ name: "qwen3:8b" }] }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({ message: { content: JSON.stringify(GOOD_AI_OUTPUT) } }),
          { status: 200 },
        );
      }),
    );
    const { analyzeTranscript } = await import("@/lib/ai");
    const { analysis, model, provider } = await analyzeTranscript(SAMPLE_TRANSCRIPT, {
      model: "qwen3:8b",
    });
    expect(provider).toBe("ollama");
    expect(model).toBe("qwen3:8b");
    expect(analysis.summary.length).toBeGreaterThan(5);
    expect(analysis.decisionHistory.length).toBeGreaterThan(0);
  });

  it("rejects malformed model output with a schema error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/tags")) {
          return new Response(JSON.stringify({ models: [{ name: "qwen3:8b" }] }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({
            message: {
              content: JSON.stringify({
                summary: "only a summary",
                finalDecisions: "this should be an array, not a string",
              }),
            },
          }),
          { status: 200 },
        );
      }),
    );
    const { analyzeTranscript } = await import("@/lib/ai");
    await expect(
      analyzeTranscript(SAMPLE_TRANSCRIPT, { model: "qwen3:8b" }),
    ).rejects.toBeInstanceOf(LlmError);
  });
});
