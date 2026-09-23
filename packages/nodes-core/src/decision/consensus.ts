import { z } from "zod";
import { defineNode } from "@flowaid/node-sdk";
import {
  ProviderHopSchema,
  SchemaValidationError,
  type DecisionQuestion,
  type DecisionResult,
  type JsonValue,
} from "@flowaid/workflow-core";
import { LLM_SLOT, callCtx, decisionState, withSpend } from "../common.js";

const questionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("boolean"),
    instructions: z.string().min(1),
    criteria: z.strictObject({ true: z.string(), false: z.string() }).optional(),
  }),
  z.strictObject({
    kind: z.literal("choice"),
    instructions: z.string().min(1),
    options: z.record(z.string().regex(/^[a-z0-9_]{1,64}$/), z.string()),
  }),
  z.strictObject({
    kind: z.literal("score"),
    instructions: z.string().min(1),
    levels: z.array(z.string()).min(2).max(10),
  }),
]);

/** The distribution of a decision as option → probability (boolean: "true"/"false"). */
function distribution(d: DecisionResult): Record<string, number> {
  if (d.kind === "boolean") return { true: d.pYes, false: 1 - d.pYes };
  return d.probabilities;
}

/** The value a voter chose, as a key of the distribution. */
function chosen(d: DecisionResult): string {
  return d.kind === "score" ? String(d.level) : String(d.value);
}

/**
 * Combines voters (§6.3): probabilities are the confidence-weighted mean of their distributions,
 * renormalised; the winner is the top option (majority / confidence_weighted) and agreement the
 * share of voters that chose it; `confidence = agreement × mean(voter confidence)`.
 */
export function combine(
  question: DecisionQuestion,
  votes: readonly DecisionResult[],
  method: "majority" | "confidence_weighted" | "unanimous",
): { decision: DecisionResult; agreement: number } {
  const keys = new Set<string>();
  for (const v of votes) for (const k of Object.keys(distribution(v))) keys.add(k);
  const weights = votes.map((v) => (method === "confidence_weighted" ? v.confidence : 1));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const mixed: Record<string, number> = {};
  for (const k of keys)
    mixed[k] =
      votes.reduce((a, v, i) => a + (distribution(v)[k] ?? 0) * (weights[i] ?? 0), 0) / total;
  const sum = Object.values(mixed).reduce((a, b) => a + b, 0) || 1;
  for (const k of keys) mixed[k] = (mixed[k] ?? 0) / sum;
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(chosen(v), (counts.get(chosen(v)) ?? 0) + 1);
  const byVotes = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || (mixed[b[0]] ?? 0) - (mixed[a[0]] ?? 0),
  );
  const winner =
    method === "confidence_weighted"
      ? (Object.entries(mixed).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "")
      : (byVotes[0]?.[0] ?? "");
  const agreement = (counts.get(winner) ?? 0) / votes.length;
  const meanConfidence = votes.reduce((a, v) => a + v.confidence, 0) / votes.length;
  const confidence = agreement * meanConfidence;
  const common = {
    provider: "consensus",
    model: "consensus:v1",
    confidence,
    latencyMs: Math.max(...votes.map((v) => v.latencyMs)),
    costUsd: votes.reduce((a, v) => a + v.costUsd, 0),
    raw: { votes: votes as unknown as JsonValue },
    attempts: votes.flatMap((v) => v.attempts),
  };
  let decision: DecisionResult;
  if (question.kind === "boolean") {
    const p = mixed.true ?? 0;
    decision = {
      ...common,
      kind: "boolean",
      value: winner === "true",
      pYes: p,
      probabilities: { true: p, false: 1 - p },
    };
  } else if (question.kind === "choice") {
    decision = { ...common, kind: "choice", value: winner, probabilities: mixed };
  } else {
    const n = question.levels.length;
    const value = Object.entries(mixed).reduce((a, [k, p]) => a + Number(k) * p, 0);
    const level = Math.min(n - 1, Math.max(0, Number(winner)));
    decision = {
      ...common,
      kind: "score",
      value,
      normalized: n > 1 ? value / (n - 1) : 0,
      level,
      levelLabel: question.levels[level] ?? String(level),
      levels: question.levels,
      probabilities: mixed,
    };
  }
  return { decision, agreement };
}

export const consensusNode = defineNode({
  id: "flowaid.decision.consensus",
  version: "1.0.0",
  metadata: {
    name: "Consensus",
    description:
      "Asks the same question of 2–5 distinct providers and combines their answers (majority, confidence-weighted or unanimous). Fires `agreed` when enough voters agree, else `disagreed`.",
    category: "decision",
    icon: "users",
    tags: ["decision", "ensemble", "reliability"],
    summary: "{{ config.method }} of {{ config.voters | json }}",
  },
  configSchema: z.strictObject({
    question: questionSchema.meta({ "x-ui": { widget: "questions" } }),
    voters: z.array(ProviderHopSchema).min(2).max(5),
    method: z.enum(["majority", "confidence_weighted", "unanimous"]).default("majority"),
    minAgreement: z.number().min(0).max(1).default(0.6),
  }),
  inputSchema: z.object({ state: decisionState }),
  outputSchema: z.object({ decision: z.unknown(), agreement: z.number().min(0).max(1) }),
  controlPorts: [
    {
      name: "agreed",
      label: "Agreed",
      description: "Agreement ≥ minAgreement (unanimous: all voters agree).",
    },
    { name: "disagreed", label: "Disagreed", description: "The voters did not agree enough." },
  ],
  credentials: [{ name: "typesafe", types: ["typesafe.api_key"], required: false }, LLM_SLOT],
  capabilities: ["decision", "credentials"],
  idempotency: "safe",
  decision: { kind: "consensus" },
  defaultPolicy: { timeoutMs: 60000 },
  execute: async (ctx, input) => {
    const voters = ctx.config.voters;
    const keys = voters.map((v) => JSON.stringify(v));
    if (voters.some((v) => v.provider === "human"))
      throw new SchemaValidationError("E_DECISION_CONFIG: a consensus voter cannot be human", [
        { path: "/voters", message: "automated providers only" },
      ]);
    if (voters.length < 2 || new Set(keys).size !== keys.length)
      throw new SchemaValidationError(
        "E_DECISION_CONFIG: consensus needs at least two distinct voters",
        [{ path: "/voters", message: "two to five distinct provider hops" }],
      );
    const question = ctx.config.question;
    const votes: DecisionResult[] = [];
    for (const voter of voters) {
      const provider = ctx.providers.decision([voter]);
      const state = input.state as never;
      votes.push(
        question.kind === "boolean"
          ? await provider.decideBoolean(state, question, callCtx(ctx))
          : question.kind === "choice"
            ? await provider.decideChoice(state, question, callCtx(ctx))
            : await provider.decideScore(state, question, callCtx(ctx)),
      );
    }
    const { decision, agreement } = combine(question, votes, ctx.config.method);
    const agreed =
      ctx.config.method === "unanimous" ? agreement === 1 : agreement >= ctx.config.minAgreement;
    return withSpend({ decision, agreement }, [decision], agreed ? "agreed" : "disagreed");
  },
});
