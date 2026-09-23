import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { SchemaValidationError, stableStringifyJson, type JsonValue } from "../jsonHelpers.js";

export const jsonNode = defineNode({
  id: "flowaid.data.json",
  version: "1.0.0",
  metadata: {
    name: "JSON",
    description:
      "Parses JSON text into a value, or serialises a value to JSON text (optionally pretty or with sorted keys).",
    category: "data",
    icon: "braces",
    tags: ["data", "json"],
    summary: "{{ config.mode }}",
  },
  configSchema: z.strictObject({
    mode: z
      .enum(["parse", "stringify"])
      .default("parse")
      .meta({ "x-ui": { widget: "select" } }),
    pretty: z
      .boolean()
      .default(false)
      .meta({ "x-ui": { widget: "switch", showWhen: { path: "/mode", oneOf: ["stringify"] } } }),
    sortKeys: z
      .boolean()
      .default(false)
      .meta({ "x-ui": { widget: "switch", showWhen: { path: "/mode", oneOf: ["stringify"] } } }),
  }),
  inputSchema: z.object({ value: z.unknown() }),
  outputSchema: z.object({ result: z.unknown() }),
  capabilities: [],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 10000 },
  execute: (ctx, input) => {
    const value = (input.value ?? null) as JsonValue;
    if (ctx.config.mode === "parse") {
      if (typeof value !== "string") return Promise.resolve(ok({ result: value }));
      try {
        return Promise.resolve(ok({ result: JSON.parse(value) as JsonValue }));
      } catch (error) {
        throw new SchemaValidationError("the input is not valid JSON", [
          { path: "/value", message: error instanceof Error ? error.message : "invalid JSON" },
        ]);
      }
    }
    const text = ctx.config.sortKeys
      ? stableStringifyJson(value, ctx.config.pretty)
      : JSON.stringify(value, null, ctx.config.pretty ? 2 : undefined);
    return Promise.resolve(ok({ result: text }));
  },
});
