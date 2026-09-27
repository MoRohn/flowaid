/**
 * Search nodes (ARCHITECTURE.md §10.8): `retriever` (vector similarity), `hybrid_search` (vector
 * and full-text fused by reciprocal rank fusion), `rerank` (reorders hits with a rerank model) and
 * `knowledge_base` — the one-node RAG step: search, optionally rerank, and hand back a numbered,
 * cited context block sized for a prompt.
 */
import { z } from "zod";
import { defineNode, ok, type ExecutionContext } from "@flowaid/node-sdk";
import {
  BadRequestError,
  type KnowledgeSearchMode,
  type KnowledgeSearchResult,
  type ModelRef,
} from "@flowaid/workflow-core";
import { callCtx, modelRef } from "../common.js";
import { filterSchema, hitSchema, sourceIdsSchema, type Hit } from "./common.js";

const searchConfig = {
  sourceIds: sourceIdsSchema,
  k: z.int().min(1).max(100).default(5),
  minScore: z.number().optional(),
  filter: filterSchema,
};

async function search(
  ctx: ExecutionContext<{
    sourceIds: string[];
    k: number;
    minScore?: number | undefined;
    filter?: Record<string, string | number | boolean> | undefined;
  }>,
  query: string,
  mode: KnowledgeSearchMode,
  k = ctx.config.k,
): Promise<KnowledgeSearchResult> {
  const kb = ctx.knowledge;
  if (!kb) throw new BadRequestError("this runtime has no knowledge base");
  return kb.search({
    sourceIds: ctx.config.sourceIds,
    query,
    mode,
    k,
    ...(ctx.config.filter ? { filter: ctx.config.filter } : {}),
    ...(ctx.config.minScore !== undefined ? { minScore: ctx.config.minScore } : {}),
  });
}

const hitsOut = z.object({
  hits: z.array(hitSchema),
  mode: z.enum(["vector", "keyword", "hybrid"]),
  count: z.int().min(0),
});

const settle = (r: KnowledgeSearchResult) =>
  ok(
    { hits: r.hits as Hit[], mode: r.mode, count: r.hits.length },
    { ...(r.usage ? { usage: r.usage } : {}), costUsd: r.costUsd },
  );

export const retrieverNode = defineNode({
  id: "flowaid.retrieval.retriever",
  version: "1.0.0",
  metadata: {
    name: "Retrieve",
    description:
      "Finds the chunks most similar to a query by embedding similarity in the chosen knowledge sources.",
    category: "retrieval",
    icon: "search",
    tags: ["retrieval", "rag", "vector search"],
    summary: "top {{ config.k }}",
  },
  configSchema: z.strictObject(searchConfig),
  inputSchema: z.object({ query: z.string().min(1) }),
  outputSchema: hitsOut,
  capabilities: ["knowledge"],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 60000 },
  execute: async (ctx, input) => settle(await search(ctx, input.query, "vector")),
});

export const hybridSearchNode = defineNode({
  id: "flowaid.retrieval.hybrid_search",
  version: "1.0.0",
  metadata: {
    name: "Hybrid search",
    description:
      "Searches by embedding similarity and by keywords at once and fuses the two rankings (reciprocal rank fusion): exact terms and meaning both count.",
    category: "retrieval",
    icon: "search-check",
    tags: ["retrieval", "rag", "hybrid", "bm25", "full-text"],
    summary: "{{ config.mode }} · top {{ config.k }}",
  },
  configSchema: z.strictObject({
    ...searchConfig,
    mode: z.enum(["hybrid", "vector", "keyword"]).default("hybrid"),
  }),
  inputSchema: z.object({ query: z.string().min(1) }),
  outputSchema: hitsOut,
  capabilities: ["knowledge"],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 60000 },
  execute: async (ctx, input) => settle(await search(ctx, input.query, ctx.config.mode)),
});

async function rerankHits(
  ctx: ExecutionContext<unknown>,
  model: ModelRef,
  query: string,
  hits: Hit[],
  topK: number,
  minScore: number | undefined,
) {
  if (hits.length === 0) return { hits, usage: undefined, costUsd: 0 };
  const provider = ctx.providers.rerank(model, { credentialSlot: "rerank" });
  const r = await provider.rerank(
    query,
    hits.map((h) => h.content),
    callCtx(ctx),
  );
  const ranked = r.scores
    .map((score, i) => ({ score, i }))
    .filter((x) => minScore === undefined || x.score >= minScore)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, topK)
    .map((x) => ({ ...(hits[x.i] as Hit), searchScore: hits[x.i]?.score ?? 0, score: x.score }));
  return { hits: ranked, usage: r.usage, costUsd: r.costUsd };
}

const rerankCredential = {
  name: "rerank",
  types: ["cohere.api_key", "jina.api_key", "openai.api_key"],
  required: false,
  description:
    "Key for the rerank provider (openai.api_key with a baseUrl for rerank-compatible servers).",
};

export const retrievalRerankNode = defineNode({
  id: "flowaid.retrieval.rerank",
  version: "1.0.0",
  metadata: {
    name: "Rerank hits",
    description:
      "Reorders search hits by relevance to the query with a rerank model and keeps the best; each hit keeps its search score as searchScore.",
    category: "retrieval",
    icon: "list-ordered",
    tags: ["retrieval", "rag", "rerank"],
    summary: "{{ config.model.provider }}/{{ config.model.model }}",
  },
  configSchema: z.strictObject({
    model: modelRef,
    topK: z.int().min(1).max(100).default(5),
    minScore: z.number().optional(),
  }),
  inputSchema: z.object({ query: z.string().min(1), hits: z.array(hitSchema) }),
  outputSchema: z.object({ hits: z.array(hitSchema), count: z.int().min(0) }),
  credentials: [{ ...rerankCredential, required: true }],
  capabilities: ["generation", "credentials"],
  idempotency: "safe",
  generation: true,
  defaultPolicy: { timeoutMs: 60000 },
  execute: async (ctx, input) => {
    const r = await rerankHits(
      ctx,
      ctx.config.model,
      input.query,
      input.hits,
      ctx.config.topK,
      ctx.config.minScore,
    );
    return ok(
      { hits: r.hits, count: r.hits.length },
      { ...(r.usage ? { usage: r.usage } : {}), costUsd: r.costUsd },
    );
  },
});

/** A numbered context block with a source line per passage, cut at the token budget. */
export function contextBlock(hits: Hit[], maxTokens: number): { context: string; used: Hit[] } {
  const parts: string[] = [];
  const used: Hit[] = [];
  let tokens = 0;
  for (const h of hits) {
    const n = used.length + 1;
    const cite = [h.title, h.uri].filter(Boolean).join(" — ");
    const part = `[${n}]${cite ? ` ${cite}` : ""}\n${h.content.trim()}`;
    const t = Math.ceil(part.length / 4);
    if (used.length > 0 && tokens + t > maxTokens) break;
    parts.push(part);
    used.push(h);
    tokens += t;
  }
  return { context: parts.join("\n\n"), used };
}

export const knowledgeBaseNode = defineNode({
  id: "flowaid.retrieval.knowledge_base",
  version: "1.0.0",
  metadata: {
    name: "Knowledge base",
    description:
      "Answers a query from your knowledge sources in one step: hybrid search, an optional rerank, and a numbered, cited context block sized for a prompt.",
    category: "retrieval",
    icon: "library",
    tags: ["retrieval", "rag", "knowledge", "context"],
    summary: "{{ config.mode }} · top {{ config.k }}",
  },
  configSchema: z.strictObject({
    ...searchConfig,
    mode: z.enum(["hybrid", "vector", "keyword"]).default("hybrid"),
    rerank: modelRef
      .optional()
      .meta({ "x-ui": { widget: "model", help: "Optional: rerank the hits with this model." } }),
    maxContextTokens: z.int().min(100).max(100000).default(3000),
  }),
  inputSchema: z.object({ query: z.string().min(1) }),
  outputSchema: z.object({
    context: z.string(),
    hits: z.array(hitSchema),
    citations: z.array(
      z.object({
        n: z.int().min(1),
        title: z.string().nullable(),
        uri: z.string().nullable(),
        sourceId: z.string(),
        documentId: z.string(),
      }),
    ),
    found: z.boolean(),
  }),
  credentials: [rerankCredential],
  capabilities: ["knowledge", "generation", "credentials"],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 60000 },
  execute: async (ctx, input) => {
    const c = ctx.config;
    // with a reranker, fetch a wider candidate set for it to choose from
    const r = await search(ctx, input.query, c.mode, c.rerank ? Math.min(100, c.k * 4) : c.k);
    let hits = r.hits as Hit[];
    let costUsd = r.costUsd;
    const usage = {
      inputTokens: r.usage?.inputTokens ?? 0,
      outputTokens: r.usage?.outputTokens ?? 0,
    };
    if (c.rerank) {
      const rr = await rerankHits(ctx, c.rerank, input.query, hits, c.k, undefined);
      hits = rr.hits;
      costUsd += rr.costUsd;
      usage.inputTokens += rr.usage?.inputTokens ?? 0;
      usage.outputTokens += rr.usage?.outputTokens ?? 0;
    }
    const { context, used } = contextBlock(hits, c.maxContextTokens);
    return ok(
      {
        context,
        hits: used,
        citations: used.map((h, i) => ({
          n: i + 1,
          title: h.title,
          uri: h.uri,
          sourceId: h.sourceId,
          documentId: h.documentId,
        })),
        found: used.length > 0,
      },
      { costUsd, ...(usage.inputTokens || usage.outputTokens ? { usage } : {}) },
    );
  },
});
