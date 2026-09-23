import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { deepMerge, isObject, type JsonObject, type JsonValue } from "../jsonHelpers.js";

export const mergeNode = defineNode({
  id: "flowaid.data.merge",
  version: "1.0.0",
  metadata: {
    name: "Merge",
    description:
      "Combines a list of values: objects merge (shallow or deep, later wins), arrays concatenate, or `first` takes the first non-null value.",
    category: "data",
    icon: "merge",
    tags: ["data", "merge", "join"],
    summary: "{{ config.strategy }}",
  },
  configSchema: z.strictObject({
    strategy: z
      .enum(["shallow", "deep", "concat", "first"])
      .default("shallow")
      .meta({ "x-ui": { widget: "select" } }),
    arrays: z
      .enum(["replace", "concat"])
      .default("replace")
      .meta({ "x-ui": { widget: "select", showWhen: { path: "/strategy", oneOf: ["deep"] } } }),
  }),
  inputSchema: z.object({
    values: z.array(z.unknown()).describe("Values to combine, in order (later values win)."),
  }),
  outputSchema: z.object({ result: z.unknown() }),
  capabilities: [],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 10000 },
  execute: (ctx, input) => {
    const values = input.values.filter((v) => v !== undefined) as JsonValue[];
    let result: JsonValue;
    switch (ctx.config.strategy) {
      case "first":
        result = values.find((v) => v !== null) ?? null;
        break;
      case "concat":
        result = values.flatMap((v) => (Array.isArray(v) ? v : v === null ? [] : [v]));
        break;
      case "shallow":
        result = values.filter(isObject).reduce<JsonObject>((a, v) => ({ ...a, ...v }), {});
        break;
      case "deep":
        result = values
          .filter((v) => v !== null)
          .reduce<JsonValue>((a, b) => deepMerge(a, b, ctx.config.arrays), {});
        break;
    }
    return Promise.resolve(ok({ result }));
  },
});
