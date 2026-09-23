import { z } from "zod";
import { defineNode } from "@flowaid/node-sdk";
import { DecisionResultJsonSchema, type JsonValue } from "@flowaid/workflow-core";
import { decide, decisionState, instructions, withSpend } from "../common.js";

export const booleanNode = defineNode({
  id: "flowaid.decision.boolean",
  version: "1.0.0",
  metadata: {
    name: "Boolean",
    description:
      "Answers a yes/no question about `state` with `pYes` and `confidence = max(pYes, 1 - pYes)` (TypeSafe boolean decision).",
    category: "decision",
    icon: "toggle-left",
    tags: ["decision", "typesafe"],
    summary: "{{ config.instructions }}",
  },
  configSchema: z.strictObject({
    instructions: instructions(),
    criteria: z
      .strictObject({ true: z.string(), false: z.string() })
      .optional()
      .meta({
        "x-ui": {
          widget: "criteria",
          help: "Optional descriptions of what makes the answer true or false (both or none).",
        },
      }),
  }),
  inputSchema: z.object({ state: decisionState }),
  outputSchema: z.object({
    decision: z.unknown().meta({ "x-jsonSchema": DecisionResultJsonSchema.boolean }),
  }),
  credentials: [{ name: "typesafe", types: ["typesafe.api_key"], required: true }],
  capabilities: ["decision", "credentials"],
  idempotency: "safe",
  decision: { kind: "boolean" },
  defaultPolicy: { timeoutMs: 30000 },
  execute: async (ctx, input) => {
    const r = await decide(
      ctx,
      {
        kind: "boolean",
        instructions: ctx.config.instructions,
        ...(ctx.config.criteria ? { criteria: ctx.config.criteria } : {}),
      },
      input.state as JsonValue,
    );
    if ("suspended" in r) return r.suspended;
    return withSpend({ decision: r.decision }, [r.decision]);
  },
});
