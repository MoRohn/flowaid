import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import type { JsonValue } from "@flowaid/workflow-core";

export const logNode = defineNode({
  id: "flowaid.dev.log",
  version: "1.0.0",
  metadata: {
    name: "Log",
    description:
      "Writes a message (and optionally the input value) to the run log at the chosen level, then passes the value through.",
    category: "developer",
    icon: "scroll-text",
    tags: ["developer", "debug", "log"],
    summary: "{{ config.level }}: {{ config.message }}",
  },
  configSchema: z.strictObject({
    level: z
      .enum(["debug", "info", "warn", "error"])
      .default("info")
      .meta({ "x-ui": { widget: "select" } }),
    message: z
      .string()
      .min(1)
      .max(4000)
      .meta({ "x-ui": { widget: "template" } }),
    includeValue: z
      .boolean()
      .default(true)
      .meta({ "x-ui": { widget: "switch" } }),
  }),
  inputSchema: z.object({ value: z.unknown().optional() }),
  outputSchema: z.object({ value: z.unknown() }),
  capabilities: [],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 5000 },
  execute: (ctx, input) => {
    const value = (input.value ?? null) as JsonValue;
    ctx.logger[ctx.config.level](ctx.config.message, ctx.config.includeValue ? value : undefined);
    return Promise.resolve(ok({ value }));
  },
});
