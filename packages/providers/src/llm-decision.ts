/**
 * `LLMDecisionProvider` (ARCHITECTURE.md §6.4): typed decisions from a chat model, for workspaces
 * without a TypeSafe key or as a failover hop.
 *
 * One structured request per batch when the model supports JSON Schema (strict), otherwise JSON
 * in text with a repair pass. Per kind the model returns: boolean `{ p_yes }`; choice
 * `{ choice, probabilities }`; score `{ probabilities: number[n] }`. Distributions whose sum lies
 * in [0.9, 1.1] are renormalised; anything else (or a choice that matches no option) triggers
 * one re-ask that names the problems, then a non-retryable ProviderError. A paraphrased choice
 * key is mapped to the option with similarity ≥ 0.9 and its confidence multiplied by 0.8.
 * Calibration is not assumed: the evaluation package reports ECE per provider.
 */
import { sha256Hex } from "@flowaid/shared";
import {
  ProviderError,
  type BooleanQuestion,
  type ChoiceQuestion,
  type DecisionCallContext,
  type DecisionProvider,
  type DecisionQuestion,
  type DecisionResult,
  type DecisionState,
  type GenerationProvider,
  type GenerationResult,
  type JsonSchema,
  type JsonValue,
  type ScoreQuestion,
  type TokenUsage,
} from "@flowaid/workflow-core";
import {
  booleanDecision,
  choiceDecision,
  matchOption,
  renormalise,
  scoreDecision,
  type ResultMeta,
} from "./decisionMath.js";

const FUZZY_CONFIDENCE_FACTOR = 0.8;
const MAX_QUESTIONS = 32;

export const LLM_DECISION_SYSTEM_PROMPT = [
  "You are a careful, calibrated judge. You answer typed questions about a STATE.",
  "For every question give probabilities that reflect your real uncertainty: use values near 0 or 1 only when the STATE leaves no doubt.",
  "Judge only from the STATE and each question's instructions and criteria; do not invent facts.",
  "Reply with JSON only, exactly matching the requested shape.",
].join(" ");

/** The JSON Schema the model's answer to one question must match. */
export function questionSchema(question: DecisionQuestion): JsonSchema {
  switch (question.kind) {
    case "boolean":
      return {
        type: "object",
        properties: { p_yes: { type: "number", minimum: 0, maximum: 1 } },
        required: ["p_yes"],
        additionalProperties: false,
      };
    case "choice": {
      const keys = Object.keys(question.options);
      return {
        type: "object",
        properties: {
          choice: { type: "string", enum: keys },
          probabilities: {
            type: "object",
            properties: Object.fromEntries(
              keys.map((k) => [k, { type: "number", minimum: 0, maximum: 1 }]),
            ),
            required: keys,
            additionalProperties: false,
          },
        },
        required: ["choice", "probabilities"],
        additionalProperties: false,
      };
    }
    case "score":
      return {
        type: "object",
        properties: {
          probabilities: {
            type: "array",
            items: { type: "number", minimum: 0, maximum: 1 },
            minItems: question.levels.length,
            maxItems: question.levels.length,
          },
        },
        required: ["probabilities"],
        additionalProperties: false,
      };
  }
}

export function batchSchema(questions: Record<string, DecisionQuestion>): JsonSchema {
  const ids = Object.keys(questions);
  return {
    type: "object",
    properties: Object.fromEntries(
      ids.map((id) => [id, questionSchema(questions[id] as DecisionQuestion)]),
    ),
    required: ids,
    additionalProperties: false,
  };
}

function describeQuestion(id: string, q: DecisionQuestion): string {
  const lines = [`- "${id}" (${q.kind}): ${q.instructions}`];
  if (q.kind === "boolean") {
    if (q.criteria)
      lines.push(`  true means: ${q.criteria.true}`, `  false means: ${q.criteria.false}`);
    lines.push('  Answer { "p_yes": probability that the answer is true }.');
  } else if (q.kind === "choice") {
    for (const [key, description] of Object.entries(q.options))
      lines.push(`  option "${key}": ${description}`);
    lines.push(
      '  Answer { "choice": the most likely option key, "probabilities": { option key: probability } } (probabilities sum to 1).',
    );
  } else {
    q.levels.forEach((level, i) => lines.push(`  level ${i}: ${level}`));
    lines.push(
      `  Answer { "probabilities": [p for level 0 … level ${q.levels.length - 1}] } (sums to 1).`,
    );
  }
  return lines.join("\n");
}

export function decisionPrompt(
  state: DecisionState,
  questions: Record<string, DecisionQuestion>,
): string {
  const stateText = typeof state === "string" ? state : JSON.stringify(state, null, 2);
  return [
    "STATE:",
    stateText,
    "",
    "QUESTIONS:",
    ...Object.entries(questions).map(([id, q]) => describeQuestion(id, q)),
    "",
    `Reply with one JSON object whose keys are exactly: ${Object.keys(questions)
      .map((id) => `"${id}"`)
      .join(", ")}.`,
  ].join("\n");
}

/** Parses the first JSON object in `text` (models sometimes wrap it in prose or a code fence). */
export function parseJsonLoose(text: string): JsonValue | undefined {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return undefined;
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as JsonValue;
    } catch {
      return undefined;
    }
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

type Interpreted =
  | { ok: true; build: (meta: ResultMeta, threshold?: number) => DecisionResult }
  | { ok: false; problem: string };

/** Turns one raw answer into a result builder, or names what is wrong with it. */
export function interpret(id: string, question: DecisionQuestion, answer: unknown): Interpreted {
  if (!isRecord(answer)) return { ok: false, problem: `"${id}": missing or not an object` };
  if (question.kind === "boolean") {
    const p = answer.p_yes;
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1)
      return { ok: false, problem: `"${id}": p_yes must be a number in [0, 1]` };
    return { ok: true, build: (meta, threshold) => booleanDecision(p, meta, threshold) };
  }
  if (question.kind === "choice") {
    const keys = Object.keys(question.options);
    const probs = isRecord(answer.probabilities) ? answer.probabilities : {};
    const raw = keys.map((k) => (typeof probs[k] === "number" ? probs[k] : 0));
    const normalised = renormalise(raw);
    if (!normalised)
      return { ok: false, problem: `"${id}": probabilities over ${keys.join(", ")} must sum to 1` };
    const distribution = Object.fromEntries(keys.map((k, i) => [k, normalised[i] ?? 0]));
    const chosen = typeof answer.choice === "string" ? matchOption(answer.choice, keys) : null;
    if (!chosen) return { ok: false, problem: `"${id}": choice must be one of ${keys.join(", ")}` };
    return {
      ok: true,
      build: (meta) =>
        choiceDecision(distribution, meta, {
          value: chosen.key,
          ...(chosen.fuzzy ? { confidenceFactor: FUZZY_CONFIDENCE_FACTOR } : {}),
        }),
    };
  }
  const probs = Array.isArray(answer.probabilities) ? answer.probabilities : [];
  if (probs.length !== question.levels.length || probs.some((p) => typeof p !== "number")) {
    return {
      ok: false,
      problem: `"${id}": probabilities must list ${question.levels.length} numbers`,
    };
  }
  const normalised = renormalise(probs as number[]);
  if (!normalised) return { ok: false, problem: `"${id}": probabilities must sum to 1` };
  return { ok: true, build: (meta) => scoreDecision(normalised, question.levels, meta) };
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

export class LLMDecisionProvider implements DecisionProvider {
  readonly id = "llm";
  readonly model: string;
  readonly capabilities: DecisionProvider["capabilities"];

  constructor(private readonly generation: GenerationProvider) {
    this.model = generation.model;
    this.capabilities = {
      batch: true,
      maxQuestions: MAX_QUESTIONS,
      maxStateTokens: Math.floor(generation.capabilities.maxContext / 2),
      kinds: ["boolean", "choice", "score"],
      text: true,
      images: false,
    };
  }

  private async ask(
    prompt: string,
    schema: JsonSchema,
    ctx: DecisionCallContext,
    correction?: string,
  ): Promise<GenerationResult> {
    const structured = this.generation.capabilities.jsonSchema;
    return this.generation.generate(
      {
        messages: [
          { role: "system", content: LLM_DECISION_SYSTEM_PROMPT },
          {
            role: "user",
            content: correction
              ? `${prompt}\n\nYour previous answer was invalid: ${correction}. Answer again.`
              : prompt,
          },
        ],
        ...(structured
          ? { responseFormat: { type: "json_schema" as const, schema, strict: true } }
          : {}),
        temperature: 0,
      },
      ctx,
    );
  }

  async batch(
    state: DecisionState,
    questions: Record<string, DecisionQuestion>,
    ctx: DecisionCallContext,
  ) {
    const ids = Object.keys(questions);
    if (ids.length === 0)
      throw new ProviderError("A decision batch needs at least one question", false, this.id);
    const prompt = decisionPrompt(state, questions);
    const schema = batchSchema(questions);
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let costUsd = 0;
    let latencyMs = 0;
    let correction: string | undefined;
    for (let round = 0; round < 2; round += 1) {
      const result = await this.ask(prompt, schema, ctx, correction);
      usage = addUsage(usage, result.usage);
      costUsd += result.costUsd;
      latencyMs += result.latencyMs;
      const parsed = result.structured ?? parseJsonLoose(result.text);
      const body = isRecord(parsed) ? parsed : {};
      const interpreted = ids.map(
        (id) => [id, interpret(id, questions[id] as DecisionQuestion, body[id])] as const,
      );
      const problems = interpreted.flatMap(([, i]) => (i.ok ? [] : [i.problem]));
      if (problems.length === 0) {
        // Usage and cost are split across questions by instruction length, like a TypeSafe batch.
        const weights = ids.map((id) => (questions[id]?.instructions.length ?? 1) + 1);
        const total = weights.reduce((a, b) => a + b, 0);
        const answers: Record<string, DecisionResult> = {};
        interpreted.forEach(([id, i], index) => {
          if (!i.ok) return;
          const share = (weights[index] ?? 1) / total;
          answers[id] = i.build(
            {
              provider: this.id,
              model: result.model,
              latencyMs,
              costUsd: costUsd * share,
              usage: {
                inputTokens: Math.round(usage.inputTokens * share),
                outputTokens: Math.round(usage.outputTokens * share),
              },
              raw: { promptHash: sha256Hex(prompt), rounds: round + 1 },
            },
            ctx.booleanThreshold,
          );
        });
        return { answers, usage, model: result.model, requestId: null, latencyMs };
      }
      correction = problems.join("; ");
    }
    throw new ProviderError(
      `The model's decision answer stayed invalid after one re-ask: ${correction ?? "unknown"}`,
      false,
      this.id,
    );
  }

  async decideBoolean(state: DecisionState, question: BooleanQuestion, ctx: DecisionCallContext) {
    const { answers } = await this.batch(state, { q: question }, ctx);
    return answers.q as ReturnType<typeof booleanDecision>;
  }

  async decideChoice(state: DecisionState, question: ChoiceQuestion, ctx: DecisionCallContext) {
    const { answers } = await this.batch(state, { q: question }, ctx);
    return answers.q as ReturnType<typeof choiceDecision>;
  }

  async decideScore(state: DecisionState, question: ScoreQuestion, ctx: DecisionCallContext) {
    const { answers } = await this.batch(state, { q: question }, ctx);
    return answers.q as ReturnType<typeof scoreDecision>;
  }

  health() {
    return this.generation.health();
  }
}
