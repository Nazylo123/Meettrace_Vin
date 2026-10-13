"use client";

import { useCallback, useEffect, useState } from "react";

interface Props {
  value: string;
  onChange: (next: string) => void;
  onAnalyze: () => void;
  onReset: () => void;
  onLoadSample: (text: string) => void;
  isLoading: boolean;
  error: string | null;
}

const MAX_RECOMMENDED = 60_000;

export default function TranscriptInput({
  value,
  onChange,
  onAnalyze,
  onReset,
  onLoadSample,
  isLoading,
  error,
}: Props) {
  const [samples, setSamples] = useState<{ clear: string; ambiguous: string }>({
    clear: "",
    ambiguous: "",
  });
  const [samplesLoaded, setSamplesLoaded] = useState(false);

  useEffect(() => {
    if (samplesLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const [clearRes, ambRes] = await Promise.all([
          fetch("/samples/clear-decision.txt"),
          fetch("/samples/ambiguous-decision.txt"),
        ]);
        const [clear, ambiguous] = await Promise.all([
          clearRes.ok ? clearRes.text() : Promise.resolve(""),
          ambRes.ok ? ambRes.text() : Promise.resolve(""),
        ]);
        if (!cancelled) {
          setSamples({ clear, ambiguous });
          setSamplesLoaded(true);
        }
      } catch {
        if (!cancelled) setSamplesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [samplesLoaded]);

  const chars = value.length;
  const tooLong = chars > MAX_RECOMMENDED;
  const canAnalyze = value.trim().length > 0 && !isLoading && !tooLong;

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (canAnalyze) onAnalyze();
      }
    },
    [canAnalyze, onAnalyze],
  );

  return (
    <div className="card flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-800">Transcript cuộc họp</h2>
        <span
          className={`text-xs ${
            tooLong ? "font-semibold text-rose-600" : "text-slate-400"
          }`}
        >
          {chars.toLocaleString()} / {MAX_RECOMMENDED.toLocaleString()} ký tự
        </span>
      </div>

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKey}
        spellCheck={false}
        placeholder="Dán toàn bộ nội dung cuộc họp vào đây. Không cần timestamp hoặc nhãn người nói…"
        className="input-base min-h-[260px] flex-1 resize-y font-mono text-sm leading-relaxed"
      />

      {tooLong && (
        <p className="mt-2 text-xs text-rose-600">
          Transcript vượt giới hạn. Hãy rút gọn hoặc chia thành nhiều phần.
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
        >
          {error}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={!canAnalyze}
          onClick={onAnalyze}
        >
          {isLoading ? "Đang phân tích…" : "Phân tích cuộc họp"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={onReset}
          disabled={isLoading && !value}
        >
          Xoá
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={!samples.clear}
            onClick={() => onLoadSample(samples.clear)}
          >
            Mẫu: chốt rõ
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!samples.ambiguous}
            onClick={() => onLoadSample(samples.ambiguous)}
          >
            Mẫu: mơ hồ
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Mẹo: nhấn <kbd className="rounded border border-slate-200 bg-slate-50 px-1">Ctrl/⌘ + Enter</kbd> để phân tích.
      </p>
    </div>
  );
}
