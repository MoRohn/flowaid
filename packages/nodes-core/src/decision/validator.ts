import { z } from "zod";
import { defineNode } from "@flowaid/node-sdk";
import { DecisionResultJsonSchema, type JsonValue } from "@flowaid/workflow-core";
import { LLM_SLOT, decide, withSpend } from "../common.js";

/** Checks a value against a rubric with one boolean decision (§6.3). */
export const validatorNode = defineNode({
  id: "flowaid.decision.validator",
  version: "1.0.0",
  metadata: {
    name: "Validator",
    description:
      "Asks whether `value` satisfies the rubric (optionally against a `reference`) as a boolean decision; fires `valid` when pYes ≥ threshold, else `invalid`. Passes the value through.",
    category: "safety",
    icon: "badge-check",
    tags: ["decision", "quality", "guardrail"],
    summary: "{{ config.rubric }}",
  },
  configSchema: z.strictObject({
    rubric: z
      .string()
      .min(1)
      .max(4000)
      .meta({ "x-ui": { widget: "textarea" } }),
    criteria: z
      .strictObject({ true: z.string(), false: z.string() })
      .optional()
      .meta({ "x-ui": { widget: "criteria" } }),
    threshold: z
      .number()
      .min(0)
      .max(1)
      .default(0.5)
      .meta({ "x-ui": { widget: "slider", min: 0, max: 1, step: 0.01 } }),
  }),
  inputSchema: z.object({ value: z.unknown(), reference: z.unknown().optional() }),
  outputSchema: z.object({
    decision: z.unknown().meta({ "x-jsonSchema": DecisionResultJsonSchema.boolean }),
    value: z.unknown(),
  }),
  controlPorts: [
    { name: "valid", label: "Valid", description: "pYes ≥ threshold." },
    { name: "invalid", label: "Invalid", description: "pYes < threshold." },
  ],
  credentials: [{ name: "typesafe", types: ["typesafe.api_key"], required: false }, LLM_SLOT],
  capabilities: ["decision", "credentials"],
  idempotency: "safe",
  decision: { kind: "validator" },
  defaultPolicy: { timeoutMs: 30000 },
  execute: async (ctx, input) => {
    const state = {
      value: (input.value ?? null) as JsonValue,
      ...(input.reference !== undefined ? { reference: input.reference as JsonValue } : {}),
    };
    const r = await decide(
      ctx,
      {
        kind: "boolean",
        instructions: `Does \`value\` satisfy this rubric? ${ctx.config.rubric}`,
        ...(ctx.config.criteria ? { criteria: ctx.config.criteria } : {}),
      },
      state,
      { booleanThreshold: ctx.config.threshold },
    );
    if ("suspended" in r) return r.suspended;
    const pYes = r.decision.kind === "boolean" ? r.decision.pYes : r.decision.confidence;
    return withSpend(
      { decision: r.decision, value: input.value },
      [r.decision],
      pYes >= ctx.config.threshold ? "valid" : "invalid",
    );
  },
});
