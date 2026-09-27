/**
 * An in-memory `VectorIndexAdapter`: exact cosine search and BM25 keyword ranking. The reference
 * implementation the contract suite is written against; also what exported code packages and
 * tests use when there is no database.
 */
import type {
  IndexHit,
  IndexedChunk,
  KnowledgeFilter,
  VectorIndexAdapter,
} from "@flowaid/workflow-core";

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function matchesFilter(
  metadata: Record<string, unknown>,
  filter?: KnowledgeFilter,
): boolean {
  return !filter || Object.entries(filter).every(([k, v]) => metadata[k] === v);
}

/** Lower-cased word tokens (letters and digits in any script). */
export function terms(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

interface Row extends IndexedChunk {
  sourceId: string;
  terms: string[];
}

export class MemoryIndex implements VectorIndexAdapter {
  readonly kind = "memory";
  readonly supportsKeyword = true;
  private readonly rows = new Map<string, Row>();

  upsert(sourceId: string, documentId: string, chunks: IndexedChunk[]): Promise<void> {
    for (const [id, r] of this.rows)
      if (r.sourceId === sourceId && r.documentId === documentId) this.rows.delete(id);
    for (const c of chunks) this.rows.set(c.id, { ...c, sourceId, terms: terms(c.content) });
    return Promise.resolve();
  }

  private candidates(sourceIds: readonly string[], filter?: KnowledgeFilter): Row[] {
    const set = new Set(sourceIds);
    return [...this.rows.values()].filter(
      (r) => set.has(r.sourceId) && matchesFilter(r.metadata, filter),
    );
  }

  queryVector(
    sourceIds: readonly string[],
    vector: number[],
    k: number,
    filter?: KnowledgeFilter,
  ): Promise<IndexHit[]> {
    const hits = this.candidates(sourceIds, filter)
      .filter((r) => r.embedding && r.embedding.length === vector.length)
      .map((r) => hit(r, cosine(vector, r.embedding ?? [])))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
    return Promise.resolve(hits);
  }

  /** Okapi BM25 (k1 = 1.2, b = 0.75) over the candidate chunks. */
  queryKeyword(
    sourceIds: readonly string[],
    text: string,
    k: number,
    filter?: KnowledgeFilter,
  ): Promise<IndexHit[]> {
    const q = [...new Set(terms(text))];
    const docs = this.candidates(sourceIds, filter);
    if (q.length === 0 || docs.length === 0) return Promise.resolve([]);
    const avg = docs.reduce((s, d) => s + d.terms.length, 0) / docs.length || 1;
    const df = new Map(q.map((t) => [t, docs.filter((d) => d.terms.includes(t)).length]));
    const scored = docs
      .map((d) => {
        let score = 0;
        for (const t of q) {
          const f = d.terms.filter((x) => x === t).length;
          if (!f) continue;
          const n = df.get(t) ?? 0;
          const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
          score += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * d.terms.length) / avg));
        }
        return hit(d, score);
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
    return Promise.resolve(scored);
  }

  deleteDocument(sourceId: string, documentId: string): Promise<void> {
    for (const [id, r] of this.rows)
      if (r.sourceId === sourceId && r.documentId === documentId) this.rows.delete(id);
    return Promise.resolve();
  }

  deleteSource(sourceId: string): Promise<void> {
    for (const [id, r] of this.rows) if (r.sourceId === sourceId) this.rows.delete(id);
    return Promise.resolve();
  }

  stats(sourceId: string): Promise<{ documents: number; chunks: number }> {
    const rows = [...this.rows.values()].filter((r) => r.sourceId === sourceId);
    return Promise.resolve({
      documents: new Set(rows.map((r) => r.documentId)).size,
      chunks: rows.length,
    });
  }
}

function hit(r: Row, score: number): IndexHit {
  return {
    chunkId: r.id,
    documentId: r.documentId,
    ordinal: r.ordinal,
    content: r.content,
    metadata: r.metadata,
    score,
  };
}
