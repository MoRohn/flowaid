import { z } from "zod";
import { defineNode } from "@flowaid/node-sdk";
import { DecisionResultJsonSchema } from "@flowaid/workflow-core";
import { LLM_SLOT, decide, withSpend } from "../common.js";

export const DEFAULT_MODERATION_CATEGORIES: Record<string, string> = {
  hate: "Attacks or demeans people for a protected attribute.",
  harassment: "Threatens, bullies or targets a specific person.",
  self_harm: "Encourages or describes self-harm or suicide.",
  sexual: "Sexually explicit content.",
  violence: "Graphic violence or credible threats of violence.",
  illegal: "Instructions or solicitation for clearly illegal activity.",
};

/** A choice decision over `safe` + the configured harm categories; `flagged` unless `safe` wins with enough confidence. */
export const moderationNode = defineNode({
  id: "flowaid.safety.moderation",
  version: "1.0.0",
  metadata: {
    name: "Moderation",
    description:
      "Classifies text as `safe` or one of the harm categories with calibrated probabilities (TypeSafe choice decision). Fires `safe` or `flagged`; `category` names the most likely one.",
    category: "safety",
    icon: "shield-alert",
    tags: ["safety", "moderation", "decision"],
    summary: "moderation",
  },
  configSchema: z.strictObject({
    categories: z
      .record(z.string().regex(/^[a-z0-9_]{1,64}$/), z.string())
      .default(DEFAULT_MODERATION_CATEGORIES)
      .meta({
        "x-ui": {
          widget: "keyvalue",
          help: "Category id → what it covers. `safe` is added automatically.",
        },
      }),
    maxHarmProbability: z
      .number()
      .min(0)
      .max(1)
      .default(0.2)
      .meta({
        "x-ui": {
          widget: "slider",
          min: 0,
          max: 1,
          step: 0.01,
          help: "Flag when the combined probability of the harm categories exceeds this.",
        },
      }),
  }),
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({
    decision: z.unknown().meta({ "x-jsonSchema": DecisionResultJsonSchema.choice }),
    flagged: z.boolean(),
    category: z.string(),
    harm_probability: z.number().min(0).max(1),
  }),
  controlPorts: [
    { name: "safe", label: "Safe", description: "Harm probability ≤ maxHarmProbability." },
    { name: "flagged", label: "Flagged", description: "Harm probability > maxHarmProbability." },
  ],
  credentials: [{ name: "typesafe", types: ["typesafe.api_key"], required: false }, LLM_SLOT],
  capabilities: ["decision", "credentials"],
  idempotency: "safe",
  decision: { kind: "choice" },
  defaultPolicy: { timeoutMs: 30000 },
  execute: async (ctx, input) => {
    const options = { safe: "None of the harm categories apply.", ...ctx.config.categories };
    const r = await decide(
      ctx,
      { kind: "choice", instructions: "Which content category best describes this text?", options },
      input.text,
    );
    if ("suspended" in r) return r.suspended;
    const probs = r.decision.kind === "choice" ? r.decision.probabilities : {};
    const harmProbability = Math.min(
      1,
      Object.entries(probs).reduce((a, [k, p]) => (k === "safe" ? a : a + p), 0),
    );
    const worst =
      Object.entries(probs)
        .filter(([k]) => k !== "safe")
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "safe";
    const flagged = harmProbability > ctx.config.maxHarmProbability;
    return withSpend(
      {
        decision: r.decision,
        flagged,
        category: flagged ? worst : "safe",
        harm_probability: harmProbability,
      },
      [r.decision],
      flagged ? "flagged" : "safe",
    );
  },
});
