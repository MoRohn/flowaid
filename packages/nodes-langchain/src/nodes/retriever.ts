/**
 * `langchain.retriever`: retrieves documents for a query from a vector store with a strategy —
 * similarity, maximal marginal relevance (diverse results), multi-query (a chat model writes query
 * variants, results fused by reciprocal rank) or hybrid (vector recall re-ranked with BM25).
 */
import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { BadRequestError } from "@flowaid/workflow-core";
import {
  LLM_SLOT,
  Spend,
  chatModelFor,
  combined,
  documentSchema,
  embeddingsFor,
  fromDocument,
  handlerFor,
  modelRef,
  nodeId,
  rethrow,
} from "../common.js";
import { FlowaidRetriever } from "../retrieval.js";
import { STORE_SLOT, openStore, storeFields } from "../storeConfig.js";

export const retrieverNode = defineNode({
  id: nodeId("retriever"),
  version: "1.0.0",
  metadata: {
    name: "Retriever",
    description:
      "Retrieves the documents most relevant to a query from a vector store: similarity, MMR (diverse), multi-query (LLM query variants, fused) or hybrid (vector + BM25).",
    category: "retrieval",
    icon: "search",
    tags: ["langchain", "rag", "retrieval", "bm25", "mmr"],
    summary: "{{ config.strategy }} · k={{ config.k }}",
  },
  configSchema: z.strictObject({
    ...storeFields,
    embeddingModel: modelRef,
    strategy: z
      .enum(["similarity", "mmr", "multi_query", "hybrid"])
      .default("hybrid")
      .meta({ "x-ui": { widget: "select" } }),
    k: z.int().min(1).max(50).default(4),
    fetchK: z.int().min(1).max(200).default(20),
    lambda: z
      .number()
      .min(0)
      .max(1)
      .default(0.5)
      .meta({
        "x-ui": {
          showWhen: { path: "/strategy", equals: "mmr" },
          help: "1 = relevance only, 0 = diversity only.",
        },
      }),
    queries: z
      .int()
      .min(1)
      .max(8)
      .default(3)
      .meta({ "x-ui": { showWhen: { path: "/strategy", equals: "multi_query" } } }),
    model: modelRef.optional().meta({
      "x-ui": { widget: "model", showWhen: { path: "/strategy", equals: "multi_query" } },
    }),
    scoreThreshold: z.number().min(-1).max(1).optional(),
  }),
  inputSchema: z.object({
    query: z.string().min(1),
    filter: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  }),
  outputSchema: z.object({
    documents: z.array(documentSchema),
    context: z.string(),
    count: z.int().min(0),
  }),
  credentials: [{ ...LLM_SLOT, required: false }, STORE_SLOT],
  capabilities: ["generation", "credentials", "network", "state"],
  idempotency: "safe",
  generation: true,
  defaultPolicy: { timeoutMs: 60_000 },
  execute: async (ctx, input) => {
    const c = ctx.config;
    if (c.strategy === "multi_query" && !c.model)
      throw new BadRequestError("the multi_query strategy needs `model`");
    const spend = new Spend();
    const handler = handlerFor(ctx);
    const signal = combined(ctx, handler);
    const store = await openStore(ctx, c, embeddingsFor(ctx, c.embeddingModel, { spend }));
    const retriever = new FlowaidRetriever({
      store,
      strategy: c.strategy,
      k: c.k,
      fetchK: Math.max(c.fetchK, c.k),
      lambda: c.lambda,
      queries: c.queries,
      ...(c.scoreThreshold !== undefined ? { scoreThreshold: c.scoreThreshold } : {}),
      ...(input.filter ? { filter: input.filter } : {}),
      ...(c.model
        ? {
            model: chatModelFor(ctx, c.model, {
              spend,
              handler,
              signal,
              settings: { temperature: 0.3 },
            }),
          }
        : {}),
    });
    let docs;
    try {
      docs = await retriever.invoke(input.query, { callbacks: [handler], signal });
    } catch (error) {
      rethrow(handler, error);
    }
    const documents = docs.map(fromDocument);
    // A ready-to-prompt context block with numbered, citable sources.
    const context = documents
      .map((d, i) => {
        const source = typeof d.metadata.source === "string" ? ` (${d.metadata.source})` : "";
        return `[${i + 1}]${source}\n${d.pageContent}`;
      })
      .join("\n\n");
    return ok({ documents, context, count: documents.length }, spend.extra);
  },
});
