import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import type { JsonValue } from "@flowaid/workflow-core";
import { callCtx, modelRef } from "../common.js";

/** A document's text: a string, or a string field of an object (`textField`). */
export function documentText(doc: unknown, field: string): string {
  if (typeof doc === "string") return doc;
  if (doc && typeof doc === "object" && !Array.isArray(doc)) {
    const value = (doc as Record<string, unknown>)[field];
    if (typeof value === "string") return value;
  }
  return JSON.stringify(doc ?? null);
}

export const rerankNode = defineNode({
  id: "flowaid.ai.rerank",
  version: "1.0.0",
  metadata: {
    name: "Rerank",
    description:
      "Orders documents by relevance to a query with a rerank model (Cohere, Jina or any OpenAI-compatible /rerank endpoint) and keeps the best `topK` above `minScore`.",
    category: "retrieval",
    icon: "list-ordered",
    tags: ["retrieval", "rerank", "rag"],
    summary: "{{ config.model.provider }}/{{ config.model.model }}",
  },
  configSchema: z.strictObject({
    model: modelRef,
    topK: z.int().min(1).max(1000).default(5),
    minScore: z.number().min(-1000).max(1000).optional(),
    textField: z
      .string()
      .min(1)
      .max(100)
      .default("text")
      .meta({ "x-ui": { help: "Field read when documents are objects." } }),
  }),
  inputSchema: z.object({
    query: z.string().min(1),
    documents: z.array(z.unknown()),
  }),
  outputSchema: z.object({
    documents: z.array(z.unknown()),
    scores: z.array(z.number()),
    indices: z.array(z.int().min(0)),
  }),
  credentials: [
    {
      name: "rerank",
      types: ["cohere.api_key", "jina.api_key", "openai.api_key"],
      required: true,
      description:
        "Key for the rerank provider (openai.api_key with a baseUrl for rerank-compatible servers).",
    },
  ],
  capabilities: ["generation", "credentials"],
  idempotency: "safe",
  generation: true,
  defaultPolicy: { timeoutMs: 60000 },
  execute: async (ctx, input) => {
    if (input.documents.length === 0) return ok({ documents: [], scores: [], indices: [] });
    const provider = ctx.providers.rerank(ctx.config.model, { credentialSlot: "rerank" });
    const texts = input.documents.map((d) => documentText(d, ctx.config.textField));
    const r = await provider.rerank(input.query, texts, callCtx(ctx));
    const min = ctx.config.minScore;
    const ranked = r.scores
      .map((score, index) => ({ score, index }))
      .filter((x) => min === undefined || x.score >= min)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, ctx.config.topK);
    return ok(
      {
        documents: ranked.map((x) => (input.documents[x.index] ?? null) as JsonValue),
        scores: ranked.map((x) => x.score),
        indices: ranked.map((x) => x.index),
      },
      { ...(r.usage ? { usage: r.usage } : {}), costUsd: r.costUsd },
    );
  },
});
