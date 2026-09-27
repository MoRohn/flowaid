import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import type { JsonValue } from "@flowaid/workflow-core";

/** A JSON value's shape for the log: type, size and the first keys. */
export function describeValue(value: JsonValue): JsonValue {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (typeof value === "object") {
    const keys = Object.keys(value);
    return { type: "object", keys: keys.slice(0, 20), size: keys.length };
  }
  if (typeof value === "string") return { type: "string", length: value.length };
  return { type: typeof value };
}

export const debugNode = defineNode({
  id: "flowaid.dev.debug",
  version: "1.0.0",
  metadata: {
    name: "Debug",
    description:
      "Logs a value (in full or its shape) with a label, the run's variables when asked, and passes the value through unchanged.",
    category: "developer",
    icon: "bug",
    tags: ["developer", "debug", "log"],
    summary: "{{ config.label }}",
  },
  configSchema: z.strictObject({
    label: z.string().min(1).max(200).default("debug"),
    show: z
      .enum(["value", "shape"])
      .default("value")
      .meta({
        "x-ui": { widget: "select", help: "The shape hides the content (types, sizes, keys)." },
      }),
    includeVars: z
      .boolean()
      .default(false)
      .meta({ "x-ui": { widget: "switch" } }),
    level: z
      .enum(["debug", "info", "warn"])
      .default("debug")
      .meta({ "x-ui": { widget: "select" } }),
  }),
  inputSchema: z.object({ value: z.unknown().optional() }),
  outputSchema: z.object({ value: z.unknown() }),
  capabilities: [],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 5000 },
  execute: (ctx, input) => {
    const value = (input.value ?? null) as JsonValue;
    const shown = ctx.config.show === "shape" ? describeValue(value) : value;
    ctx.logger[ctx.config.level](ctx.config.label, {
      value: shown,
      ...(ctx.config.includeVars ? { vars: { ...ctx.vars } } : {}),
      attempt: ctx.node.attempt,
      ...(ctx.scope.index !== undefined ? { index: ctx.scope.index } : {}),
      ...(ctx.scope.iteration !== undefined ? { iteration: ctx.scope.iteration } : {}),
    });
    return Promise.resolve(ok({ value }));
  },
});
