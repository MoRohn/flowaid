/** `ExpectationSchema` (ARCHITECTURE.md §10.4): what a case expects of its run. */
import { z } from "zod";
import {
  HumanResponseSchema,
  JsonPointerSchema,
  JsonSchemaSchema,
  JsonValueSchema,
  NodeIdSchema,
  PortNameSchema,
  RunStatusSchema,
  type JsonValue,
} from "@flowaid/workflow-core";

export const MatcherSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("equals"), value: JsonValueSchema }),
  z.object({ type: z.literal("contains"), value: z.string() }),
  z.object({ type: z.literal("regex"), pattern: z.string() }),
  z.object({ type: z.literal("schema"), schema: JsonSchemaSchema }),
  z.object({ type: z.literal("range"), min: z.number().optional(), max: z.number().optional() }),
  // boolean decision over { input, expected?, actual }
  z.object({
    type: z.literal("judge"),
    instructions: z.string(),
    criteria: z.object({ true: z.string(), false: z.string() }).optional(),
  }),
]);
export type Matcher = z.infer<typeof MatcherSchema>;

export const ExpectationSchema = z.object({
  output: z.array(z.object({ path: JsonPointerSchema, matcher: MatcherSchema })).default([]),
  decisions: z
    .record(
      NodeIdSchema,
      z.object({
        value: JsonValueSchema.optional(),
        valueIn: z.array(JsonValueSchema).optional(),
        range: z.tuple([z.number(), z.number()]).optional(),
        minConfidence: z.number().optional(),
      }),
    )
    .default({}),
  /** required fired port per branch/gate/router node */
  branches: z.record(NodeIdSchema, PortNameSchema).default({}),
  requiredNodes: z.array(NodeIdSchema).default([]),
  forbiddenNodes: z.array(NodeIdSchema).default([]),
  requiredTools: z.array(z.string()).default([]),
  forbiddenTools: z.array(z.string()).default([]),
  status: RunStatusSchema.optional(),
  outcome: z.string().optional(),
  maxLatencyMs: z.int().optional(),
  maxCostUsd: z.number().optional(),
  /** auto-response per human node; default { action: 'approve' } */
  human: z.record(NodeIdSchema, HumanResponseSchema).default({}),
  /** scored: did the run request a human at all? */
  humanExpected: z.boolean().optional(),
});
export type Expectation = z.infer<typeof ExpectationSchema>;
export type ExpectationInput = z.input<typeof ExpectationSchema>;

export interface EvaluationCase {
  id: string;
  input: JsonValue;
  expected: Expectation;
  tags?: string[];
}

/** Parses stored `evaluation_cases.expected` (defaults applied). */
export function parseCase(c: {
  id: string;
  input: JsonValue;
  expected: unknown;
  tags?: string[];
}): EvaluationCase {
  return {
    id: c.id,
    input: c.input,
    expected: ExpectationSchema.parse(c.expected),
    ...(c.tags ? { tags: c.tags } : {}),
  };
}
