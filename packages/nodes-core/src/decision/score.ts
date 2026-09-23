import { z } from "zod";
import { defineNode } from "@flowaid/node-sdk";
import { DecisionResultJsonSchema, type JsonValue } from "@flowaid/workflow-core";
import { LLM_SLOT, decide, decisionState, instructions, withSpend } from "../common.js";

export const scoreNode = defineNode({
  id: "flowaid.decision.score",
  version: "1.0.0",
  metadata: {
    name: "Score",
    description:
      "Rates `state` on an ordered scale of 2–10 described levels; returns the probability-weighted `value`, its `normalized` form, the nearest `level` and its label (TypeSafe score decision).",
    category: "decision",
    icon: "gauge",
    tags: ["decision", "typesafe", "rating"],
    summary: "{{ config.instructions }}",
  },
  configSchema: z.strictObject({
    instructions: instructions(),
    levels: z
      .array(z.string().min(1))
      .min(2)
      .max(10)
      .meta({ "x-ui": { widget: "levels", help: "Level descriptions, lowest first." } }),
  }),
  inputSchema: z.object({ state: decisionState }),
  outputSchema: z.object({
    decision: z.unknown().meta({ "x-jsonSchema": DecisionResultJsonSchema.score }),
  }),
  credentials: [{ name: "typesafe", types: ["typesafe.api_key"], required: false }, LLM_SLOT],
  capabilities: ["decision", "credentials"],
  idempotency: "safe",
  decision: { kind: "score" },
  defaultPolicy: { timeoutMs: 30000 },
  execute: async (ctx, input) => {
    const r = await decide(
      ctx,
      { kind: "score", instructions: ctx.config.instructions, levels: ctx.config.levels },
      input.state as JsonValue,
    );
    if ("suspended" in r) return r.suspended;
    return withSpend({ decision: r.decision }, [r.decision]);
  },
});
