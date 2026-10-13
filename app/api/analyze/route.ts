import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  analyzeTranscript,
  LlmError,
  getProvider,
} from "@/lib/ai";
import { reconcileDecisions } from "@/lib/analysis/decision-tracking";
import { verifyAllEvidence } from "@/lib/analysis/evidence-validation";
import { validateTranscript, DEFAULT_MAX_CHARS } from "@/lib/analysis/transcript-utils";
import { AnalyzeResponseSchema, type Analysis } from "@/lib/ai/schemas";

// Avoid running the route on edge — we need Node fetch + long timeouts.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestBodySchema = z.object({
  transcript: z.string(),
  model: z.string().optional(),
});

const ERROR_KIND_TO_STATUS: Record<string, number> = {
  unavailable: 503,
  model_missing: 412,
  timeout: 504,
  empty: 502,
  parse: 502,
  schema: 502,
  http: 502,
  auth: 401,
  rate_limit: 429,
};

export async function POST(req: NextRequest) {
  let body: z.infer<typeof RequestBodySchema>;
  try {
    const raw = (await req.json()) as unknown;
    body = RequestBodySchema.parse(raw);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "Invalid request body. Expected JSON { transcript: string }." },
      { status: 400 },
    );
  }

  const validation = validateTranscript(body.transcript, DEFAULT_MAX_CHARS);
  if (!validation.ok) {
    return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
  }

  // Pre-flight: tell the user early if the provider or model is missing,
  // rather than burning minutes on a long generation that will fail.
  try {
    await getProvider().ensureReady(body.model ? { model: body.model } : undefined);
  } catch (err) {
    if (err instanceof LlmError) {
      return NextResponse.json(
        { ok: false, error: err.message, kind: err.kind, provider: getProvider().name },
        { status: ERROR_KIND_TO_STATUS[err.kind] ?? 500 },
      );
    }
    const provider = getProvider().name;
    return NextResponse.json(
      {
        ok: false,
        error:
          provider === "ollama"
            ? "Could not reach local Ollama service."
            : "Could not reach the configured AI provider.",
        provider,
      },
      { status: 503 },
    );
  }

  try {
    const { analysis, model, provider } = await analyzeTranscript(
      validation.text,
      body.model ? { model: body.model } : undefined,
    );
    const reconciled = reconcileDecisions(analysis);

    // Re-verify every evidence item against the *original* transcript. The
    // model sees the same text we send, but we still don't trust it.
    const targets: { evidence?: { excerpt: string; startChar?: number; endChar?: number }[] }[] = [
      ...reconciled.analysis.finalDecisions,
      ...reconciled.analysis.decisionHistory,
      ...reconciled.analysis.actions,
      ...reconciled.analysis.issues,
      ...reconciled.analysis.requests,
      ...reconciled.analysis.openQuestions,
    ];
    const verified = verifyAllEvidence(targets, validation.text);

    // Splice verified evidence back into each section.
    let cursor = 0;
    const splice = <T extends { evidence: any[] }>(arr: T[]): T[] => {
      return arr.map((item) => {
        const ev = verified.items[cursor++];
        return { ...item, evidence: ev.evidence };
      });
    };

    const finalAnalysis: Analysis = {
      ...reconciled.analysis,
      finalDecisions: splice(reconciled.analysis.finalDecisions as any),
      decisionHistory: splice(reconciled.analysis.decisionHistory as any),
      actions: splice(reconciled.analysis.actions as any),
      issues: splice(reconciled.analysis.issues as any),
      requests: splice(reconciled.analysis.requests as any),
      openQuestions: splice(reconciled.analysis.openQuestions as any),
      needsReview: reconciled.analysis.needsReview || verified.anyUnverified,
    };

    const response = AnalyzeResponseSchema.parse({
      ok: true,
      model,
      analysis: finalAnalysis,
    });

    // Stamp the provider into a response header so the UI can show it.
    return NextResponse.json(response, {
      status: 200,
      headers: { "x-llm-provider": provider },
    });
  } catch (err) {
    if (err instanceof LlmError) {
      return NextResponse.json(
        { ok: false, error: err.message, kind: err.kind, provider: getProvider().name },
        { status: ERROR_KIND_TO_STATUS[err.kind] ?? 500 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: "Unexpected error: " + message, provider: getProvider().name },
      { status: 500 },
    );
  }
}

export async function GET() {
  const provider = getProvider();
  const defaultModel =
    provider.name === "openrouter"
      ? process.env.OPENROUTER_MODEL || "qwen/qwen-2.5-7b-instruct"
      : process.env.OLLAMA_MODEL || "qwen3:8b";
  return NextResponse.json({
    ok: true,
    info: "POST a JSON body { transcript: string } to analyze a meeting.",
    provider: provider.name,
    model: defaultModel,
    maxChars: DEFAULT_MAX_CHARS,
  });
}
