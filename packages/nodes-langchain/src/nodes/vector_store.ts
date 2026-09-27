/**
 * `langchain.vector_store`: upsert, query or delete against a vector store (`store`
 * discriminator: durable workspace store, Qdrant, Pinecone). Upserts use deterministic ids, so
 * re-ingesting a document replaces its chunks instead of duplicating them. Documents that arrive
 * with precomputed `vectors` (from `langchain.embed`) are not embedded again.
 */
import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { BadRequestError } from "@flowaid/workflow-core";
import {
  LLM_SLOT,
  Spend,
  documentSchema,
  embeddingsFor,
  fromDocument,
  modelRef,
  nodeId,
  toDocument,
} from "../common.js";
import { STORE_SLOT, openStore, storeFields } from "../storeConfig.js";

const filterSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export const vectorStoreNode = defineNode({
  id: nodeId("vector_store"),
  version: "1.0.0",
  metadata: {
    name: "Vector store",
    description:
      "Upserts, queries or deletes documents in a vector store: the durable workspace store, Qdrant or Pinecone.",
    category: "retrieval",
    icon: "database",
    tags: ["langchain", "rag", "vector", "qdrant", "pinecone"],
    summary: "{{ config.operation }} · {{ config.store }}/{{ config.collection }}",
  },
  configSchema: z.strictObject({
    operation: z
      .enum(["upsert", "query", "delete"])
      .default("upsert")
      .meta({ "x-ui": { widget: "select" } }),
    ...storeFields,
    embeddingModel: modelRef,
    k: z.int().min(1).max(100).default(4),
    scoreThreshold: z.number().min(-1).max(1).optional(),
  }),
  inputSchema: z.object({
    documents: z.array(documentSchema).optional(),
    vectors: z.array(z.array(z.number())).optional(),
    query: z.string().optional(),
    ids: z.array(z.string()).optional(),
    filter: filterSchema.optional(),
  }),
  outputSchema: z.object({
    ids: z.array(z.string()),
    hits: z.array(documentSchema.extend({ score: z.number() })),
    count: z.int().min(0),
  }),
  credentials: [{ ...LLM_SLOT, required: false }, STORE_SLOT],
  capabilities: ["generation", "credentials", "network", "state"],
  idempotency: "safe",
  generation: true,
  defaultPolicy: { timeoutMs: 120_000 },
  execute: async (ctx, input) => {
    const c = ctx.config;
    const spend = new Spend();
    const embeddings = embeddingsFor(ctx, c.embeddingModel, { spend });
    const store = await openStore(ctx, c, embeddings);
    if (c.operation === "upsert") {
      const docs = (input.documents ?? []).map(toDocument);
      if (docs.length === 0) return ok({ ids: [], hits: [], count: 0 });
      const ids =
        input.vectors && input.vectors.length === docs.length
          ? await store.addVectors(input.vectors, docs)
          : await store.addDocuments(docs);
      return ok({ ids, hits: [], count: ids.length }, spend.extra);
    }
    if (c.operation === "delete") {
      if (!input.ids?.length && !input.filter)
        throw new BadRequestError("delete needs `ids` or a `filter`");
      await store.delete({
        ...(input.ids?.length ? { ids: input.ids } : {}),
        ...(input.filter ? { filter: input.filter } : {}),
      });
      return ok({ ids: input.ids ?? [], hits: [], count: input.ids?.length ?? 0 });
    }
    if (!input.query) throw new BadRequestError("query needs `query`");
    const results = await store.similaritySearchWithScore(input.query, c.k, input.filter);
    const hits = results
      .filter(([, score]) => c.scoreThreshold === undefined || score >= c.scoreThreshold)
      .map(([doc, score]) => ({ ...fromDocument(doc), score }));
    return ok({ ids: hits.map((h) => h.id ?? ""), hits, count: hits.length }, spend.extra);
  },
});
