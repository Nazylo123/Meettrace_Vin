"use client";

import { useMemo } from "react";
import type {
  ActionItem,
  AnalyzeResponse,
  DecisionHistoryItem,
  FinalDecisionItem,
  IssueItem,
  OpenQuestionItem,
  RequestItem,
} from "@/lib/ai/schemas";
import DecisionHistory from "./decision-history";
import EvidencePanel from "./evidence-panel";
import { STATUS_LABEL } from "@/lib/analysis/decision-tracking";

interface Overrides {
  [id: string]: { description?: string; confirmed?: boolean; flagged?: boolean };
}

interface Props {
  response: AnalyzeResponse;
  overrides: Overrides;
  onOverride: (
    id: string,
    patch: Partial<{ description: string; confirmed: boolean; flagged: boolean }>,
  ) => void;
  onClearOverride: (id: string) => void;
  transcript: string;
}

export default function AnalysisResults({
  response,
  overrides,
  onOverride,
  onClearOverride,
  transcript,
}: Props) {
  const { analysis, model } = response;

  const summary = useMemo(() => analysis.summary, [analysis.summary]);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-800">Kết quả phân tích</h2>
        <span className="text-xs text-slate-400">Model: {model}</span>
      </div>

      {analysis.needsReview && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Một số mục cần con người xác nhận — bằng chứng không khớp hoặc thông tin bị mơ hồ.
        </div>
      )}

      {summary && (
        <p className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <span className="font-semibold">Tóm tắt:</span> {summary}
        </p>
      )}

      <div className="flex-1 space-y-5 overflow-y-auto pr-1">
        <Section
          title="1. Quyết định cuối"
          emptyText="Chưa có quyết định nào được chốt rõ ràng."
          items={analysis.finalDecisions}
          renderItem={(item) => (
            <FinalDecisionCard
              key={item.id}
              item={item}
              override={overrides[item.id]}
              onOverride={onOverride}
              onClearOverride={onClearOverride}
              transcript={transcript}
            />
          )}
        />

        <Section
          title="2. Lịch sử quyết định"
          emptyText="Không có dòng thời gian quyết định nào."
        >
          <DecisionHistory
            items={analysis.decisionHistory}
            overrides={overrides}
            onOverride={onOverride}
            onClearOverride={onClearOverride}
            transcript={transcript}
          />
        </Section>

        <Section
          title="3. Đầu việc (Action items)"
          emptyText="Không có đầu việc nào."
          items={analysis.actions}
          renderItem={(item) => (
            <GenericCard
              key={item.id}
              kind="action"
              item={item}
              override={overrides[item.id]}
              onOverride={onOverride}
              onClearOverride={onClearOverride}
              transcript={transcript}
            />
          )}
        />

        <Section
          title="4. Vấn đề (Issues)"
          emptyText="Không có vấn đề nào."
          items={analysis.issues}
          renderItem={(item) => (
            <GenericCard
              key={item.id}
              kind="issue"
              item={item}
              override={overrides[item.id]}
              onOverride={onOverride}
              onClearOverride={onClearOverride}
              transcript={transcript}
            />
          )}
        />

        <Section
          title="5. Yêu cầu & phản hồi"
          emptyText="Không có yêu cầu nào."
          items={analysis.requests}
          renderItem={(item) => (
            <GenericCard
              key={item.id}
              kind="request"
              item={item}
              override={overrides[item.id]}
              onOverride={onOverride}
              onClearOverride={onClearOverride}
              transcript={transcript}
            />
          )}
        />

        <Section
          title="6. Câu hỏi mở"
          emptyText="Không có câu hỏi mở."
          items={analysis.openQuestions}
          renderItem={(item) => (
            <GenericCard
              key={item.id}
              kind="open_question"
              item={item}
              override={overrides[item.id]}
              onOverride={onOverride}
              onClearOverride={onClearOverride}
              transcript={transcript}
            />
          )}
        />

        {analysis.notes.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Ghi chú từ AI</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
              {analysis.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function Section<T>({
  title,
  emptyText,
  items,
  renderItem,
  children,
}: {
  title: string;
  emptyText?: string;
  items?: T[];
  renderItem?: (item: T, index: number) => React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{title}</h3>
      {children
        ? children
        : items && items.length > 0
          ? <ul className="space-y-3">{items.map((it, i) => renderItem!(it, i))}</ul>
          : <p className="text-sm text-slate-400">{emptyText}</p>}
    </div>
  );
}

interface CardProps<T> {
  item: T;
  override?: { description?: string; confirmed?: boolean; flagged?: boolean };
  onOverride: (
    id: string,
    patch: Partial<{ description: string; confirmed: boolean; flagged: boolean }>,
  ) => void;
  onClearOverride: (id: string) => void;
  transcript: string;
}

function FinalDecisionCard(props: CardProps<FinalDecisionItem>) {
  const { item, override, onOverride, onClearOverride, transcript } = props;
  const description = override?.description ?? item.description;
  const isConfirmed = override?.confirmed ?? item.isFinal === true;
  const isFlagged = override?.flagged ?? item.needsReview === true;
  const humanTouched = Boolean(override);

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <EditableDescription
            value={description}
            isHuman={humanTouched}
            onChange={(v) => onOverride(item.id, { description: v })}
            onReset={() => onClearOverride(item.id)}
          />
        </div>
        <DecisionStatusBadge status={item.status} isFinal={item.isFinal} />
      </div>
      <MetaRow assignee={item.assignee} deadline={item.deadline} />
      <ReviewRow
        isFlagged={isFlagged}
        isConfirmed={isConfirmed}
        onFlag={() => onOverride(item.id, { flagged: !isFlagged })}
        onConfirm={() => onOverride(item.id, { confirmed: !isConfirmed })}
      />
      <EvidencePanel
        evidence={item.evidence}
        transcript={transcript}
        itemId={item.id}
        itemDescription={description}
      />
    </li>
  );
}

function GenericCard(
  props: CardProps<ActionItem | IssueItem | RequestItem | OpenQuestionItem> & { kind: string },
) {
  const { item, override, onOverride, onClearOverride, transcript, kind } = props;
  const description = override?.description ?? item.description;
  const isFlagged = override?.flagged ?? item.needsReview === true;
  const isConfirmed = override?.confirmed ?? false;
  const humanTouched = Boolean(override);

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <EditableDescription
            value={description}
            isHuman={humanTouched}
            onChange={(v) => onOverride(item.id, { description: v })}
            onReset={() => onClearOverride(item.id)}
          />
        </div>
        <StatusBadge status={item.status ?? "open"} kind={kind} />
      </div>
      <MetaRow assignee={item.assignee} deadline={item.deadline} />
      <ReviewRow
        isFlagged={isFlagged}
        isConfirmed={isConfirmed}
        onFlag={() => onOverride(item.id, { flagged: !isFlagged })}
        onConfirm={() => onOverride(item.id, { confirmed: !isConfirmed })}
      />
      <EvidencePanel
        evidence={item.evidence}
        transcript={transcript}
        itemId={item.id}
        itemDescription={description}
      />
    </li>
  );
}

function EditableDescription({
  value,
  onChange,
  isHuman,
  onReset,
}: {
  value: string;
  onChange: (v: string) => void;
  isHuman: boolean;
  onReset: () => void;
}) {
  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.max(1, Math.min(4, Math.ceil(value.length / 80)))}
        className="input-base text-sm"
        aria-label="Mô tả"
      />
      <div className="mt-1 flex items-center gap-2 text-xs">
        {isHuman ? (
          <span className="tag bg-emerald-50 text-emerald-700">Đã chỉnh bởi người</span>
        ) : (
          <span className="tag bg-slate-100 text-slate-600">Gợi ý từ AI</span>
        )}
        {isHuman && (
          <button
            type="button"
            className="text-xs text-slate-400 underline-offset-2 hover:underline"
            onClick={onReset}
          >
            Khôi phục bản AI
          </button>
        )}
      </div>
    </div>
  );
}

function MetaRow({
  assignee,
  deadline,
}: {
  assignee?: string | null;
  deadline?: string | null;
}) {
  if (!assignee && !deadline) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
      {assignee && (
        <span className="tag bg-slate-100 text-slate-700">Người phụ trách: {assignee}</span>
      )}
      {deadline && (
        <span className="tag bg-slate-100 text-slate-700">Deadline: {deadline}</span>
      )}
    </div>
  );
}

function ReviewRow({
  isFlagged,
  isConfirmed,
  onFlag,
  onConfirm,
}: {
  isFlagged: boolean;
  isConfirmed: boolean;
  onFlag: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <button
        type="button"
        onClick={onConfirm}
        className={`btn-secondary px-2 py-1 text-xs ${
          isConfirmed ? "border-emerald-300 bg-emerald-50 text-emerald-700" : ""
        }`}
        title="Đánh dấu mục này đã được con người xác nhận"
      >
        {isConfirmed ? "✓ Đã xác nhận" : "Xác nhận"}
      </button>
      <button
        type="button"
        onClick={onFlag}
        className={`btn-secondary px-2 py-1 text-xs ${
          isFlagged ? "border-amber-300 bg-amber-50 text-amber-700" : ""
        }`}
        title="Đánh dấu cần xem lại"
      >
        {isFlagged ? "⚠ Đang chờ xem" : "Cần xem lại"}
      </button>
    </div>
  );
}

function DecisionStatusBadge({
  status,
  isFinal,
}: {
  status: string;
  isFinal?: boolean;
}) {
  const color =
    status === "confirmed" || isFinal
      ? "bg-emerald-100 text-emerald-700"
      : status === "superseded" || status === "rejected"
        ? "bg-slate-200 text-slate-600 line-through"
        : status === "challenged"
          ? "bg-rose-100 text-rose-700"
          : status === "proposed"
            ? "bg-sky-100 text-sky-700"
            : "bg-amber-100 text-amber-800";
  return (
    <span className={`tag ${color}`}>
      {isFinal ? "Final · " : ""}
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function StatusBadge({ status, kind }: { status: string; kind: string }) {
  const color =
    status === "completed"
      ? "bg-emerald-100 text-emerald-700"
      : status === "blocked" || status === "unresolved"
        ? "bg-amber-100 text-amber-800"
        : status === "in_progress"
          ? "bg-sky-100 text-sky-700"
          : "bg-slate-100 text-slate-700";
  return <span className={`tag ${color}`}>{STATUS_LABEL[status] ?? status}</span>;
}
