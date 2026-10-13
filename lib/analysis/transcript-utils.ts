/**
 * Helpers for working with raw meeting transcripts.
 */

export const DEFAULT_MAX_CHARS = Number(process.env.MEETTRACE_MAX_CHARS) || 60_000;

export interface Chunk {
  start: number;
  end: number;
  text: string;
}

/**
 * Split a long transcript into overlapping chunks. We prefer sentence
 * boundaries when possible so each chunk is self-contained.
 *
 * The MVP only triggers chunking when the transcript exceeds
 * `maxChars`. The per-chunk analysis is consolidated in a second pass
 * that the caller implements (this file just provides the splitter).
 */
export function chunkTranscript(
  transcript: string,
  maxChars: number = DEFAULT_MAX_CHARS,
  overlapChars: number = 800,
): Chunk[] {
  const text = transcript.trim();
  if (text.length <= maxChars) {
    return [{ start: 0, end: text.length, text }];
  }
  if (overlapChars >= maxChars) {
    throw new Error("overlapChars must be smaller than maxChars");
  }
  const chunks: Chunk[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(text.length, cursor + maxChars);
    if (end < text.length) {
      // Try to back off to a sentence boundary.
      const slice = text.slice(cursor, end);
      const lastBreak = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("? "),
        slice.lastIndexOf("\n"),
      );
      if (lastBreak > maxChars * 0.6) {
        end = cursor + lastBreak + 1;
      }
    }
    chunks.push({ start: cursor, end, text: text.slice(cursor, end) });
    if (end === text.length) break;
    cursor = Math.max(end - overlapChars, cursor + 1);
  }
  return chunks;
}

export function validateTranscript(raw: string, maxChars: number = DEFAULT_MAX_CHARS): {
  ok: boolean;
  error?: string;
  text: string;
} {
  const text = (raw ?? "").trim();
  if (!text) {
    return { ok: false, error: "Vui lòng dán nội dung cuộc họp trước khi phân tích.", text: "" };
  }
  if (text.length > maxChars) {
    return {
      ok: false,
      error: `Transcript quá dài (${text.length.toLocaleString()} ký tự). Giới hạn hiện tại là ${maxChars.toLocaleString()} ký tự. Hãy rút gọn hoặc tách thành nhiều phiên.`,
      text,
    };
  }
  return { ok: true, text };
}
