/**
 * The TypeSafe System One wire format (ARCHITECTURE.md §6.3), verified against the live API on
 * 2026-09-22. `noul` answers carry only the probability of "yes"; choice and score answers carry
 * the full distribution and a confidence.
 */
import { z } from "zod";
import { JsonValueSchema } from "@flowaid/workflow-core";

export const TYPESAFE_BASE_URL = "https://api.typesafe.ai";
/** USD per input token ($0.042 per million); output tokens are free. */
export const TYPESAFE_INPUT_PRICE_PER_TOKEN = 0.042 / 1_000_000;
/** Per-request limits of the API. */
export const TYPESAFE_MAX_REQUEST_TOKENS = 64_000;
export const TYPESAFE_MAX_STATE_TOKENS = 32_000;
export const TYPESAFE_MAX_CHOICE_OPTIONS = 255;

export const SystemOneQuestionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("noul"),
    instructions: z.string().min(1),
    criteria: z.object({ true: z.string(), false: z.string() }).optional(),
  }),
  z.object({
    type: z.literal("choice"),
    instructions: z.string().min(1),
    criteria: z.record(z.string(), z.string()).refine((o) => {
      const n = Object.keys(o).length;
      return n >= 2 && n <= TYPESAFE_MAX_CHOICE_OPTIONS;
    }, "a choice needs 2 to 255 options"),
  }),
  z.object({
    type: z.literal("score"),
    instructions: z.string().min(1),
    criteria: z.array(z.string()).min(2).max(10),
  }),
]);
export type SystemOneQuestion = z.infer<typeof SystemOneQuestionSchema>;

export const SystemOneRequestSchema = z.object({
  model: z.string().default("jev-latest"),
  state: z.union([z.string(), z.record(z.string(), JsonValueSchema), z.array(z.string())]),
  questions: z.record(z.string(), SystemOneQuestionSchema),
});
export type SystemOneRequest = z.input<typeof SystemOneRequestSchema>;

export const SystemOneAnswerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: z.number().min(0).max(1),
    probabilities: z.record(z.string(), z.number()),
  }),
  z.object({
    type: z.literal("score"),
    score: z.number().min(0),
    confidence: z.number().min(0).max(1),
    legend: z.record(z.string(), z.string()),
    probabilities: z.record(z.string(), z.number()),
  }),
]);
export type SystemOneAnswer = z.infer<typeof SystemOneAnswerSchema>;

export const SystemOneResponseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), SystemOneAnswerSchema),
  usage: z.object({ input_tokens: z.int(), output_tokens: z.int() }),
});
export type SystemOneResponse = z.infer<typeof SystemOneResponseSchema>;

/**
 * Error bodies seen live (2026-09-23): 401 and some 400s carry `{ error_type, message }`, other
 * 400s a plain string (semantic validation, e.g. "Choice question must have at least one
 * choice"), and 422 the pydantic list (type errors in the request shape).
 */
export const SystemOneErrorSchema = z.union([
  z.object({ detail: z.object({ error_type: z.string(), message: z.string() }) }), // 401, 400
  z.object({ detail: z.string() }), // 400
  z.object({
    detail: z.array(
      z.object({
        type: z.string(),
        loc: z.array(z.union([z.string(), z.int()])),
        msg: z.string(),
        input: z.unknown().optional(),
      }),
    ),
  }), // 422
]);

export const ModelsResponseSchema = z.object({
  models: z.array(
    z.object({ name: z.string(), description: z.string(), release_date: z.string() }),
  ),
});
export type TypeSafeModel = z.infer<typeof ModelsResponseSchema>["models"][number];
