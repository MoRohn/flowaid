import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import type { JsonValue } from "@flowaid/workflow-core";
import { flowExprField } from "../itemExpr.js";

/** The runtime evaluates `config.expr` (a FlowExpr compiled as a config binding); the node returns it. */
export const transformNode = defineNode({
  id: "flowaid.data.transform",
  version: "1.0.0",
  metadata: {
    name: "Transform",
    description:
      "Computes a value with a FlowExpr expression over other nodes' outputs. `output` optionally declares the result's JSON Schema.",
    category: "data",
    icon: "function-square",
    tags: ["data", "expression"],
    summary: "{{ config.expr }}",
  },
  configSchema: z.strictObject({
    expr: flowExprField(),
    output: z
      .record(z.string(), z.unknown())
      .optional()
      .meta({
        "x-ui": {
          widget: "schema",
          help: "JSON Schema of the result; the compiler checks the expression against it.",
        },
      }),
  }),
  inputSchema: z.object({}),
  outputSchema: z.object({ result: z.unknown() }),
  portRules: [{ kind: "outputSchemaFromConfig", port: "result", path: "/output" }],
  capabilities: [],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 10000 },
  execute: (ctx) => Promise.resolve(ok({ result: (ctx.config.expr ?? null) as JsonValue })),
});
