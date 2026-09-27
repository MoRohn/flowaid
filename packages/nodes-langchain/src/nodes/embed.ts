/**
 * `langchain.embed`: embeds texts or documents through LangChain's `Embeddings` interface
 * (`FlowaidEmbeddings` over the node's embedding provider, native or `langchain:<vendor>`).
 */
import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import {
  LLM_SLOT,
  Spend,
  documentSchema,
  embeddingsFor,
  modelRef,
  nodeId,
  usageSchema,
} from "../common.js";

export const embedNode = defineNode({
  id: nodeId("embed"),
  version: "1.0.0",
  metadata: {
    name: "LangChain embed",
    description:
      "Embeds texts or documents with an embedding model; one vector per item, in order.",
    category: "retrieval",
    icon: "binary",
    tags: ["langchain", "rag", "embeddings"],
    summary: "{{ config.model.provider }}/{{ config.model.model }}",
  },
  configSchema: z.strictObject({
    model: modelRef,
    batchSize: z.int().min(1).max(2048).default(96),
  }),
  inputSchema: z.object({
    texts: z.union([z.string(), z.array(z.string())]).optional(),
    documents: z.array(documentSchema).optional(),
  }),
  outputSchema: z.object({
    vectors: z.array(z.array(z.number())),
    dimensions: z.int().min(0),
    usage: usageSchema,
  }),
  credentials: [LLM_SLOT],
  capabilities: ["generation", "credentials"],
  idempotency: "safe",
  generation: true,
  defaultPolicy: { timeoutMs: 120_000 },
  execute: async (ctx, input) => {
    const texts = [
      ...(input.texts === undefined
        ? []
        : typeof input.texts === "string"
          ? [input.texts]
          : input.texts),
      ...(input.documents ?? []).map((d) => d.pageContent),
    ];
    // Nothing to embed is not an error in a pipeline (e.g. no new knowledge): no provider call.
    if (texts.length === 0)
      return ok({ vectors: [], dimensions: 0, usage: { inputTokens: 0, outputTokens: 0 } });
    const spend = new Spend();
    const vectors = await embeddingsFor(ctx, ctx.config.model, {
      spend,
      batchSize: ctx.config.batchSize,
    }).embedDocuments(texts);
    return ok({ vectors, dimensions: vectors[0]?.length ?? 0, usage: spend.usage }, spend.extra);
  },
});
