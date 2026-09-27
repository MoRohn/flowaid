import { z } from "zod";
import { defineNode } from "@flowaid/node-sdk";
import { ExpressionError, type DecisionResult, type JsonValue } from "@flowaid/workflow-core";
import { LLM_SLOT, decide, withSpend } from "../common.js";
import { compileItemExpr, evalForItem } from "../itemExpr.js";

/** A rule's FlowExpr: evaluated with `$scope.item` = the subject; true means the rule is violated. */
const RULE_EXPR_UI = {
  widget: "code",
  language: "flowexpr-item",
  help: "True means the rule is violated. `$scope.item` is the subject, `$vars` the workflow variables.",
} as const;

export interface PolicyViolation {
  rule: string;
  message: string;
}

export const policyCheckNode = defineNode({
  id: "flowaid.safety.policy_check",
  version: "1.0.0",
  metadata: {
    name: "Policy check",
    description:
      "Checks a subject against deterministic rules (FlowExpr) and, optionally, a yes/no policy question answered by a decision model. Fires `allow` or `deny` with every violation listed.",
    category: "safety",
    icon: "scale",
    tags: ["safety", "policy", "compliance"],
    summary: "{{ config.rules.length }} rules",
  },
  configSchema: z.strictObject({
    rules: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
          when: z.string().min(1).max(4000).meta({ "x-ui": RULE_EXPR_UI }),
          message: z.string().min(1).max(500),
        }),
      )
      .max(100)
      .default([]),
    question: z
      .strictObject({
        instructions: z
          .string()
          .min(1)
          .max(4000)
          .meta({
            "x-ui": {
              widget: "textarea",
              help: "A yes/no question; yes means the subject violates the policy.",
            },
          }),
        threshold: z.number().min(0.5).max(1).default(0.5),
      })
      .optional(),
    stopAtFirst: z
      .boolean()
      .default(false)
      .meta({
        "x-ui": { widget: "switch", help: "Skip the remaining checks after the first violation." },
      }),
  }),
  inputSchema: z.object({ subject: z.unknown() }),
  outputSchema: z.object({
    allowed: z.boolean(),
    violations: z.array(z.object({ rule: z.string(), message: z.string() })),
    decision: z.unknown(),
  }),
  controlPorts: [
    { name: "allow", label: "Allow", description: "No rule was violated." },
    { name: "deny", label: "Deny", description: "At least one rule was violated." },
  ],
  credentials: [{ name: "typesafe", types: ["typesafe.api_key"], required: false }, LLM_SLOT],
  capabilities: ["decision", "credentials"],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 30000 },
  execute: async (ctx, input) => {
    const subject = (input.subject ?? null) as JsonValue;
    const violations: PolicyViolation[] = [];
    for (const rule of ctx.config.rules) {
      let hit: JsonValue;
      try {
        hit = evalForItem(compileItemExpr(rule.when), subject, 0, ctx.vars, () => ctx.clock.now());
      } catch (error) {
        throw new ExpressionError(
          `rule ${rule.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (hit === true) {
        violations.push({ rule: rule.id, message: rule.message });
        if (ctx.config.stopAtFirst) break;
      }
    }
    const decisions: DecisionResult[] = [];
    const q = ctx.config.question;
    if (q && !(ctx.config.stopAtFirst && violations.length > 0)) {
      const r = await decide(ctx, { kind: "boolean", instructions: q.instructions }, subject, {
        booleanThreshold: q.threshold,
      });
      if ("suspended" in r) return r.suspended;
      decisions.push(r.decision);
      if (r.decision.kind === "boolean" && (r.decision.pYes ?? 0) >= q.threshold)
        violations.push({ rule: "question", message: q.instructions });
    }
    const allowed = violations.length === 0;
    return withSpend(
      { allowed, violations, decision: decisions[0] ?? null },
      decisions,
      allowed ? "allow" : "deny",
    );
  },
});
