/**
 * A deterministic embedding provider for tests, local runs and replayable examples: hashed bag of
 * words (each lower-cased term adds to a few buckets), L2-normalised, so texts that share words
 * are close in cosine distance and identical texts are identical vectors. No network, no key.
 */
import { sha256Hex } from "@flowaid/shared";
import type { EmbeddingProvider } from "@flowaid/workflow-core";
import { terms } from "./adapters/memory.js";

export function hashedEmbedding(text: string, dimensions = 64): number[] {
  const v = new Array<number>(dimensions).fill(0);
  for (const t of terms(text)) {
    const h = sha256Hex(t);
    for (let i = 0; i < 3; i++) {
      const bucket = parseInt(h.slice(i * 8, i * 8 + 8), 16) % dimensions;
      v[bucket] = (v[bucket] ?? 0) + (i === 0 ? 1 : 0.5);
    }
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export function fakeEmbeddingProvider(
  o: { dimensions?: number; model?: string; calls?: string[][] } = {},
): EmbeddingProvider {
  const dimensions = o.dimensions ?? 64;
  return {
    id: "fake",
    model: o.model ?? "hashed-bow",
    dimensions,
    embed(texts) {
      o.calls?.push([...texts]);
      return Promise.resolve({
        vectors: texts.map((t) => hashedEmbedding(t, dimensions)),
        usage: {
          inputTokens: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0),
          outputTokens: 0,
        },
        costUsd: 0,
      });
    },
    health: () => ({
      status: "healthy",
      errorRate1m: 0,
      p95LatencyMs: 0,
      consecutiveFailures: 0,
      checkedAt: new Date(0).toISOString(),
    }),
  };
}
