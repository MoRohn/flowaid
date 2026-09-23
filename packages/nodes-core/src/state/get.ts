import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import type { JsonValue } from "@flowaid/workflow-core";

export const stateNamespace = z
  .enum(["run", "session", "workspace"])
  .default("session")
  .meta({
    "x-ui": {
      widget: "select",
      help: "run: this run only; session: the conversation/session; workspace: shared across runs.",
    },
  });

export const stateKey = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{1,200}$/)
  .meta({ "x-ui": { widget: "template" } });

export const stateGetNode = defineNode({
  id: "flowaid.state.get",
  version: "1.0.0",
  metadata: {
    name: "Get state",
    description:
      "Reads a value from durable key/value state (run, session or workspace scope). Missing keys return `default`.",
    category: "state",
    icon: "database",
    tags: ["state", "memory"],
    summary: "{{ config.namespace }}:{{ config.key }}",
  },
  configSchema: z.strictObject({
    namespace: stateNamespace,
    key: stateKey,
    default: z
      .unknown()
      .optional()
      .meta({ "x-ui": { widget: "json" } }),
  }),
  inputSchema: z.object({}),
  outputSchema: z.object({ value: z.unknown(), found: z.boolean() }),
  capabilities: ["state"],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 10000 },
  execute: async (ctx) => {
    const stored = await ctx.state.get(ctx.config.namespace, ctx.config.key);
    const found = stored !== null;
    return ok({ value: found ? stored : ((ctx.config.default ?? null) as JsonValue), found });
  },
});
