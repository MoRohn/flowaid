/**
 * flowaid questions ⇄ System One questions and answers (ARCHITECTURE.md §6.3):
 *
 * | flowaid  | TypeSafe                     | answer → DecisionResult                                        |
 * | -------- | ---------------------------- | -------------------------------------------------------------- |
 * | boolean  | noul (criteria true/false)   | pYes = noul, value = noul ≥ threshold, confidence = max(p,1−p) |
 * | choice   | choice (criteria = options)  | value, confidence, probabilities (keys ⊆ options)              |
 * | score    | score (criteria = levels)    | value, normalized, level, levelLabel, levels (legend order)    |
 *
 * Also the client-side size guard: the state plus the longest question must fit 32k tokens and
 * the whole request 64k, estimated at 3.5 characters per token.
 */
import {
  BoundsExceededError,
  ProviderError,
  type BooleanDecision,
  type ChoiceDecision,
  type DecisionQuestion,
  type DecisionResult,
  type DecisionState,
  type ScoreDecision,
  type TokenUsage,
} from "@flowaid/workflow-core";
import {
  TYPESAFE_INPUT_PRICE_PER_TOKEN,
  TYPESAFE_MAX_REQUEST_TOKENS,
  TYPESAFE_MAX_STATE_TOKENS,
  type SystemOneAnswer,
  type SystemOneQuestion,
  type SystemOneRequest,
} from "./schemas.js";

export const CHARS_PER_TOKEN = 3.5;
export const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

export function toSystemOneQuestion(q: DecisionQuestion): SystemOneQuestion {
  switch (q.kind) {
    case "boolean":
      return {
        type: "noul",
        instructions: q.instructions,
        ...(q.criteria ? { criteria: q.criteria } : {}),
      };
    case "choice":
      return { type: "choice", instructions: q.instructions, criteria: q.options };
    case "score":
      return { type: "score", instructions: q.instructions, criteria: q.levels };
  }
}

/** Throws BoundsExceededError('maxTokens') before a request the API would refuse. */
export function assertSize(
  state: DecisionState,
  questions: Readonly<Record<string, DecisionQuestion>>,
): void {
  const stateTokens = estimateTokens(typeof state === "string" ? state : JSON.stringify(state));
  const questionTokens = Object.values(questions).map((q) =>
    estimateTokens(JSON.stringify(toSystemOneQuestion(q))),
  );
  const longest = Math.max(0, ...questionTokens);
  const total = stateTokens + questionTokens.reduce((a, b) => a + b, 0);
  if (stateTokens + longest > TYPESAFE_MAX_STATE_TOKENS || total > TYPESAFE_MAX_REQUEST_TOKENS) {
    const limit =
      stateTokens + longest > TYPESAFE_MAX_STATE_TOKENS
        ? TYPESAFE_MAX_STATE_TOKENS
        : TYPESAFE_MAX_REQUEST_TOKENS;
    const error = new BoundsExceededError(
      "maxTokens",
      limit,
      Math.max(stateTokens + longest, total),
    );
    error.message = `${error.message}: the decision state is too large for one TypeSafe request; chunk the state (ForEach + Chunker)`;
    throw error;
  }
}

export function toSystemOneRequest(
  model: string,
  state: DecisionState,
  questions: Readonly<Record<string, DecisionQuestion>>,
): SystemOneRequest {
  assertSize(state, questions);
  return {
    model,
    state,
    questions: Object.fromEntries(
      Object.entries(questions).map(([id, q]) => [id, toSystemOneQuestion(q)]),
    ),
  };
}

export interface AnswerMeta {
  model: string;
  latencyMs: number;
  usage: TokenUsage;
  costUsd: number;
  requestId: string | null;
  booleanThreshold?: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function fromSystemOneAnswer(
  id: string,
  answer: SystemOneAnswer,
  question: DecisionQuestion,
  meta: AnswerMeta,
): DecisionResult {
  const common = {
    provider: "typesafe",
    model: meta.model,
    latencyMs: meta.latencyMs,
    usage: meta.usage,
    costUsd: meta.costUsd,
    ...(meta.requestId ? { requestId: meta.requestId } : {}),
    raw: answer as never,
    attempts: [
      {
        provider: "typesafe",
        model: meta.model,
        outcome: "ok" as const,
        latencyMs: meta.latencyMs,
      },
    ],
  };
  const mismatch = () =>
    new ProviderError(
      `TypeSafe answered '${id}' with a ${answer.type} answer for a ${question.kind} question`,
      true,
      "typesafe",
    );
  switch (question.kind) {
    case "boolean": {
      if (answer.type !== "noul") throw mismatch();
      const p = clamp01(answer.noul);
      const result: BooleanDecision = {
        ...common,
        kind: "boolean",
        value: p >= (meta.booleanThreshold ?? 0.5),
        pYes: p,
        probabilities: { true: p, false: 1 - p },
        confidence: Math.max(p, 1 - p),
      };
      return result;
    }
    case "choice": {
      if (answer.type !== "choice") throw mismatch();
      const options = new Set(Object.keys(question.options));
      const unknown = [answer.choice, ...Object.keys(answer.probabilities)].filter(
        (k) => !options.has(k),
      );
      if (unknown.length > 0)
        throw new ProviderError(
          `TypeSafe answered '${id}' with unknown options: ${[...new Set(unknown)].join(", ")}`,
          true,
          "typesafe",
        );
      const result: ChoiceDecision = {
        ...common,
        kind: "choice",
        value: answer.choice,
        confidence: answer.confidence,
        probabilities: answer.probabilities,
      };
      return result;
    }
    case "score": {
      if (answer.type !== "score") throw mismatch();
      const legend = Object.entries(answer.legend).sort((a, b) => Number(a[0]) - Number(b[0]));
      const levels = legend.length >= 2 ? legend.map(([, label]) => label) : question.levels;
      const n = levels.length;
      const value = Math.min(n - 1, Math.max(0, answer.score));
      const level = Math.min(n - 1, Math.max(0, Math.round(value)));
      const result: ScoreDecision = {
        ...common,
        kind: "score",
        value,
        normalized: n > 1 ? value / (n - 1) : 0,
        level,
        levelLabel: levels[level] ?? String(level),
        levels,
        confidence: answer.confidence,
        probabilities: answer.probabilities,
      };
      return result;
    }
  }
}

/** Splits a batch's usage and cost across its answers (input tokens evenly, remainder to the first). */
export function splitUsage(
  usage: TokenUsage,
  ids: readonly string[],
): Map<string, { usage: TokenUsage; costUsd: number }> {
  const n = Math.max(1, ids.length);
  const base = Math.floor(usage.inputTokens / n);
  const out = new Map<string, { usage: TokenUsage; costUsd: number }>();
  ids.forEach((id, i) => {
    const inputTokens = base + (i === 0 ? usage.inputTokens - base * n : 0);
    const outputTokens = i === 0 ? usage.outputTokens : 0;
    out.set(id, {
      usage: { inputTokens, outputTokens },
      costUsd: inputTokens * TYPESAFE_INPUT_PRICE_PER_TOKEN,
    });
  });
  return out;
}
