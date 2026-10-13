import type {
  Analysis,
  DecisionHistoryItem,
  DecisionStatus,
  FinalDecisionItem,
} from "@/lib/ai/schemas";

/**
 * Decision evolution tracking.
 *
 * The model is asked to return a structured decision history. We never
 * trust the model to label the "final" decision correctly, because the
 * whole point of MeetTrace is to make this verifiable. So we run a
 * deterministic reconciliation step on top of the AI output.
 *
 * Rules used to decide the "final" decision from the history:
 *
 *   1. Collect every history entry with status "confirmed".
 *      If at least one exists, the most recent confirmed entry is the
 *      final decision. Earlier confirmed entries that refer to a
 *      different option are marked "superseded".
 *
 *   2. If no entry is confirmed, the latest "proposed" or "challenged"
 *      entry is surfaced as "open" — NOT as final. The user has to
 *      confirm it themselves.
 *
 *   3. Items that were only "proposed" or "challenged" but never
 *      confirmed, and that have a later confirmed alternative, are
 *      marked "superseded".
 *
 *   4. "rejected" stays "rejected".
 *
 * The reconciliation is also defensive against the model's mistakes:
 *   - If `finalDecisions` is empty but the history has a confirmed item,
 *     we promote that history item into finalDecisions.
 *   - If `finalDecisions` contains multiple entries marked `isFinal: true`
 *     for different descriptions, we keep only the latest one as final
 *     and downgrade the others.
 */

export interface ReconciledAnalysis {
  analysis: Analysis;
  finalDecisionIds: string[];
  warnings: string[];
}

export function reconcileDecisions(input: Analysis): ReconciledAnalysis {
  const warnings: string[] = [];
  const history = input.decisionHistory.map((h) => ({ ...h }));
  const finals = input.finalDecisions.map((f) => ({ ...f }));

  // 1. Walk history and detect the latest "confirmed" entry.
  const confirmed = history.filter((h) => h.status === "confirmed");
  let latestConfirmed: DecisionHistoryItem | undefined;
  if (confirmed.length > 0) {
    latestConfirmed = confirmed[confirmed.length - 1];
  }

  // 2. Walk history and detect the latest "proposed" or "challenged" entry.
  const proposedish = history.filter(
    (h) => h.status === "proposed" || h.status === "challenged",
  );
  const latestProposal: DecisionHistoryItem | undefined =
    proposedish.length > 0 ? proposedish[proposedish.length - 1] : undefined;

  // 3. Demote prior confirmed entries that point at a different option.
  if (latestConfirmed) {
    for (const h of confirmed) {
      if (h.id !== latestConfirmed.id && !sameTopic(h, latestConfirmed)) {
        h.status = "superseded";
      }
    }
    // Also demote earlier proposals about the same topic.
    for (const h of proposedish) {
      if (
        h.id !== latestConfirmed.id &&
        sameTopic(h, latestConfirmed) &&
        h.status !== "challenged"
      ) {
        h.status = "superseded";
      }
    }
  }

  // 4. Build the deterministic final-decision list.
  let finalIds: string[] = [];
  if (latestConfirmed) {
    finalIds = [latestConfirmed.id];
  } else if (latestProposal) {
    // No explicit confirmation — surface the latest proposal as OPEN.
    finalIds = [];
    warnings.push(
      `No decision is explicitly confirmed in the transcript; the latest proposal ("${latestProposal.description}") is reported as open, not final.`,
    );
  }

  // 5. Reconcile the model's `finalDecisions` list against our conclusion.
  const reconciledFinals: FinalDecisionItem[] = [];

  if (latestConfirmed) {
    // Promote the latest confirmed history entry into finals.
    reconciledFinals.push({
      ...latestConfirmed,
      isFinal: true,
      status: "confirmed",
    });
  }

  // Carry over any finalDecisions that match the same topic as the
  // confirmed one (e.g. the model might split a single decision into two
  // related items). We do NOT carry over finals that disagree.
  for (const f of finals) {
    if (latestConfirmed && sameTopic(f, latestConfirmed)) {
      // Already represented above via the history entry.
      continue;
    }
    if (!latestConfirmed) {
      // No confirmed entry exists. Whatever the model put in finalDecisions
      // is suspect — downgrade to "open".
      reconciledFinals.push({
        ...f,
        isFinal: false,
        status: "open",
        needsReview: true,
      });
    } else {
      warnings.push(
        `Dropped a model-declared "final" decision that did not match the latest confirmed history entry: "${f.description}".`,
      );
    }
  }

  // 6. If `finalDecisions` had any items with isFinal=true that disagree
  //    with our conclusion, log a warning so the UI can surface it.
  for (const f of finals) {
    if (f.isFinal && latestConfirmed && !sameTopic(f, latestConfirmed)) {
      warnings.push(
        `Model marked a non-confirmed decision as final; downgraded: "${f.description}".`,
      );
    }
  }

  // 7. Propagate `needsReview` to the analysis if we had to do work.
  const reconciled: Analysis = {
    ...input,
    decisionHistory: history,
    finalDecisions: reconciledFinals,
    needsReview: input.needsReview || warnings.length > 0,
  };
  // Open questions also count toward "needs review" because they mean
  // the meeting did not finish resolving them.
  if (reconciled.openQuestions.length > 0) {
    reconciled.needsReview = true;
  }

  return { analysis: reconciled, finalDecisionIds: finalIds, warnings };
}

/**
 * Heuristic: two decisions refer to the same topic if they share at least
 * one significant word. This is intentionally simple but stable across
 * small model paraphrases.
 */
export function sameTopic(a: { description: string }, b: { description: string }): boolean {
  const sig = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 4),
    );
  const sa = sig(a.description);
  const sb = sig(b.description);
  for (const w of sa) if (sb.has(w)) return true;
  return false;
}

/**
 * Aggregate the analysis into the six sections the UI shows.
 * Pure function — easy to unit test.
 */
export interface AggregateResult {
  finalDecisions: FinalDecisionItem[];
  decisionHistory: DecisionHistoryItem[];
  actions: Analysis["actions"];
  issues: Analysis["issues"];
  requests: Analysis["requests"];
  openQuestions: Analysis["openQuestions"];
  needsReview: boolean;
  summary: string;
  notes: string[];
}

export function aggregateForUi(analysis: Analysis): AggregateResult {
  return {
    finalDecisions: analysis.finalDecisions,
    decisionHistory: analysis.decisionHistory,
    actions: analysis.actions,
    issues: analysis.issues,
    requests: analysis.requests,
    openQuestions: analysis.openQuestions,
    needsReview: analysis.needsReview,
    summary: analysis.summary,
    notes: analysis.notes,
  };
}

export const STATUS_LABEL: Record<DecisionStatus | string, string> = {
  proposed: "Đề xuất",
  challenged: "Bị phản đối",
  confirmed: "Đã chốt",
  superseded: "Bị thay thế",
  rejected: "Bị bác bỏ",
  open: "Chưa chốt",
  in_progress: "Đang thực hiện",
  completed: "Hoàn thành",
  blocked: "Bị chặn",
  unresolved: "Chưa giải quyết",
};
