"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TranscriptInput from "@/components/transcript-input";
import AnalysisResults from "@/components/analysis-results";
import type { AnalyzeResponse } from "@/lib/ai/schemas";

const LS_KEY = "meettrace:state:v1";

interface PersistedState {
  transcript: string;
  response: AnalyzeResponse | null;
  // Track which items the user has manually edited or confirmed.
  overrides: Record<string, { description?: string; confirmed?: boolean; flagged?: boolean }>;
}

export default function HomePage() {
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState<AnalyzeResponse | null>(null);
  const [overrides, setOverrides] = useState<PersistedState["overrides"]>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string>("qwen3:8b");

  // Hydrate from localStorage. Guarded for SSR safety and malformed data.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedState;
      if (typeof parsed.transcript === "string") setTranscript(parsed.transcript);
      if (parsed.response && typeof parsed.response === "object") setResponse(parsed.response);
      if (parsed.overrides && typeof parsed.overrides === "object") setOverrides(parsed.overrides);
      if (parsed.response?.model) setModelName(parsed.response.model);
    } catch {
      // Corrupt localStorage — silently drop it. MVP doesn't try to recover.
      try {
        window.localStorage.removeItem(LS_KEY);
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        LS_KEY,
        JSON.stringify({ transcript, response, overrides } satisfies PersistedState),
      );
    } catch {
      /* quota or disabled — ignore */
    }
  }, [transcript, response, overrides]);

  const handleAnalyze = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      const data = (await res.json()) as AnalyzeResponse | { ok: false; error?: string };
      if (!res.ok || (data as { ok?: boolean }).ok === false) {
        throw new Error(
          (data as { error?: string }).error ||
            `Request failed with status ${res.status}`,
        );
      }
      setResponse(data as AnalyzeResponse);
      setModelName((data as AnalyzeResponse).model);
      setOverrides({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setIsLoading(false);
    }
  }, [transcript]);

  const handleReset = useCallback(() => {
    setTranscript("");
    setResponse(null);
    setOverrides({});
    setError(null);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(LS_KEY);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const handleLoadSample = useCallback((text: string) => {
    setTranscript(text);
    setError(null);
  }, []);

  const handleOverride = useCallback((id: string, patch: Partial<{ description: string; confirmed: boolean; flagged: boolean }>) => {
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const clearOverride = useCallback((id: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const showResults = useMemo(() => Boolean(response?.analysis), [response]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            MeetTrace
            <span className="ml-3 align-middle text-sm font-medium text-brand-600">
              AI Meeting Intelligence
            </span>
          </h1>
          <span
            className="tag border border-emerald-200 bg-emerald-50 text-emerald-700"
            title="Tất cả inference chạy cục bộ qua Ollama — không gửi dữ liệu ra ngoài."
          >
            <span className="mr-1.5 h-2 w-2 rounded-full bg-emerald-500" />
            Local · {modelName}
          </span>
        </div>
        <p className="mt-3 max-w-3xl text-slate-600">
          Biến văn bản cuộc họp thô thành các quyết định có thể truy vết, đầu việc rõ ràng và
          bằng chứng nguyên văn. MeetTrace theo dõi cách một ý tưởng tiến hóa từ đề xuất ban đầu
          đến quyết định cuối cùng — và đánh dấu những chỗ cần con người xác nhận.
        </p>
      </header>

      <section className="grid gap-6 lg:grid-cols-2">
        <TranscriptInput
          value={transcript}
          onChange={setTranscript}
          onAnalyze={handleAnalyze}
          onReset={handleReset}
          onLoadSample={handleLoadSample}
          isLoading={isLoading}
          error={error}
        />

        <div className="card min-h-[300px]">
          {isLoading ? (
            <LoadingState />
          ) : showResults ? (
            <AnalysisResults
              response={response!}
              overrides={overrides}
              onOverride={handleOverride}
              onClearOverride={clearOverride}
              transcript={transcript}
            />
          ) : (
            <EmptyState />
          )}
        </div>
      </section>

      <footer className="mt-10 text-center text-xs text-slate-400">
        MVP · Inference chạy cục bộ qua Ollama · Không có API key, không gửi dữ liệu ra ngoài
      </footer>
    </main>
  );
}

function LoadingState() {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 text-slate-500">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
      <p className="text-sm">Đang gọi Ollama và xác minh bằng chứng…</p>
      <p className="max-w-sm text-center text-xs text-slate-400">
        Có thể mất 5–60 giây tuỳ độ dài transcript và máy của bạn.
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 text-slate-400">
      <p className="text-sm font-medium text-slate-500">Chưa có kết quả phân tích.</p>
      <p className="max-w-sm text-center text-xs">
        Dán transcript, bấm <span className="font-semibold">Phân tích cuộc họp</span> và chờ
        MeetTrace tách các quyết định, đầu việc và bằng chứng.
      </p>
    </div>
  );
}
