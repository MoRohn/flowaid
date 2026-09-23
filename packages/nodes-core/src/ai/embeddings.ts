import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { callCtx, modelRef, usageSchema } from "../common.js";

export const embeddingsNode = defineNode({
  id: "flowaid.ai.embeddings",
  version: "1.0.0",
  metadata: {
    name: "Embeddings",
    description:
      "Embeds one text or a list of texts with an embedding model; returns one vector per text.",
    category: "generation",
    icon: "binary",
    tags: ["ai", "embeddings", "retrieval"],
    summary: "{{ config.model.provider }}/{{ config.model.model }}",
  },
  configSchema: z.strictObject({
    model: modelRef,
    batchSize: z.int().min(1).max(2048).default(96),
  }),
  inputSchema: z.object({ texts: z.union([z.string(), z.array(z.string())]) }),
  outputSchema: z.object({
    vectors: z.array(z.array(z.number())),
    dimensions: z.int().min(0),
    usage: usageSchema,
  }),
  credentials: [{ name: "llm", types: ["openai.api_key", "ollama.none"], required: true }],
  capabilities: ["generation", "credentials"],
  idempotency: "safe",
  generation: true,
  optionProviders: { models: () => Promise.resolve([]) },
  defaultPolicy: { timeoutMs: 60000 },
  execute: async (ctx, input) => {
    const texts = typeof input.texts === "string" ? [input.texts] : input.texts;
    const provider = ctx.providers.embedding(ctx.config.model, {
      credentialSlot: "llm",
    });
    const vectors: number[][] = [];
    const usage = { inputTokens: 0, outputTokens: 0 };
    let costUsd = 0;
    for (let i = 0; i < texts.length; i += ctx.config.batchSize) {
      const r = await provider.embed(texts.slice(i, i + ctx.config.batchSize), callCtx(ctx));
      vectors.push(...r.vectors);
      usage.inputTokens += r.usage.inputTokens;
      usage.outputTokens += r.usage.outputTokens;
      costUsd += r.costUsd;
    }
    return ok(
      { vectors, dimensions: vectors[0]?.length ?? provider.dimensions, usage },
      { usage, costUsd },
    );
  },
});
