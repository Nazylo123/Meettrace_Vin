import { z } from "zod";

/**
 * Evidence references a snippet of the original transcript.
 * The model must return an `excerpt` that is an exact, contiguous
 * substring of the transcript. We also ask for the character range
 * but never trust it — the server re-verifies against the source.
 */
export const EvidenceSchema = z.object({
  excerpt: z.string().min(1).max(2000),
  startChar: z.number().int().nonnegative().optional(),
  endChar: z.number().int().nonnegative().optional(),
});

/** Decision lifecycle states, used consistently across API / UI / tests. */
export const DecisionStatusSchema = z.enum([
  "proposed",
  "challenged",
  "confirmed",
  "superseded",
  "rejected",
  "open",
]);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

/** Generic lifecycle for actions, issues, requests and open questions. */
export const ItemStatusSchema = z.enum([
  "open",
  "in_progress",
  "completed",
  "blocked",
  "unresolved",
]);
export type ItemStatus = z.infer<typeof ItemStatusSchema>;

/** Item categories surfaced in the UI. */
export const ItemKindSchema = z.enum([
  "decision",
  "action",
  "issue",
  "request",
  "open_question",
]);
export type ItemKind = z.infer<typeof ItemKindSchema>;

const BaseItem = z.object({
  id: z.string().min(1).max(80),
  kind: ItemKindSchema,
  description: z.string().min(1).max(2000),
  status: z.union([DecisionStatusSchema, ItemStatusSchema]).optional(),
  assignee: z.string().nullable().optional(),
  deadline: z.string().nullable().optional(),
  needsReview: z.boolean().optional(),
  evidence: z.array(EvidenceSchema).default([]),
});

export const DecisionHistoryItemSchema = BaseItem.extend({
  kind: z.literal("decision"),
  status: DecisionStatusSchema,
  /** The final-state decision, if this entry is a "final decision". */
  isFinal: z.boolean().optional(),
});

export const FinalDecisionItemSchema = BaseItem.extend({
  kind: z.literal("decision"),
  status: DecisionStatusSchema,
  isFinal: z.boolean().optional(),
});

export const ActionItemSchema = BaseItem.extend({
  kind: z.literal("action"),
  status: ItemStatusSchema.default("open"),
});

export const IssueItemSchema = BaseItem.extend({
  kind: z.literal("issue"),
  status: ItemStatusSchema.default("open"),
});

export const RequestItemSchema = BaseItem.extend({
  kind: z.literal("request"),
  status: ItemStatusSchema.default("open"),
});

export const OpenQuestionItemSchema = BaseItem.extend({
  kind: z.literal("open_question"),
  status: ItemStatusSchema.default("unresolved"),
});

/** The structured analysis the AI must return. */
export const AnalysisSchema = z.object({
  summary: z.string().min(1).max(1500),
  finalDecisions: z.array(FinalDecisionItemSchema).default([]),
  decisionHistory: z.array(DecisionHistoryItemSchema).default([]),
  actions: z.array(ActionItemSchema).default([]),
  issues: z.array(IssueItemSchema).default([]),
  requests: z.array(RequestItemSchema).default([]),
  openQuestions: z.array(OpenQuestionItemSchema).default([]),
  needsReview: z.boolean().default(false),
  notes: z.array(z.string()).default([]),
});

export type Evidence = z.infer<typeof EvidenceSchema>;
export type FinalDecisionItem = z.infer<typeof FinalDecisionItemSchema>;
export type DecisionHistoryItem = z.infer<typeof DecisionHistoryItemSchema>;
export type ActionItem = z.infer<typeof ActionItemSchema>;
export type IssueItem = z.infer<typeof IssueItemSchema>;
export type RequestItem = z.infer<typeof RequestItemSchema>;
export type OpenQuestionItem = z.infer<typeof OpenQuestionItemSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;

/** Response shape returned by the /api/analyze route. */
export const AnalyzeResponseSchema = z.object({
  ok: z.literal(true),
  model: z.string(),
  analysis: AnalysisSchema,
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;
