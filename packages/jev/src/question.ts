/**
 * Contract → question → TypeSafe System One request (JEV_ENGINEERING.md §4.5, TYPESAFE_API.md).
 *
 * `toDecisionQuestion` produces the provider-neutral `DecisionQuestion` of CONTRACTS.ts §15;
 * `toSystemOneQuestion`/`toSystemOneRequest` produce the exact wire shape of
 * `POST /v1/systemone` (`noul` / `choice` / `score`) and enforce the verified live limits:
 * choice ≤ 255 options with port-safe keys, score 2–10 levels, noul criteria both-or-none,
 * and the 32k (state + longest question) and 64k (request) token budgets.
 */
import { z } from "zod";
import { stableStringify } from "@flowaid/shared";
import {
  DecisionQuestionSchema,
  type DecisionQuestion,
  type DecisionState,
} from "@flowaid/workflow-core";
import type { DecisionContractBody } from "./contract.js";
import { CHOICE_KEY_RE, TYPESAFE_LIMITS, estimateTokens } from "./limits.js";

/* ─────────────────────────────── wire schemas ─────────────────────────────── */

/** `noul`: P(yes); `criteria` optional but, when present, describes both `true` and `false`. */
export const SystemOneNoulQuestionSchema = z.object({
  type: z.literal("noul"),
  instructions: z.string().min(1),
  criteria: z
    .object({ true: z.string().min(1), false: z.string().min(1) })
    .strict()
    .optional(),
});
/** `choice`: criteria REQUIRED, map optionKey → description, ≤ 255 options. */
export const SystemOneChoiceQuestionSchema = z.object({
  type: z.literal("choice"),
  instructions: z.string().min(1),
  criteria: z.record(z.string(), z.string().min(1)),
});
/** `score`: criteria REQUIRED, ordered array of 2–10 level descriptions. */
export const SystemOneScoreQuestionSchema = z.object({
  type: z.literal("score"),
  instructions: z.string().min(1),
  criteria: z
    .array(z.string().min(1))
    .min(TYPESAFE_LIMITS.minScoreLevels)
    .max(TYPESAFE_LIMITS.maxScoreLevels),
});
export const SystemOneQuestionSchema = z.discriminatedUnion("type", [
  SystemOneNoulQuestionSchema,
  SystemOneChoiceQuestionSchema,
  SystemOneScoreQuestionSchema,
]);
export type SystemOneQuestion = z.infer<typeof SystemOneQuestionSchema>;

/** TypeSafe `state`: text, object, or array of text. */
export const SystemOneStateSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.record(z.string(), z.json()),
]);

/** `POST /v1/systemone` request body. */
export const SystemOneRequestSchema = z.object({
  model: z.string().min(1),
  state: SystemOneStateSchema,
  questions: z.record(z.string(), SystemOneQuestionSchema),
});
export type SystemOneRequest = z.infer<typeof SystemOneRequestSchema>;

/** One answer of a `POST /v1/systemone` response (the live shape, verified 2026-09-22). */
export const SystemOneAnswerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: z.number().min(0).max(1),
    probabilities: z.record(z.string(), z.number().min(0).max(1)),
  }),
  z.object({
    type: z.literal("score"),
    score: z.number().min(0),
    confidence: z.number().min(0).max(1),
    legend: z.record(z.string(), z.string()),
    probabilities: z.record(z.string(), z.number().min(0).max(1)),
  }),
]);
export type SystemOneAnswer = z.infer<typeof SystemOneAnswerSchema>;

/** `POST /v1/systemone` response body. */
export const SystemOneResponseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), SystemOneAnswerSchema),
  usage: z.object({ input_tokens: z.int().min(0), output_tokens: z.int().min(0) }),
});
export type SystemOneResponse = z.infer<typeof SystemOneResponseSchema>;

/* ─────────────────────────────── contract → question ─────────────────────────────── */

/** A live option set's model-facing entries (key → description), for dynamic menus (§10). */
export interface LiveMenu {
  /** Entries in menu order, escapes included (as built by `buildOptionSet`). */
  entries: ReadonlyArray<{ key: string; description: string }>;
}

/** Thrown when a contract cannot be turned into a question (e.g. a dynamic menu without its live option set). */
export class QuestionMappingError extends Error {
  override readonly name = "QuestionMappingError";
}

/**
 * The CONTRACTS.ts §15 `DecisionQuestion` of a contract (§4.5): static choice options include
 * the escapes; a dynamic menu needs the live option set (its entries already carry the escapes);
 * booleans send `true`/`false` outcome descriptions as criteria; scores send their levels.
 */
export function toDecisionQuestion(body: DecisionContractBody, live?: LiveMenu): DecisionQuestion {
  const q = body.question;
  switch (q.kind) {
    case "boolean":
      return {
        kind: "boolean",
        instructions: q.instructions,
        criteria: { true: q.outcomes.true.description, false: q.outcomes.false.description },
      };
    case "score":
      return { kind: "score", instructions: q.instructions, levels: [...q.levels] };
    case "choice": {
      const options: Record<string, string> = {};
      if (q.menu.source === "static") {
        for (const [key, spec] of Object.entries(q.menu.outcomes)) options[key] = spec.description;
      } else {
        if (!live) {
          throw new QuestionMappingError(
            `${body.key}@${body.version}: a dynamic menu needs the live option set built immediately before evaluation`,
          );
        }
        for (const entry of live.entries) options[entry.key] = entry.description;
        for (const [key, spec] of Object.entries(q.menu.escapes)) {
          if (!(key in options)) options[key] = spec.description;
        }
      }
      return { kind: "choice", instructions: q.instructions, options };
    }
  }
}

/**
 * The TypeSafe wire question of a `DecisionQuestion` or a contract body (plus its live option
 * set for dynamic menus). `boolean` → `noul`, `choice` → `choice` (criteria = options),
 * `score` → `score` (criteria = levels).
 */
export function toSystemOneQuestion(
  source: DecisionQuestion | DecisionContractBody,
  live?: LiveMenu,
): SystemOneQuestion {
  const q = "kind" in source ? source : toDecisionQuestion(source, live);
  switch (q.kind) {
    case "boolean":
      return q.criteria
        ? {
            type: "noul",
            instructions: q.instructions,
            criteria: { true: q.criteria.true, false: q.criteria.false },
          }
        : { type: "noul", instructions: q.instructions };
    case "choice":
      return { type: "choice", instructions: q.instructions, criteria: { ...q.options } };
    case "score":
      return { type: "score", instructions: q.instructions, criteria: [...q.levels] };
  }
}

/* ─────────────────────────────── validation ─────────────────────────────── */

/** One reason a question or request violates the live TypeSafe limits. */
export interface SystemOneIssue {
  /** Question key, or null for request-level issues. */
  question: string | null;
  code:
    | "choice_too_few_options"
    | "choice_too_many_options"
    | "choice_key_invalid"
    | "choice_description_empty"
    | "score_levels_out_of_range"
    | "score_level_empty"
    | "noul_criteria_partial"
    | "instructions_empty"
    | "no_questions"
    | "state_plus_question_over_limit"
    | "request_over_limit"
    | "schema";
  message: string;
}

/** Estimated tokens of a question: `ceil(chars(instructions + criteria) / 3.5)` (§5.4). */
export function questionTokens(q: SystemOneQuestion): number {
  const criteria = q.criteria === undefined ? "" : stableStringify(q.criteria);
  return estimateTokens(q.instructions + criteria);
}

/** Estimated tokens of a TypeSafe `state` (canonical JSON for objects and arrays). */
export function stateTokens(state: DecisionState | SystemOneRequest["state"]): number {
  return estimateTokens(typeof state === "string" ? state : stableStringify(state));
}

/**
 * Limits of one question: choice 2..255 options, keys `^[a-z][a-z0-9_]{0,63}$` (usable as
 * control ports), non-empty descriptions; score 2..10 non-empty levels; noul criteria absent or
 * describing both `true` and `false`; non-empty instructions.
 */
export function validateSystemOneQuestion(key: string | null, input: unknown): SystemOneIssue[] {
  const issues: SystemOneIssue[] = [];
  if (
    typeof input === "object" &&
    input !== null &&
    "type" in input &&
    input.type === "noul" &&
    "criteria" in input
  ) {
    const criteria = input.criteria;
    if (criteria !== undefined) {
      const record = typeof criteria === "object" && criteria !== null ? criteria : {};
      const hasTrue =
        "true" in record && typeof record.true === "string" && record.true.trim() !== "";
      const hasFalse =
        "false" in record && typeof record.false === "string" && record.false.trim() !== "";
      const extra = Object.keys(record).filter((k) => k !== "true" && k !== "false");
      if (hasTrue !== hasFalse || !hasTrue || extra.length > 0) {
        issues.push({
          question: key,
          code: "noul_criteria_partial",
          message:
            "noul criteria must describe both `true` and `false` (and nothing else), or be omitted",
        });
        return issues;
      }
    }
  }
  const parsed = SystemOneQuestionSchema.safeParse(input);
  if (!parsed.success) {
    const levelIssue = parsed.error.issues.find(
      (i) =>
        i.path[0] === "criteria" &&
        (i.code === "too_small" || i.code === "too_big") &&
        i.path.length === 1,
    );
    if (
      levelIssue &&
      typeof input === "object" &&
      input !== null &&
      "type" in input &&
      input.type === "score"
    ) {
      issues.push({
        question: key,
        code: "score_levels_out_of_range",
        message: `score needs ${TYPESAFE_LIMITS.minScoreLevels}–${TYPESAFE_LIMITS.maxScoreLevels} ordered levels`,
      });
    } else {
      for (const issue of parsed.error.issues) {
        issues.push({
          question: key,
          code: "schema",
          message: `${issue.path.join(".") || "(question)"}: ${issue.message}`,
        });
      }
    }
    return issues;
  }
  const q = parsed.data;
  if (q.instructions.trim() === "") {
    issues.push({
      question: key,
      code: "instructions_empty",
      message: "instructions must not be blank",
    });
  }
  if (q.type === "choice") {
    const keys = Object.keys(q.criteria);
    if (keys.length < TYPESAFE_LIMITS.minChoiceOptions) {
      issues.push({
        question: key,
        code: "choice_too_few_options",
        message: `choice needs at least ${TYPESAFE_LIMITS.minChoiceOptions} options, got ${keys.length}`,
      });
    }
    if (keys.length > TYPESAFE_LIMITS.maxChoiceOptions) {
      issues.push({
        question: key,
        code: "choice_too_many_options",
        message: `choice allows at most ${TYPESAFE_LIMITS.maxChoiceOptions} options including escapes, got ${keys.length}`,
      });
    }
    for (const k of keys) {
      if (!CHOICE_KEY_RE.test(k)) {
        issues.push({
          question: key,
          code: "choice_key_invalid",
          message: `option key "${k}" must match ${CHOICE_KEY_RE.source}`,
        });
      }
      if ((q.criteria[k] ?? "").trim() === "") {
        issues.push({
          question: key,
          code: "choice_description_empty",
          message: `option "${k}" needs a distinguishing description`,
        });
      }
    }
  } else if (q.type === "score") {
    q.criteria.forEach((level, i) => {
      if (level.trim() === "")
        issues.push({ question: key, code: "score_level_empty", message: `level ${i} is blank` });
    });
  }
  return issues;
}

/**
 * Limits of a whole request: every question valid, at least one question, and the token
 * budgets `tokens(state) + max tokens(question) ≤ 32 000` and `tokens(state) + Σ tokens(question) ≤ 64 000`.
 */
export function validateSystemOneRequest(input: unknown): SystemOneIssue[] {
  const parsed = SystemOneRequestSchema.safeParse(input);
  const issues: SystemOneIssue[] = [];
  if (typeof input === "object" && input !== null && "questions" in input) {
    const questions = input.questions;
    if (typeof questions === "object" && questions !== null) {
      for (const [key, q] of Object.entries(questions))
        issues.push(...validateSystemOneQuestion(key, q));
    }
  }
  if (!parsed.success) {
    if (issues.length === 0) {
      for (const issue of parsed.error.issues) {
        issues.push({
          question: null,
          code: "schema",
          message: `${issue.path.join(".") || "(request)"}: ${issue.message}`,
        });
      }
    }
    return issues;
  }
  const req = parsed.data;
  const keys = Object.keys(req.questions);
  if (keys.length === 0)
    issues.push({
      question: null,
      code: "no_questions",
      message: "a request needs at least one question",
    });
  const st = stateTokens(req.state);
  let total = st;
  for (const key of keys) {
    const q = req.questions[key];
    if (!q) continue;
    const qt = questionTokens(q);
    total += qt;
    if (st + qt > TYPESAFE_LIMITS.maxStatePlusQuestionTokens) {
      issues.push({
        question: key,
        code: "state_plus_question_over_limit",
        message: `state (${st}) + question (${qt}) tokens exceed ${TYPESAFE_LIMITS.maxStatePlusQuestionTokens}`,
      });
    }
  }
  if (total > TYPESAFE_LIMITS.maxRequestTokens) {
    issues.push({
      question: null,
      code: "request_over_limit",
      message: `request tokens ${total} exceed ${TYPESAFE_LIMITS.maxRequestTokens}; split the questions over several requests`,
    });
  }
  return issues;
}

/** Result of {@link toSystemOneRequest}. */
export type SystemOneRequestResult =
  | {
      ok: true;
      request: SystemOneRequest;
      tokens: { state: number; questions: Record<string, number>; total: number };
    }
  | { ok: false; issues: SystemOneIssue[] };

/**
 * Builds a validated `POST /v1/systemone` body: several independent questions over ONE state
 * (the native batching mechanism). Questions may be given as wire questions, CONTRACTS.ts
 * `DecisionQuestion`s or contract bodies (with `live` option sets for dynamic menus).
 */
export function toSystemOneRequest(input: {
  model: string;
  state: DecisionState;
  questions: Record<string, SystemOneQuestion | DecisionQuestion | DecisionContractBody>;
  live?: Record<string, LiveMenu>;
}): SystemOneRequestResult {
  const questions: Record<string, SystemOneQuestion> = {};
  const issues: SystemOneIssue[] = [];
  for (const [key, source] of Object.entries(input.questions)) {
    try {
      if ("type" in source) {
        questions[key] = source;
      } else if ("kind" in source) {
        const dq = DecisionQuestionSchema.parse(source);
        questions[key] = toSystemOneQuestion(dq);
      } else {
        questions[key] = toSystemOneQuestion(source, input.live?.[key]);
      }
    } catch (error) {
      issues.push({
        question: key,
        code: "schema",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const request: SystemOneRequest = { model: input.model, state: input.state, questions };
  issues.push(...validateSystemOneRequest(request));
  if (issues.length > 0) return { ok: false, issues };
  const st = stateTokens(input.state);
  const perQuestion: Record<string, number> = {};
  let total = st;
  for (const [key, q] of Object.entries(questions)) {
    perQuestion[key] = questionTokens(q);
    total += perQuestion[key];
  }
  return { ok: true, request, tokens: { state: st, questions: perQuestion, total } };
}
