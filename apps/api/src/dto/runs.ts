import { z } from "zod";

export const RunRequestSchema = z.object({
  input: z.unknown().default({}),
  mode: z.enum(["sync", "async"]).default("async"),
  environmentId: z.uuid().optional(),
  versionId: z.uuid().optional(),
  draft: z.boolean().default(false),
  sessionId: z.string().max(128).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
  labels: z.record(z.string().regex(/^[a-z][a-z0-9_.-]{0,62}$/), z.string().max(256)).optional(),
  waitTimeoutMs: z.int().min(1000).max(300_000).default(60_000),
});

export const RunAcceptedSchema = z.object({
  run_id: z.uuid(),
  status: z.string(),
  links: z.object({ self: z.string(), stream: z.string(), output: z.string() }),
  human_task: z.object({ id: z.uuid(), url: z.string() }).optional(),
});

export const RunCompletedSchema = z.object({
  run_id: z.uuid(),
  status: z.literal("completed"),
  output: z.unknown(),
  outcome: z.string().nullable(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).loose(),
  cost_usd: z.number(),
  duration_ms: z.int(),
});

export const RunSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  workflowId: z.uuid(),
  workflowVersionId: z.uuid(),
  environmentId: z.uuid(),
  status: z.string(),
  origin: z.string(),
  mode: z.string(),
  input: z.unknown(),
  output: z.unknown(),
  outcome: z.string().nullable(),
  error: z.unknown(),
  parentRunId: z.string().nullable(),
  sourceRunId: z.string().nullable(),
  sessionId: z.string().nullable(),
  labels: z.record(z.string(), z.string()),
  lastSeq: z.number(),
  usage: z.unknown(),
  costUsd: z.number(),
  nodeRunCount: z.number(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});

/** A decision a run made, as the runs list shows it (`include=decisions`). */
export const RunDecisionSummarySchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  kind: z.string(),
  confidence: z.number(),
});

/**
 * A runs-list row: the run, plus its decisions with `include=decisions` and its version number
 * (`null` for a draft) with `include=version`.
 */
export const RunListItemSchema = RunSchema.extend({
  decisions: z.array(RunDecisionSummarySchema).optional(),
  version: z.int().nullable().optional(),
});

/** `include` on the runs list: `decisions`, `version`, or both (`decisions,version`). */
export const RunListIncludeSchema = z
  .string()
  .regex(/^(decisions|version)(,(decisions|version))*$/, "decisions, version or both")
  .optional();

export const HumanTaskSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  nodeRunId: z.string(),
  nodeId: z.string(),
  /** the node's name in the workflow (the list) */
  nodeName: z.string().optional(),
  scope: z.string(),
  workflowId: z.uuid(),
  request: z.unknown(),
  status: z.enum(["open", "responded", "expired", "cancelled"]),
  assignees: z.array(z.string()),
  response: z.unknown(),
  respondedBy: z.string().nullable(),
  respondedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});
