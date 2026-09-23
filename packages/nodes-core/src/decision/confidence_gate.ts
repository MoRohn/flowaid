import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";

const gateDecision = z.unknown().meta({
  "x-jsonSchema": {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["boolean", "choice", "score"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["kind", "value", "confidence"],
  },
});

export type GateOutcome = "pass" | "review" | "fail";

/**
 * The gate semantics (ARCHITECTURE.md §6.3), defined once: `pass` iff confidence ≥ threshold and
 * (not requireValue, or a boolean decision with value true); else `fail` iff reviewBand is set and
 * confidence < threshold − reviewBand; else `review`. A requireValue failure is `fail` with a
 * reviewBand, else `review`.
 */
export function gateOutcome(
  decision: { kind?: unknown; value?: unknown; confidence?: unknown },
  threshold: number,
  requireValue: boolean,
  reviewBand?: number,
): GateOutcome {
  const confidence = typeof decision.confidence === "number" ? decision.confidence : 0;
  const valueOk = !requireValue || (decision.kind === "boolean" && decision.value === true);
  if (confidence >= threshold && valueOk) return "pass";
  if (reviewBand !== undefined && (!valueOk || confidence < threshold - reviewBand)) return "fail";
  return "review";
}

export const confidenceGateNode = defineNode({
  id: "flowaid.decision.confidence_gate",
  version: "1.0.0",
  metadata: {
    name: "Confidence gate",
    description:
      "Routes a decision by confidence: `pass` when it reaches `threshold` (and, with `requireValue`, a boolean value is true); otherwise `review` — or, with `reviewBand`, `review` only inside `[threshold − reviewBand, threshold)` and `fail` below it. Passes the decision through and reports `passed` and `outcome`.",
    category: "safety",
    icon: "shield-check",
    tags: ["decision", "safety", "routing"],
    summary: "threshold {{ config.threshold }}",
  },
  configSchema: z
    .strictObject({
      threshold: z
        .number()
        .min(0)
        .max(1)
        .meta({ "x-ui": { widget: "slider", bindable: true, min: 0, max: 1, step: 0.01 } }),
      requireValue: z
        .boolean()
        .default(false)
        .meta({
          "x-ui": {
            widget: "switch",
            help: "Also require a boolean decision value of true to pass.",
          },
        }),
      reviewBand: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .meta({
          "x-ui": {
            widget: "slider",
            min: 0,
            max: 1,
            step: 0.01,
            help: "Optional. Width of the review band below the threshold: confidences in [threshold − reviewBand, threshold) go to review, lower ones to fail. Unset, the gate is two-way (pass/review).",
          },
        }),
    })
    .describe(
      "`pass` iff `confidence ≥ threshold` and (`requireValue` is false or the decision is boolean with `value === true`); otherwise `fail` iff `reviewBand` is set and `confidence < threshold − reviewBand`; otherwise `review`. Without `reviewBand` the gate is two-way (`pass`/`review`, as in §2.9); with it the band `[threshold − reviewBand, threshold)` goes to review and everything below to `fail`; a `requireValue` failure routes `fail` when `reviewBand` is set, else `review`. The UI's two-threshold model maps onto this as `auto := threshold`, `review := threshold − (reviewBand ?? threshold)`, with outcome names `pass | review | fail`.",
    ),
  inputSchema: z.object({ decision: gateDecision }),
  outputSchema: z.object({
    decision: gateDecision.meta({ "x-port": { description: "The input decision, unchanged." } }),
    passed: z.boolean().meta({ "x-port": { description: "`true` iff `outcome` is `pass`." } }),
    outcome: z.enum(["pass", "review", "fail"]).meta({
      "x-port": {
        description:
          "The control port the gate fired: `pass`, `review` or `fail` (§6.3 gate semantics).",
      },
    }),
  }),
  controlPorts: [
    {
      name: "pass",
      label: "Pass",
      description: "confidence ≥ threshold (and, with requireValue, a boolean value of true).",
    },
    {
      name: "review",
      label: "Needs review",
      description:
        "Below threshold; with reviewBand only within [threshold − reviewBand, threshold).",
    },
    {
      name: "fail",
      label: "Fail",
      description:
        "Only with reviewBand: confidence < threshold − reviewBand, or a requireValue failure.",
    },
  ],
  capabilities: [],
  idempotency: "safe",
  decision: { kind: "gate" },
  execute: (ctx, input) => {
    const decision = (input.decision ?? {}) as {
      kind?: unknown;
      value?: unknown;
      confidence?: unknown;
    };
    const outcome = gateOutcome(
      decision,
      ctx.config.threshold,
      ctx.config.requireValue,
      ctx.config.reviewBand,
    );
    return Promise.resolve(
      ok({ decision: input.decision, passed: outcome === "pass", outcome }, { route: outcome }),
    );
  },
});
