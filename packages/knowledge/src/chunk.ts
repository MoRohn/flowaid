/**
 * The chunker (ARCHITECTURE.md §10.8): recursive by tokens with overlap. Text is split on the
 * coarsest separator that yields pieces under the budget (headings for markdown, then paragraphs,
 * lines, sentences, words), pieces are packed greedily up to `chunkTokens`, and each chunk after
 * the first starts with the tail of the previous one (`overlapTokens`). Tokens are estimated at
 * four characters each (the same estimate the TypeSafe state guard uses); exact tokenisation is
 * the embedding provider's business, and the estimate only has to keep chunks under its limit.
 */
import type { ChunkerConfig } from "@flowaid/workflow-core";

export const DEFAULT_CHUNKER: ChunkerConfig = {
  strategy: "recursive",
  chunkTokens: 400,
  overlapTokens: 60,
};

export interface TextChunk {
  ordinal: number;
  content: string;
  tokens: number;
  /** character offsets into the normalised text */
  start: number;
  end: number;
  /** the nearest markdown heading at or above the chunk's first line */
  heading?: string;
}

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

const RECURSIVE_SEPARATORS = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " "];
const MARKDOWN_SEPARATORS = ["\n# ", "\n## ", "\n### ", "\n#### ", ...RECURSIVE_SEPARATORS];

/** Splits `text` into pieces of at most `max` characters, keeping separators on the left piece. */
function split(text: string, max: number, separators: readonly string[]): string[] {
  if (text.length <= max) return [text];
  const sep = separators.find((s) => text.includes(s));
  if (sep === undefined) {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
    return out;
  }
  const rest = separators.slice(separators.indexOf(sep) + 1);
  const parts: string[] = [];
  // headings start the next piece; other separators end the current one
  const heading = sep.startsWith("\n#");
  let from = 0;
  for (let at = text.indexOf(sep); at !== -1; at = text.indexOf(sep, at + sep.length)) {
    const cut = heading ? at : at + sep.length;
    if (cut > from) {
      parts.push(text.slice(from, cut));
      from = cut;
    }
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts.flatMap((p) => (p.length <= max ? [p] : split(p, max, rest)));
}

function headingAt(text: string, offset: number): string | undefined {
  const before = text.slice(0, offset);
  const m = [...before.matchAll(/^#{1,6}\s+(.+)$/gm)].at(-1);
  return m?.[1]?.trim();
}

/** Chunks normalised text. Empty or whitespace-only text yields no chunks. */
export function chunkText(text: string, config: Partial<ChunkerConfig> = {}): TextChunk[] {
  const c = { ...DEFAULT_CHUNKER, ...config };
  if (c.chunkTokens < 16) throw new RangeError("chunkTokens must be at least 16");
  if (c.overlapTokens < 0 || c.overlapTokens >= c.chunkTokens)
    throw new RangeError("overlapTokens must be at least 0 and below chunkTokens");
  if (!text.trim()) return [];
  const maxChars = c.chunkTokens * CHARS_PER_TOKEN;
  const overlapChars = c.overlapTokens * CHARS_PER_TOKEN;

  if (c.strategy === "fixed") {
    const out: TextChunk[] = [];
    const step = maxChars - overlapChars;
    for (let start = 0; start < text.length; start += step) {
      const end = Math.min(text.length, start + maxChars);
      const content = text.slice(start, end).trim();
      if (content)
        out.push({ ordinal: out.length, content, tokens: estimateTokens(content), start, end });
      if (end === text.length) break;
    }
    return out;
  }

  const pieces = split(
    text,
    maxChars,
    c.strategy === "markdown" ? MARKDOWN_SEPARATORS : RECURSIVE_SEPARATORS,
  );
  const out: TextChunk[] = [];
  let offset = 0;
  let current = "";
  let currentStart = 0;
  const flush = () => {
    const content = current.trim();
    if (content) {
      const lead = current.length - current.trimStart().length;
      const start = currentStart + lead;
      // the heading on the chunk's first line, else the nearest one above it
      const lineEnd = text.indexOf("\n", start);
      const heading = headingAt(text, lineEnd === -1 ? text.length : lineEnd);
      out.push({
        ordinal: out.length,
        content,
        tokens: estimateTokens(content),
        start,
        end: start + content.length,
        ...(heading ? { heading } : {}),
      });
    }
  };
  for (const piece of pieces) {
    if (current && current.length + piece.length > maxChars) {
      flush();
      // overlap: start the next chunk with the tail of this one, cut at a word boundary
      const tail = overlapChars > 0 ? current.slice(-overlapChars) : "";
      const cut = tail.indexOf(" ");
      const kept = cut > 0 && cut < tail.length - 1 ? tail.slice(cut + 1) : tail;
      currentStart = offset - kept.length;
      current = kept;
      if (current.length + piece.length > maxChars) {
        current = "";
        currentStart = offset;
      }
    }
    if (!current) currentStart = offset;
    current += piece;
    offset += piece.length;
  }
  flush();
  return out;
}
