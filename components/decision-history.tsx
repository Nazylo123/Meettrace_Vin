"use client";

import type { DecisionHistoryItem } from "@/lib/ai/schemas";
import EvidencePanel from "./evidence-panel";
import { STATUS_LABEL } from "@/lib/analysis/decision-tracking";

interface Overrides {
  [id: string]: { description?: string; confirmed?: boolean; flagged?: boolean };
}

interface Props {
  items: DecisionHistoryItem[];
  overrides: Overrides;
  onOverride: (
    id: string,
    patch: Partial<{ description: string; confirmed: boolean; flagged: boolean }>,
  ) => void;
  onClearOverride: (id: string) => void;
  transcript: string;
}

const STATUS_DOT: Record<string, string> = {
  proposed: "bg-sky-500",
  challenged: "bg-rose-500",
  confirmed: "bg-emerald-500",
  superseded: "bg-slate-300",
  rejected: "bg-rose-700",
  open: "bg-amber-500",
};

export default function DecisionHistory({
  items,
  overrides,
  onOverride,
  onClearOverride,
  transcript,
}: Props) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-400">Không có dòng thời gian quyết định nào.</p>;
  }
  return (
    <ol className="relative space-y-3 border-l border-slate-200 pl-4">
      {items.map((item) => {
        const description = overrides[item.id]?.description ?? item.description;
        const isFinal = item.isFinal === true;
        const isFlagged = overrides[item.id]?.flagged ?? item.needsReview === true;
        const isConfirmed = overrides[item.id]?.confirmed ?? isFinal;
        const humanTouched = Boolean(overrides[item.id]);
        const dot = STATUS_DOT[item.status] ?? "bg-slate-300";
        return (
          <li key={item.id} className="relative">
            <span
              className={`absolute -left-[21px] top-2 inline-block h-3 w-3 rounded-full ring-2 ring-white ${dot}`}
              aria-hidden
            />
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <textarea
                  value={description}
                  rows={Math.max(1, Math.min(3, Math.ceil(description.length / 80)))}
                  onChange={(e) => onOverride(item.id, { description: e.target.value })}
                  className="input-base text-sm"
                  aria-label="Mô tả quyết định"
                />
                <span
                  className={`tag ${
                    item.status === "confirmed"
                      ? "bg-emerald-100 text-emerald-700"
                      : item.status === "superseded" || item.status === "rejected"
                        ? "bg-slate-200 text-slate-600"
                        : item.status === "challenged"
                          ? "bg-rose-100 text-rose-700"
                          : item.status === "proposed"
                            ? "bg-sky-100 text-sky-700"
                            : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {isFinal ? "Final · " : ""}
                  {STATUS_LABEL[item.status] ?? item.status}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                {item.assignee && (
                  <span className="tag bg-slate-100 text-slate-700">Người phụ trách: {item.assignee}</span>
                )}
                {item.deadline && (
                  <span className="tag bg-slate-100 text-slate-700">Deadline: {item.deadline}</span>
                )}
                {humanTouched && (
                  <span className="tag bg-emerald-50 text-emerald-700">Đã chỉnh bởi người</span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => onOverride(item.id, { confirmed: !isConfirmed })}
                  className={`btn-secondary px-2 py-1 text-xs ${
                    isConfirmed ? "border-emerald-300 bg-emerald-50 text-emerald-700" : ""
                  }`}
                >
                  {isConfirmed ? "✓ Đã xác nhận" : "Xác nhận"}
                </button>
                <button
                  type="button"
                  onClick={() => onOverride(item.id, { flagged: !isFlagged })}
                  className={`btn-secondary px-2 py-1 text-xs ${
                    isFlagged ? "border-amber-300 bg-amber-50 text-amber-700" : ""
                  }`}
                >
                  {isFlagged ? "⚠ Đang chờ xem" : "Cần xem lại"}
                </button>
                {humanTouched && (
                  <button
                    type="button"
                    onClick={() => onClearOverride(item.id)}
                    className="text-xs text-slate-400 underline-offset-2 hover:underline"
                  >
                    Khôi phục bản AI
                  </button>
                )}
              </div>
              <EvidencePanel
                evidence={item.evidence}
                transcript={transcript}
                itemId={item.id}
                itemDescription={description}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
