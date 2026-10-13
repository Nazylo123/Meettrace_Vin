"use client";

import { useMemo, useState } from "react";
import type { Evidence } from "@/lib/ai/schemas";

interface VerifiedEvidence extends Evidence {
  verified: boolean;
  verifiedStart?: number;
  verifiedEnd?: number;
  reason?: string;
}

interface Props {
  evidence: Evidence[] | VerifiedEvidence[];
  transcript: string;
  itemId: string;
  itemDescription?: string;
}

export default function EvidencePanel({ evidence, transcript, itemId, itemDescription }: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<number | null>(null);

  const verified = useMemo<VerifiedEvidence[]>(() => {
    return (evidence ?? []).map((e) => {
      if (typeof (e as VerifiedEvidence).verified === "boolean") {
        return e as VerifiedEvidence;
      }
      // Fallback: re-verify client-side. The server already did this, but
      // for previously cached results we run the same check.
      return localVerify(e.excerpt, transcript);
    });
  }, [evidence, transcript]);

  if (!verified || verified.length === 0) {
    return (
      <p className="mt-2 text-xs text-amber-700">
        ⚠ Không tìm được đoạn bằng chứng trong transcript — cần người xác nhận.
      </p>
    );
  }

  const okCount = verified.filter((e) => e.verified).length;
  const allOk = okCount === verified.length;

  return (
    <div className="mt-3 rounded-md bg-slate-50 p-2">
      <div className="flex items-center justify-between text-xs text-slate-600">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-left font-medium text-slate-700 hover:underline"
        >
          {open ? "▼" : "▶"} Bằng chứng ({okCount}/{verified.length} đã xác minh)
        </button>
        {!allOk && (
          <span className="tag border border-amber-200 bg-amber-50 text-amber-800">
            Cần xem lại
          </span>
        )}
      </div>

      {open && (
        <ul className="mt-2 space-y-2" data-item-id={itemId}>
          {verified.map((e, i) => (
            <li
              key={i}
              className={`rounded border px-2 py-1.5 text-xs ${
                e.verified
                  ? "border-emerald-200 bg-emerald-50/50"
                  : "border-rose-200 bg-rose-50"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <code
                  className="block max-w-full whitespace-pre-wrap break-words font-mono text-[12px] leading-snug text-slate-800"
                  onMouseEnter={() => setHighlight(i)}
                  onMouseLeave={() => setHighlight(null)}
                >
                  “{e.excerpt}”
                </code>
                {e.verified ? (
                  <span className="tag border border-emerald-200 bg-emerald-50 text-emerald-700">
                    ✓ Khớp
                  </span>
                ) : (
                  <span className="tag border border-rose-200 bg-rose-50 text-rose-700">
                    ⚠ Không khớp
                  </span>
                )}
              </div>
              {e.verified && (
                <div className="mt-1 text-[11px] text-slate-500">
                  Vị trí: ký tự {e.verifiedStart}–{e.verifiedEnd}
                </div>
              )}
              {!e.verified && e.reason && (
                <div className="mt-1 text-[11px] text-rose-700">{e.reason}</div>
              )}
              {e.verified && e.verifiedStart != null && (
                <Snippet
                  transcript={transcript}
                  start={e.verifiedStart}
                  end={e.verifiedEnd!}
                  active={highlight === i}
                />
              )}
            </li>
          ))}
          {itemDescription && (
            <li className="text-[11px] text-slate-500">
              Đoạn trích dùng để hỗ trợ mục: <em>{itemDescription}</em>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function Snippet({
  transcript,
  start,
  end,
  active,
}: {
  transcript: string;
  start: number;
  end: number;
  active: boolean;
}) {
  const before = transcript.slice(Math.max(0, start - 40), start);
  const middle = transcript.slice(start, end);
  const after = transcript.slice(end, Math.min(transcript.length, end + 40));
  return (
    <div className="mt-1 rounded bg-white px-2 py-1 font-mono text-[11px] text-slate-600">
      …{before}
      <mark
        className={`rounded px-0.5 ${
          active ? "bg-yellow-200" : "bg-amber-100"
        }`}
      >
        {middle}
      </mark>
      {after}…
    </div>
  );
}

function localVerify(excerpt: string, transcript: string): VerifiedEvidence {
  if (!excerpt) return { excerpt, verified: false, reason: "Empty excerpt" };
  const idx = transcript.indexOf(excerpt);
  if (idx >= 0) {
    return { excerpt, verified: true, verifiedStart: idx, verifiedEnd: idx + excerpt.length };
  }
  return { excerpt, verified: false, reason: "Không tìm thấy trong transcript" };
}
