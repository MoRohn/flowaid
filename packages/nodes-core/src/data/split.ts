import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";

const DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", " ", ""];

/** Joins pieces into chunks of at most `size` characters, carrying up to `overlap` characters forward. */
function mergePieces(
  pieces: readonly string[],
  sep: string,
  size: number,
  overlap: number,
): string[] {
  const chunks: string[] = [];
  const current: string[] = [];
  let total = 0;
  const joined = () => current.join(sep).trim();
  for (const piece of pieces) {
    const extra = current.length > 0 ? sep.length : 0;
    if (total + piece.length + extra > size && current.length > 0) {
      const chunk = joined();
      if (chunk) chunks.push(chunk);
      // Drop pieces from the front until what remains fits the overlap and leaves room for `piece`.
      while (
        current.length > 0 &&
        (total > overlap || total + piece.length + (current.length > 0 ? sep.length : 0) > size)
      ) {
        total -= (current.shift() ?? "").length + (current.length > 0 ? sep.length : 0);
      }
    }
    current.push(piece);
    total += piece.length + (current.length > 1 ? sep.length : 0);
  }
  const last = joined();
  if (last) chunks.push(last);
  return chunks;
}

/**
 * Recursive character splitting: split on the coarsest separator present, merge the pieces into
 * chunks of at most `chunkSize` characters with `chunkOverlap` characters of shared context, and
 * recurse with finer separators into pieces that are still too large.
 */
export function splitText(
  text: string,
  chunkSize: number,
  chunkOverlap: number,
  separators: readonly string[] = DEFAULT_SEPARATORS,
): string[] {
  const sep = separators.find((s) => s === "" || text.includes(s)) ?? "";
  const finer = separators.slice(separators.indexOf(sep) + 1);
  const pieces = (sep === "" ? [...text] : text.split(sep)).filter((p) => p !== "");
  const out: string[] = [];
  let small: string[] = [];
  for (const piece of pieces) {
    if (piece.length <= chunkSize) {
      small.push(piece);
      continue;
    }
    if (small.length > 0) out.push(...mergePieces(small, sep, chunkSize, chunkOverlap));
    small = [];
    out.push(...(finer.length > 0 ? splitText(piece, chunkSize, chunkOverlap, finer) : [piece]));
  }
  if (small.length > 0) out.push(...mergePieces(small, sep, chunkSize, chunkOverlap));
  return out;
}

export const splitNode = defineNode({
  id: "flowaid.data.split",
  version: "1.0.0",
  metadata: {
    name: "Split text",
    description:
      "Splits text into chunks of at most `chunkSize` characters with `chunkOverlap` characters of shared context, breaking on paragraphs, lines, sentences and words in that order.",
    category: "data",
    icon: "scissors",
    tags: ["data", "text", "chunking", "retrieval"],
    summary: "{{ config.chunkSize }} chars",
  },
  configSchema: z
    .strictObject({
      chunkSize: z.int().min(1).max(100000).default(1000),
      chunkOverlap: z.int().min(0).max(50000).default(200),
      separators: z
        .array(z.string())
        .min(1)
        .max(16)
        .optional()
        .meta({
          "x-ui": {
            help: "Separators to try, coarsest first. The empty string splits characters.",
          },
        }),
    })
    .refine((c) => c.chunkOverlap < c.chunkSize, {
      message: "chunkOverlap must be smaller than chunkSize",
      path: ["chunkOverlap"],
    }),
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ chunks: z.array(z.string()), count: z.int().min(0) }),
  capabilities: [],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 30000 },
  execute: (ctx, input) => {
    const chunks = splitText(
      input.text,
      ctx.config.chunkSize,
      ctx.config.chunkOverlap,
      ctx.config.separators ?? DEFAULT_SEPARATORS,
    );
    return Promise.resolve(ok({ chunks, count: chunks.length }));
  },
});
