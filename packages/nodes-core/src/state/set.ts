import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import type { JsonValue } from "@flowaid/workflow-core";
import { stateKey, stateNamespace } from "./get.js";

export const stateSetNode = defineNode({
  id: "flowaid.state.set",
  version: "1.0.0",
  metadata: {
    name: "Set state",
    description:
      "Writes a value to durable key/value state (run, session or workspace scope), optionally with a time-to-live.",
    category: "state",
    icon: "database-zap",
    tags: ["state", "memory"],
    summary: "{{ config.namespace }}:{{ config.key }}",
  },
  configSchema: z.strictObject({
    namespace: stateNamespace,
    key: stateKey,
    ttlMs: z.int().min(1000).max(31_536_000_000).optional(),
  }),
  inputSchema: z.object({ value: z.unknown() }),
  outputSchema: z.object({ value: z.unknown() }),
  capabilities: ["state"],
  // Writing the same value twice leaves the same state.
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 10000 },
  execute: async (ctx, input) => {
    const value = (input.value ?? null) as JsonValue;
    await ctx.state.set(
      ctx.config.namespace,
      ctx.config.key,
      value,
      ctx.config.ttlMs !== undefined ? { ttlMs: ctx.config.ttlMs } : undefined,
    );
    return ok({ value });
  },
});
