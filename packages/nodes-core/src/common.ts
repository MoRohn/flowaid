/** Schemas and helpers shared by the core nodes. */
import { z } from "zod";
import { HumanFallbackSignal } from "@flowaid/providers";
import {
  CredentialError,
  type DecisionCallContext,
  type DecisionQuestion,
  type DecisionResult,
  type HumanResponse,
  type JsonObject,
  type JsonValue,
  type ProviderHop,
} from "@flowaid/workflow-core";
import { ok, suspend, type ExecutionContext, type NodeResult } from "@flowaid/node-sdk";

/** TypeSafe state: text, an object (sent verbatim) or an array of text. */
export const decisionState = z
  .union([z.string(), z.record(z.string(), z.unknown()), z.array(z.string())])
  .describe("TypeSafe state: text, an object (sent verbatim) or an array of text.");

export const instructions = (help?: string) =>
  z
    .string()
    .min(1)
    .max(4000)
    .meta({ "x-ui": help ? { widget: "textarea", help } : { widget: "textarea" } });

export const modelRef = z
  .looseObject({ provider: z.string().min(1), model: z.string().min(1) })
  .meta({ "x-ui": { widget: "model" } });

export const usageSchema = z.object({ inputTokens: z.int().min(0), outputTokens: z.int().min(0) });

export const LLM_SLOT: { name: string; types: string[]; required: boolean; description: string } = {
  name: "llm",
  types: ["openai.api_key", "anthropic.api_key", "ollama.none"],
  required: false,
  description:
    "Optional LLM decision provider used when a failover hop (or the workspace chain) routes decisions to a chat model.",
};

export const callCtx = (
  ctx: ExecutionContext<unknown>,
  booleanThreshold?: number,
): DecisionCallContext => ({
  signal: ctx.signal,
  runId: ctx.run.id,
  nodeRunId: ctx.node.nodeRunId,
  idempotencyKey: ctx.node.idempotencyKey,
  ...(booleanThreshold !== undefined ? { booleanThreshold } : {}),
});

/** A decision answered by a person after every provider failed (resume of a failover suspension). */
export function humanDecision(
  question: DecisionQuestion,
  response: HumanResponse,
  by: string,
): DecisionResult {
  const base = {
    confidence: 1,
    provider: "human",
    model: `human:${by}`,
    latencyMs: 0,
    costUsd: 0,
    attempts: [],
  };
  if (question.kind === "boolean") {
    const yes = response.action === "approve";
    return {
      ...base,
      kind: "boolean",
      value: yes,
      pYes: yes ? 1 : 0,
      probabilities: { true: yes ? 1 : 0, false: yes ? 0 : 1 },
    };
  }
  if (question.kind === "choice") {
    const value =
      response.action === "choose" ? response.option : (Object.keys(question.options)[0] ?? "");
    return {
      ...base,
      kind: "choice",
      value,
      probabilities: Object.fromEntries(
        Object.keys(question.options).map((k) => [k, k === value ? 1 : 0]),
      ),
    };
  }
  const level =
    response.action === "choose" ? Math.max(0, question.levels.indexOf(response.option)) : 0;
  const n = question.levels.length;
  return {
    ...base,
    kind: "score",
    value: level,
    normalized: n > 1 ? level / (n - 1) : 0,
    level,
    levelLabel: question.levels[level] ?? String(level),
    levels: question.levels,
    probabilities: Object.fromEntries(
      question.levels.map((_, i) => [String(i), i === level ? 1 : 0]),
    ),
  };
}

/** The human request that stands in for a decision once every provider failed. */
export function failoverRequest(question: DecisionQuestion, state: JsonValue, title: string) {
  const mode =
    question.kind === "boolean"
      ? ({ type: "approval" } as const)
      : ({
          type: "choice",
          options:
            question.kind === "choice"
              ? Object.entries(question.options).map(([id, label]) => ({ id, label }))
              : question.levels.map((label) => ({
                  id:
                    label
                      .toLowerCase()
                      .replace(/[^a-z0-9_]+/g, "_")
                      .slice(0, 64) || "level",
                  label,
                })),
        } as const);
  return {
    title: title.slice(0, 200),
    context: { question: question.instructions, state } as JsonObject,
    mode,
    assignees: [],
    expiresAt: null,
    externalReview: false,
  };
}

/**
 * Runs one decision through the chain. When every provider fails and the chain ends in `human`,
 * the node suspends with a human task (`origin: decision_failover` is set by the runtime) and, on
 * resume, returns the person's answer as a decision with provider `human` and confidence 1.
 */
export async function decide(
  ctx: ExecutionContext<unknown>,
  question: DecisionQuestion,
  state: JsonValue,
  opts: { chain?: readonly ProviderHop[]; booleanThreshold?: number } = {},
): Promise<{ decision: DecisionResult } | { suspended: NodeResult<never> }> {
  if (ctx.resume?.kind === "human")
    return { decision: humanDecision(question, ctx.resume.response, ctx.resume.by) };
  const provider = ctx.providers.decision(opts.chain ?? []);
  const call = callCtx(ctx, opts.booleanThreshold);
  try {
    const decision =
      question.kind === "boolean"
        ? await provider.decideBoolean(state as never, question, call)
        : question.kind === "choice"
          ? await provider.decideChoice(state as never, question, call)
          : await provider.decideScore(state as never, question, call);
    return { decision };
  } catch (error) {
    if (error instanceof HumanFallbackSignal)
      return {
        suspended: suspend(
          {
            kind: "human",
            request: failoverRequest(question, state, `Decide: ${question.instructions}`),
          },
          { question },
        ),
      };
    if (error instanceof CredentialError) throw error;
    throw error;
  }
}

/** `ok` with the decision's usage and cost. */
export function withSpend<T>(
  output: T,
  decisions: readonly DecisionResult[],
  route?: string,
): NodeResult<T> {
  const costUsd = decisions.reduce((a, d) => a + d.costUsd, 0);
  const usage = decisions.reduce(
    (a, d) => ({
      inputTokens: a.inputTokens + (d.usage?.inputTokens ?? 0),
      outputTokens: a.outputTokens + (d.usage?.outputTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0 },
  );
  return ok(output, {
    costUsd,
    usage,
    ...(route ? { route } : {}),
    ...(decisions.length === 1 && decisions[0] ? { decision: decisions[0] } : {}),
  });
}
