/**
 * Retrieval strategies as a LangChain `BaseRetriever` (so the callback handler sees retriever
 * start/end): similarity, maximal marginal relevance, multi-query (a chat model rewrites the
 * question into variants; results are fused) and hybrid (vector candidates re-ranked by fusing
 * the vector rank with an Okapi BM25 rank over the candidates, reciprocal-rank fusion).
 */
import { BaseRetriever } from "@langchain/core/retrievers";
import type { Document } from "@langchain/core/documents";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import type { CallbackManagerForRetrieverRun } from "@langchain/core/callbacks/manager";
import type { FlowaidVectorStore, MetadataFilter } from "./stores.js";

export type Strategy = "similarity" | "mmr" | "multi_query" | "hybrid";

export interface RetrieverOptions {
  store: FlowaidVectorStore;
  strategy: Strategy;
  k: number;
  fetchK: number;
  lambda: number;
  queries: number;
  scoreThreshold?: number;
  filter?: MetadataFilter;
  model?: BaseChatModel;
}

const RRF_K = 60;

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);

/** Okapi BM25 scores of `docs` for `query` (k1 1.5, b 0.75), computed over the candidate set. */
export function bm25(query: string, docs: readonly string[]): number[] {
  const terms = [...new Set(tokenize(query))];
  const tokenized = docs.map(tokenize);
  const avg = tokenized.reduce((n, t) => n + t.length, 0) / Math.max(1, tokenized.length);
  const df = new Map(terms.map((t) => [t, tokenized.filter((d) => d.includes(t)).length]));
  return tokenized.map((doc) => {
    let score = 0;
    for (const term of terms) {
      const tf = doc.filter((t) => t === term).length;
      if (tf === 0) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += (idf * tf * 2.5) / (tf + 1.5 * (0.25 + (0.75 * doc.length) / (avg || 1)));
    }
    return score;
  });
}

const keyOf = (d: Document) => d.id ?? d.pageContent;

export class FlowaidRetriever extends BaseRetriever {
  override lc_namespace = ["flowaid", "retrievers"];

  constructor(private readonly o: RetrieverOptions) {
    super({});
  }

  static override lc_name() {
    return "FlowaidRetriever";
  }

  private async scored(query: string, k: number): Promise<Document[]> {
    const results = await this.o.store.similaritySearchWithScore(query, k, this.o.filter);
    return results
      .filter(([, score]) => this.o.scoreThreshold === undefined || score >= this.o.scoreThreshold)
      .map(([doc, score]) => {
        doc.metadata = { ...doc.metadata, score };
        return doc;
      });
  }

  private async variants(
    query: string,
    runManager?: CallbackManagerForRetrieverRun,
  ): Promise<string[]> {
    if (!this.o.model) return [query];
    const answer = await this.o.model.invoke(
      [
        new HumanMessage(
          `Write ${this.o.queries} different search queries that would find documents answering the question below. Vary wording and perspective. One query per line, no numbering, nothing else.\n\nQuestion: ${query}`,
        ),
      ],
      { callbacks: runManager?.getChild("multi_query") },
    );
    const lines = answer.text
      .split("\n")
      .map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
      .filter(Boolean)
      .slice(0, this.o.queries);
    return [query, ...lines.filter((l) => l !== query)];
  }

  override async _getRelevantDocuments(
    query: string,
    runManager?: CallbackManagerForRetrieverRun,
  ): Promise<Document[]> {
    const { k, fetchK } = this.o;
    switch (this.o.strategy) {
      case "similarity":
        return this.scored(query, k);
      case "mmr":
        return this.o.store.maxMarginalRelevanceSearch(
          query,
          { k, fetchK, lambda: this.o.lambda, ...(this.o.filter ? { filter: this.o.filter } : {}) },
          undefined,
        );
      case "multi_query": {
        const fused = new Map<string, { doc: Document; rrf: number }>();
        for (const q of await this.variants(query, runManager)) {
          (await this.scored(q, k)).forEach((doc, rank) => {
            const entry = fused.get(keyOf(doc)) ?? { doc, rrf: 0 };
            entry.rrf += 1 / (RRF_K + rank + 1);
            fused.set(keyOf(doc), entry);
          });
        }
        return [...fused.values()]
          .sort((a, b) => b.rrf - a.rrf)
          .slice(0, k)
          .map(({ doc, rrf }) => {
            doc.metadata = { ...doc.metadata, fusedScore: rrf };
            return doc;
          });
      }
      case "hybrid": {
        const candidates = await this.scored(query, Math.max(fetchK, k));
        const lexical = bm25(
          query,
          candidates.map((d) => d.pageContent),
        );
        const lexicalRank = lexical
          .map((score, i) => ({ score, i }))
          .sort((a, b) => b.score - a.score)
          .reduce<number[]>((ranks, { i }, rank) => ((ranks[i] = rank), ranks), []);
        return candidates
          .map((doc, vectorRank) => ({
            doc,
            fused:
              1 / (RRF_K + vectorRank + 1) +
              1 / (RRF_K + (lexicalRank[vectorRank] ?? vectorRank) + 1),
            bm25: lexical[vectorRank] ?? 0,
          }))
          .sort((a, b) => b.fused - a.fused)
          .slice(0, k)
          .map(({ doc, fused, bm25: lexicalScore }) => {
            doc.metadata = { ...doc.metadata, fusedScore: fused, bm25: lexicalScore };
            return doc;
          });
      }
    }
  }
}
