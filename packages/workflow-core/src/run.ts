/**
 * §10 Run and NodeRun records and their statuses.
 */
import { z } from "zod";
import { JsonValueSchema } from "./json.js";
import { NodeIdSchema, NodeTypeIdSchema, PortNameSchema, ScopePathSchema } from "./ids.js";
import { WorkerPoolSchema } from "./manifest.js";
import { DecisionResultSchema, TokenUsageSchema } from "./decision.js";
import { ErrorInfoSchema } from "./errors.js";

/** Lifecycle status of a run. */
export const RunStatusSchema = z.enum([
  "queued",
  "starting",
  "running",
  "waiting",
  "waiting_for_human",
  "retrying",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;
/** Statuses after which a run never changes again. */
export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);

/** Lifecycle status of one node run (attempt). */
export const NodeRunStatusSchema = z.enum([
  "pending",
  "running",
  "waiting",
  "retry_wait",
  "completed",
  "failed",
  "skipped",
  "cancelled",
  "reused",
]);
export type NodeRunStatus = z.infer<typeof NodeRunStatusSchema>;

/** Whether the caller waits for the result (`sync`) or polls/streams (`async`). */
export const RunModeSchema = z.enum(["sync", "async"]);
export type RunMode = z.infer<typeof RunModeSchema>;
/** What started the run. */
export const RunOriginSchema = z.enum([
  "api",
  "ui",
  "webhook",
  "schedule",
  "mcp",
  "evaluation",
  "subflow",
  "replay",
  "restart",
  "fork",
]);
export type RunOrigin = z.infer<typeof RunOriginSchema>;

/** Projection row of a run (from its event log). */
export const RunSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  workflowId: z.uuid(),
  workflowVersionId: z.uuid(),
  environmentId: z.uuid(),
  status: RunStatusSchema,
  origin: RunOriginSchema,
  mode: RunModeSchema,
  input: JsonValueSchema,
  output: JsonValueSchema.nullable(),
  outcome: z.string().nullable(),
  error: ErrorInfoSchema.nullable(),
  parentRunId: z.uuid().nullable(),
  parentNodeRunId: z.uuid().nullable(),
  sourceRunId: z.uuid().nullable(),
  sessionId: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  labels: z.record(z.string(), z.string()),
  lastSeq: z.int().min(0),
  usage: TokenUsageSchema,
  costUsd: z.number().min(0),
  nodeRunCount: z.int().min(0),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
});
export type Run = z.infer<typeof RunSchema>;

/** Projection row of one node run (attempt). */
export const NodeRunSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  nodeId: NodeIdSchema,
  scope: ScopePathSchema,
  attempt: z.int().min(1),
  status: NodeRunStatusSchema,
  kind: z.string(),
  nodeType: NodeTypeIdSchema.nullable(),
  nodeName: z.string(),
  input: JsonValueSchema.nullable(),
  /** inline ≤ 64 KiB, else { "$artifact": id } */
  output: JsonValueSchema.nullable(),
  firedPorts: z.array(PortNameSchema),
  decision: DecisionResultSchema.nullable(),
  error: ErrorInfoSchema.nullable(),
  usage: TokenUsageSchema.nullable(),
  costUsd: z.number().min(0),
  latencyMs: z.int().min(0).nullable(),
  queueLatencyMs: z.int().min(0).nullable(),
  idempotencyKey: z.string().nullable(),
  inputHash: z.string().nullable(),
  reusedFromNodeRunId: z.uuid().nullable(),
  pool: WorkerPoolSchema,
  scheduledSeq: z.int().min(1),
  endedSeq: z.int().min(1).nullable(),
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
});
export type NodeRun = z.infer<typeof NodeRunSchema>;
