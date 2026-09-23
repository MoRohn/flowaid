/**
 * §9 Human request / response wire formats and the human node's `decision` port.
 */
import { z } from "zod";
import { JsonObjectSchema, JsonSchemaSchema, JsonValueSchema } from "./json.js";
import { PortNameSchema } from "./ids.js";

/** What a reviewer sees. Already redacted. Stored in human_tasks.request. */
export const HumanRequestSchema = z.object({
  title: z.string().max(200),
  context: JsonObjectSchema,
  mode: z.discriminatedUnion("type", [
    z.object({ type: z.literal("approval") }),
    z.object({ type: z.literal("review"), value: JsonValueSchema, schema: JsonSchemaSchema }),
    z.object({ type: z.literal("form"), schema: JsonSchemaSchema }),
    z.object({
      type: z.literal("choice"),
      options: z.array(z.object({ id: PortNameSchema, label: z.string() })).min(2),
    }),
  ]),
  assignees: z.array(z.string()),
  expiresAt: z.iso.datetime().nullable(),
  externalReview: z.boolean(),
  /** Why the task exists: a human node, a task-node suspension (agent tool approval), or a decision failover to `human`. */
  origin: z.enum(["human_node", "task_suspend", "decision_failover"]),
});
export type HumanRequest = z.infer<typeof HumanRequestSchema>;

/** Wire format for POST /v1/human-tasks/:id/respond and for HUMAN_APPROVAL_RECEIVED. */
export const HumanResponseSchema = z.discriminatedUnion("action", [
  /** approval/review. `value` = edited value in review mode. */
  z.object({
    action: z.literal("approve"),
    value: JsonValueSchema.optional(),
    comment: z.string().max(4000).optional(),
  }),
  z.object({ action: z.literal("reject"), comment: z.string().max(4000).optional() }),
  z.object({
    action: z.literal("choose"),
    option: PortNameSchema,
    comment: z.string().max(4000).optional(),
  }),
  z.object({ action: z.literal("submit"), value: JsonValueSchema }),
  /** Reassigns; the task stays open. */
  z.object({
    action: z.literal("escalate"),
    to: z.array(z.string()).min(1),
    comment: z.string().max(4000).optional(),
  }),
]);
export type HumanResponse = z.infer<typeof HumanResponseSchema>;

/** Output port `decision` of a human node. */
export const HumanDecisionSchema = z.object({
  action: z.enum(["approve", "reject", "choose", "submit", "expire"]),
  option: PortNameSchema.nullable(),
  by: z.string(),
  at: z.iso.datetime(),
  comment: z.string().nullable(),
});
export type HumanDecision = z.infer<typeof HumanDecisionSchema>;
