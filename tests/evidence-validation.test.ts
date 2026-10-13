import { describe, expect, it } from "vitest";
import {
  verifyEvidence,
  verifyAllEvidence,
  normalizeForLookup,
} from "@/lib/analysis/evidence-validation";

describe("verifyEvidence", () => {
  const transcript = "An initially proposed PostgreSQL. Binh argued SQL Server.";

  it("accepts an exact substring", () => {
    const r = verifyEvidence("Binh argued SQL Server.", transcript);
    expect(r.verified).toBe(true);
    expect(r.verifiedStart).toBe(34);
    expect(r.verifiedEnd).toBe(34 + "Binh argued SQL Server.".length);
  });

  it("rejects a fabricated excerpt", () => {
    const r = verifyEvidence("Maria proposed MongoDB.", transcript);
    expect(r.verified).toBe(false);
    expect(r.reason).toMatch(/not found/i);
  });

  it("accepts a fuzzy match when whitespace drifts", () => {
    // Two spaces between words in the excerpt, single space in transcript.
    const r = verifyEvidence("Binh  argued SQL Server.", transcript);
    expect(r.verified).toBe(true);
    expect(typeof r.verifiedStart).toBe("number");
  });

  it("rejects empty excerpts", () => {
    const r = verifyEvidence("", transcript);
    expect(r.verified).toBe(false);
  });

  it("normalizes smart quotes", () => {
    const t = 'He said "we will ship on Monday" with conviction.';
    const r = verifyEvidence('He said "we will ship on Monday" with conviction.', t);
    expect(r.verified).toBe(true);
  });
});

describe("verifyAllEvidence", () => {
  it("flags any unverified excerpt and counts totals", () => {
    const t = "Binh will prepare the plan before Friday.";
    const items = [
      { evidence: [{ excerpt: "Binh will prepare the plan before Friday." }] },
      { evidence: [{ excerpt: "Nobody said this." }] },
    ];
    const out = verifyAllEvidence(items, t);
    expect(out.total).toBe(2);
    expect(out.verified).toBe(1);
    expect(out.anyUnverified).toBe(true);
    expect(out.items[1].evidence[0].verified).toBe(false);
  });
});

describe("normalizeForLookup", () => {
  it("collapses whitespace and smart quotes", () => {
    expect(normalizeForLookup('He said  "hi"\u00A0there')).toBe('He said "hi" there');
  });
});
