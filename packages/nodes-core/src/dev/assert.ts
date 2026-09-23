import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { NodeExecutionError, type JsonValue } from "@flowaid/workflow-core";
import { flowExprField } from "../itemExpr.js";

export const assertNode = defineNode({
  id: "flowaid.dev.assert",
  version: "1.0.0",
  metadata: {
    name: "Assert",
    description:
      "Fails the run with `message` unless `condition` (a FlowExpr) is true. Use it to pin invariants in flows and evaluations.",
    category: "developer",
    icon: "badge-alert",
    tags: ["developer", "test", "invariant"],
    summary: "{{ config.condition }}",
  },
  configSchema: z.strictObject({
    condition: flowExprField(),
    message: z
      .string()
      .min(1)
      .max(1000)
      .default("assertion failed")
      .meta({ "x-ui": { widget: "template" } }),
  }),
  inputSchema: z.object({ value: z.unknown().optional() }),
  outputSchema: z.object({ value: z.unknown() }),
  capabilities: [],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 5000 },
  execute: (ctx, input) => {
    // `condition` is compiled as a config expression, so here it holds the evaluated value.
    const held = ctx.config.condition;
    if (held !== true)
      throw new NodeExecutionError(ctx.config.message, false, {
        condition: (held ?? null) as JsonValue,
      });
    return Promise.resolve(ok({ value: (input.value ?? null) as JsonValue }));
  },
});
