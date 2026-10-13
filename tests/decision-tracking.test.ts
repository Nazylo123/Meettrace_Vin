import { describe, expect, it } from "vitest";
import {
  reconcileDecisions,
  sameTopic,
  aggregateForUi,
} from "@/lib/analysis/decision-tracking";
import type { Analysis } from "@/lib/ai/schemas";

function makeAnalysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    summary: "ok",
    finalDecisions: [],
    decisionHistory: [],
    actions: [],
    issues: [],
    requests: [],
    openQuestions: [],
    needsReview: false,
    notes: [],
    ...overrides,
  };
}

describe("reconcileDecisions — successful decision change", () => {
  it("promotes the latest confirmed entry and supersedes PostgreSQL", () => {
    const input = makeAnalysis({
      decisionHistory: [
        {
          id: "dh1",
          kind: "decision",
          description: "Use PostgreSQL for the new billing service",
          status: "proposed",
          evidence: [{ excerpt: "An initially proposed PostgreSQL." }],
        },
        {
          id: "dh2",
          kind: "decision",
          description: "Use SQL Server instead because the company already uses it",
          status: "challenged",
          evidence: [{ excerpt: "Binh argued SQL Server was a better fit." }],
        },
        {
          id: "dh3",
          kind: "decision",
          description: "Use SQL Server for the new billing service",
          status: "confirmed",
          evidence: [{ excerpt: "The manager decided to use SQL Server." }],
        },
      ],
    });

    const { analysis, finalDecisionIds, warnings } = reconcileDecisions(input);
    expect(finalDecisionIds).toEqual(["dh3"]);
    const final = analysis.finalDecisions.find((f) => f.id === "dh3");
    expect(final).toBeDefined();
    expect(final?.status).toBe("confirmed");
    expect(final?.isFinal).toBe(true);
    // PostgreSQL entry should be marked superseded (same topic as confirmed).
    const pg = analysis.decisionHistory.find((h) => h.id === "dh1");
    expect(pg?.status).toBe("superseded");
    expect(warnings).toHaveLength(0);
  });
});

describe("reconcileDecisions — ambiguous disagreement", () => {
  it("does not invent a final decision when nothing is confirmed", () => {
    const input = makeAnalysis({
      decisionHistory: [
        {
          id: "dh1",
          kind: "decision",
          description: "Use Chart.js for the dashboard",
          status: "proposed",
          evidence: [{ excerpt: "Linh proposed Chart.js." }],
        },
        {
          id: "dh2",
          kind: "decision",
          description: "Use Recharts for the dashboard",
          status: "challenged",
          evidence: [{ excerpt: "Quan countered with Recharts." }],
        },
        {
          id: "dh3",
          kind: "decision",
          description: "Use D3 for the dashboard",
          status: "proposed",
          evidence: [{ excerpt: "Tuan suggested D3." }],
        },
      ],
    });
    const { analysis, finalDecisionIds, warnings } = reconcileDecisions(input);
    expect(finalDecisionIds).toEqual([]);
    expect(analysis.finalDecisions).toHaveLength(0);
    expect(analysis.needsReview).toBe(true);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/no.*confirmed/i);
  });
});

describe("reconcileDecisions — model-declared finals that disagree", () => {
  it("downgrades finals that do not match the latest confirmed entry", () => {
    const input = makeAnalysis({
      finalDecisions: [
        {
          id: "fd-wrong",
          kind: "decision",
          description: "Use MongoDB",
          status: "confirmed",
          isFinal: true,
          evidence: [{ excerpt: "x" }],
        },
      ],
      decisionHistory: [
        {
          id: "dh1",
          kind: "decision",
          description: "Use PostgreSQL",
          status: "proposed",
          evidence: [{ excerpt: "x" }],
        },
        {
          id: "dh2",
          kind: "decision",
          description: "Use SQL Server",
          status: "confirmed",
          evidence: [{ excerpt: "y" }],
        },
      ],
    });
    const { analysis, finalDecisionIds, warnings } = reconcileDecisions(input);
    expect(finalDecisionIds).toEqual(["dh2"]);
    expect(analysis.finalDecisions.find((f) => f.id === "fd-wrong")).toBeUndefined();
    expect(warnings.some((w) => /dropped/i.test(w))).toBe(true);
  });
});

describe("sameTopic", () => {
  it("matches when a significant word overlaps", () => {
    expect(
      sameTopic(
        { description: "Use PostgreSQL for the billing service" },
        { description: "We will use SQL Server for billing" },
      ),
    ).toBe(true);
  });
  it("does not match unrelated descriptions", () => {
    expect(
      sameTopic(
        { description: "Hire a new designer" },
        { description: "Buy a new server" },
      ),
    ).toBe(false);
  });
});

describe("aggregateForUi", () => {
  it("returns the same shape the UI consumes", () => {
    const a = makeAnalysis();
    const agg = aggregateForUi(a);
    expect(Object.keys(agg).sort()).toEqual(
      [
        "actions",
        "decisionHistory",
        "finalDecisions",
        "issues",
        "needsReview",
        "notes",
        "openQuestions",
        "requests",
        "summary",
      ].sort(),
    );
  });
});
