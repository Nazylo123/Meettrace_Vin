import type { Evidence } from "@/lib/ai/schemas";

/**
 * We do NOT trust the model's claim that an excerpt came from the transcript.
 * Every evidence item is re-verified on the server against the source.
 *
 * Whitespace inside the model output can drift (e.g. double spaces, smart
 * quotes, line breaks). We first try an exact substring match; if that fails
 * we try a whitespace- and quote-normalized match and report the verified
 * range from the original text.
 */

const NORMALIZE_RE = /[\s\u00A0]+/g;
const QUOTE_RE = /[\u2018\u2019\u201C\u201D]/g;

export function normalizeForLookup(s: string): string {
  return s.replace(QUOTE_RE, '"').replace(NORMALIZE_RE, " ").trim();
}

export interface VerifiedEvidence extends Evidence {
  /** True if the excerpt was located in the original transcript. */
  verified: boolean;
  /** Start character index in the original transcript, when verified. */
  verifiedStart?: number;
  /** End character index in the original transcript, when verified (exclusive). */
  verifiedEnd?: number;
  /** Human-readable reason when not verified. */
  reason?: string;
}

export interface VerifyOptions {
  /** When true, ignore leading/trailing whitespace and quote differences. */
  fuzzy?: boolean;
}

export function verifyEvidence(
  excerpt: string,
  transcript: string,
  options: VerifyOptions = { fuzzy: true },
): VerifiedEvidence {
  if (!excerpt || !excerpt.trim()) {
    return { excerpt, verified: false, reason: "Empty excerpt" };
  }

  // 1) Exact, case-sensitive substring match.
  const exactIdx = transcript.indexOf(excerpt);
  if (exactIdx >= 0) {
    return {
      excerpt,
      verified: true,
      verifiedStart: exactIdx,
      verifiedEnd: exactIdx + excerpt.length,
    };
  }

  if (!options.fuzzy) {
    return {
      excerpt,
      verified: false,
      reason: "Excerpt not found in transcript (exact match failed)",
    };
  }

  // 2) Normalized match: collapse whitespace + smart quotes, then locate.
  const normExcerpt = normalizeForLookup(excerpt);
  const normTranscript = normalizeForLookup(transcript);
  const normIdx = normTranscript.indexOf(normExcerpt);
  if (normIdx < 0) {
    return {
      excerpt,
      verified: false,
      reason: "Excerpt not found in transcript (fuzzy match failed)",
    };
  }

  // Map the normalized index back to the original transcript. Because we
  // collapsed whitespace and quotes, we re-scan the original to find the
  // closest character offset that matches the normalized prefix.
  const original = locateOriginalPosition(transcript, normIdx, normExcerpt.length);
  if (original.start < 0) {
    return {
      excerpt,
      verified: false,
      reason: "Could not map normalized match back to original transcript",
    };
  }
  return {
    excerpt,
    verified: true,
    verifiedStart: original.start,
    verifiedEnd: original.end,
  };
}

/**
 * Walk the original transcript with the same normalization rules used in
 * `normalizeForLookup` and return the original [start, end) range that
 * corresponds to the normalized slice starting at `normStart` with the
 * given length.
 *
 * The function is O(n) and is good enough for short evidence snippets.
 */
function locateOriginalPosition(
  transcript: string,
  normStart: number,
  normLength: number,
): { start: number; end: number } {
  let normPos = 0;
  let originalStart = -1;
  let originalEnd = -1;
  let collected = 0;

  for (let i = 0; i < transcript.length; i++) {
    const ch = transcript[i];
    const normCh = ch.replace(QUOTE_RE, '"').replace(NORMALIZE_RE, " ");
    // The normalize rule collapses runs; the normalized string only contains
    // a single space per run. We skip characters that don't contribute to it.
    if (normCh === " " && (i === 0 || transcript[i - 1].replace(QUOTE_RE, '"').match(NORMALIZE_RE))) {
      continue;
    }
    if (normPos === normStart && originalStart < 0) {
      originalStart = i;
    }
    if (originalStart >= 0) {
      collected += normCh.length;
      if (collected >= normLength) {
        originalEnd = i + 1;
        break;
      }
    }
    normPos++;
  }
  return { start: originalStart, end: originalEnd };
}

export function verifyAllEvidence(
  items: { evidence?: Evidence[] }[],
  transcript: string,
): {
  items: { evidence: VerifiedEvidence[] }[];
  anyUnverified: boolean;
  total: number;
  verified: number;
} {
  let anyUnverified = false;
  let total = 0;
  let verified = 0;
  const out = items.map((item) => {
    const evidence = (item.evidence ?? []).map((e) => {
      total++;
      const v = verifyEvidence(e.excerpt, transcript);
      if (v.verified) verified++;
      else anyUnverified = true;
      return v;
    });
    return { evidence };
  });
  return { items: out, anyUnverified, total, verified };
}
