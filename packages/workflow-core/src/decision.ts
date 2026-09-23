/**
 * §7 DecisionResult: the spec-exact output of every decision node, per kind,
 * plus its JSON Schema (the `decision` output port schema).
 */
import { z } from "zod";
import { JsonSchemaSchema, JsonValueSchema, type JsonSchema, type JsonValue } from "./json.js";
import { ErrorCodeSchema } from "./policy.js";

/** Token counts of one provider call. */
export const TokenUsageSchema = z.object({
  inputTokens: z.int().min(0),
  outputTokens: z.int().min(0),
  cacheReadTokens: z.int().min(0).optional(),
  cacheWriteTokens: z.int().min(0).optional(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

/** Price per million tokens captured at emit time so historical cost never drifts when the catalog changes. */
export const PriceSnapshotSchema = z.object({
  inputPerMTok: z.number().min(0),
  outputPerMTok: z.number().min(0),
  cacheReadPerMTok: z.number().min(0).optional(),
  cacheWritePerMTok: z.number().min(0).optional(),
});
export type PriceSnapshot = z.infer<typeof PriceSnapshotSchema>;

/** One hop of a failover chain as actually attempted. */
export const ProviderAttemptSchema = z.object({
  provider: z.string(),
  model: z.string(),
  outcome: z.enum(["ok", "error", "skipped_unhealthy"]),
  errorCode: ErrorCodeSchema.optional(),
  latencyMs: z.int().min(0),
});
export type ProviderAttempt = z.infer<typeof ProviderAttemptSchema>;

const DecisionBaseShape = {
  /** [0,1]; boolean = max(pYes, 1-pYes); choice/score = provider's distribution-derived confidence. Comparable across kinds. */
  confidence: z.number().min(0).max(1),
  /** "typesafe" | "llm" | "rule" | "human" | custom id */
  provider: z.string(),
  /** resolved model id, e.g. "jev-1.13.0" (never the alias) */
  model: z.string(),
  latencyMs: z.int().min(0),
  usage: TokenUsageSchema.optional(),
  costUsd: z.number().min(0),
  requestId: z.string().optional(),
  raw: JsonValueSchema.optional(),
  /** Failover chain actually walked, visible in traces. */
  attempts: z.array(ProviderAttemptSchema),
};

/** Yes/no decision with `pYes` and `confidence = max(pYes, 1 - pYes)`. */
export const BooleanDecisionSchema = z.object({
  ...DecisionBaseShape,
  kind: z.literal("boolean"),
  value: z.boolean(),
  pYes: z.number().min(0).max(1),
  probabilities: z.object({ true: z.number().min(0).max(1), false: z.number().min(0).max(1) }),
});
/** Choice among named options with a probability per option. */
export const ChoiceDecisionSchema = z.object({
  ...DecisionBaseShape,
  kind: z.literal("choice"),
  value: z.string(),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});
/** Ordinal score over `levels`. */
export const ScoreDecisionSchema = z.object({
  ...DecisionBaseShape,
  kind: z.literal("score"),
  /** probability-weighted fractional score in [0, levels.length-1] */
  value: z.number().min(0),
  /** value / (levels.length - 1) */
  normalized: z.number().min(0).max(1),
  level: z.int().min(0),
  levelLabel: z.string(),
  levels: z.array(z.string()).min(2).max(10),
  /** keyed "0".."n-1" */
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});
/** Any decision result, discriminated by `kind`. */
export const DecisionResultSchema = z.discriminatedUnion("kind", [
  BooleanDecisionSchema,
  ChoiceDecisionSchema,
  ScoreDecisionSchema,
]);
export type DecisionResult = z.infer<typeof DecisionResultSchema>;
export type BooleanDecision = z.infer<typeof BooleanDecisionSchema>;
export type ChoiceDecision = z.infer<typeof ChoiceDecisionSchema>;
export type ScoreDecision = z.infer<typeof ScoreDecisionSchema>;
export type DecisionKind = DecisionResult["kind"];

/** Generic form named in the product spec; the kind-specific schemas above are its concrete instances. */
export interface DecisionResultOf<T extends boolean | string | number> {
  kind: DecisionKind;
  value: T;
  confidence: number;
  probabilities?: Record<string, number>;
  provider: string;
  model: string;
  latencyMs: number;
  usage?: TokenUsage;
  costUsd: number;
  raw?: JsonValue;
  attempts: ProviderAttempt[];
}

/** Emits the draft 2020-12 JSON Schema of a Zod schema and validates it against {@link JsonSchemaSchema}. */
function toDecisionJsonSchema(schema: z.ZodType): JsonSchema {
  return JsonSchemaSchema.parse(z.toJSONSchema(schema, { target: "draft-2020-12" }));
}

/** JSON Schema of DecisionResult per kind — the output port schema `decision` of decision nodes. Generated once via z.toJSONSchema. */
export const DecisionResultJsonSchema: Record<DecisionKind, JsonSchema> = {
  boolean: toDecisionJsonSchema(BooleanDecisionSchema),
  choice: toDecisionJsonSchema(ChoiceDecisionSchema),
  score: toDecisionJsonSchema(ScoreDecisionSchema),
};
