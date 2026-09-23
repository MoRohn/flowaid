/**
 * §11 Run events: the append-only log that is the only source of truth for a run.
 */
import { z } from "zod";
import { DataClassSchema, JsonValueSchema } from "./json.js";
import {
  EdgeIdSchema,
  NodeIdSchema,
  NodeTypeIdSchema,
  PortNameSchema,
  ScopePathSchema,
} from "./ids.js";
import { WorkerPoolSchema } from "./manifest.js";
import { DecisionResultSchema, PriceSnapshotSchema, TokenUsageSchema } from "./decision.js";
import { ErrorInfoSchema } from "./errors.js";
import { HumanRequestSchema, HumanResponseSchema } from "./human.js";
import { RunModeSchema, RunOriginSchema, RunStatusSchema } from "./run.js";

const EventBase = { runId: z.uuid(), seq: z.int().min(0), at: z.iso.datetime() };
/** Every node-level event carries the full address so the live canvas can attribute it inside concurrent iterations. */
const NodeEventBase = {
  ...EventBase,
  nodeRunId: z.uuid(),
  nodeId: NodeIdSchema,
  scope: ScopePathSchema,
  attempt: z.int().min(1),
};

/** Why a run or node is waiting. */
export const WaitReasonSchema = z.enum(["timer", "human", "subflow", "event", "delegated"]);
export type WaitReason = z.infer<typeof WaitReasonSchema>;
/** What a durable timer is for. */
export const TimerPurposeSchema = z.enum([
  "retry",
  "wait",
  "human_expiry",
  "human_escalation",
  "node_timeout",
  "join_timeout",
  "run_deadline",
  "loop_timeout",
]);
export type TimerPurpose = z.infer<typeof TimerPurposeSchema>;

/** Every run event, discriminated by `type`. */
export const RunEventSchema = z.discriminatedUnion("type", [
  // ── run lifecycle ──
  z.object({
    ...EventBase,
    type: z.literal("RUN_CREATED"),
    workflowVersionId: z.uuid(),
    environmentId: z.uuid(),
    origin: RunOriginSchema,
    mode: RunModeSchema,
    input: JsonValueSchema,
    planHash: z.string(),
    idempotencyKey: z.string().nullable(),
    sourceRunId: z.uuid().nullable(),
  }),
  z.object({
    ...EventBase,
    type: z.literal("RUN_STARTED"),
    workerId: z.string(),
    leaseUntil: z.iso.datetime(),
    deadlineAt: z.iso.datetime(),
  }),
  z.object({
    ...EventBase,
    type: z.literal("RUN_LEASE_TAKEN"),
    workerId: z.string(),
    previousWorkerId: z.string().nullable(),
    reason: z.enum(["expired", "released", "resume", "control"]),
  }),
  z.object({
    ...EventBase,
    type: z.literal("RUN_WAITING"),
    reason: WaitReasonSchema,
    nodeRunIds: z.array(z.uuid()),
  }),
  z.object({
    ...EventBase,
    type: z.literal("RUN_RESUMED"),
    reason: WaitReasonSchema,
    nodeRunId: z.uuid().nullable(),
  }),
  z.object({
    ...EventBase,
    type: z.literal("RUN_CANCEL_REQUESTED"),
    by: z.string(),
    reason: z.string().nullable(),
  }),
  z.object({
    ...EventBase,
    type: z.literal("RUN_OUTPUT"),
    nodeRunId: z.uuid(),
    nodeId: NodeIdSchema,
    output: JsonValueSchema,
    outcome: z.string().nullable(),
    earlyExit: z.boolean(),
  }),
  z.object({
    ...EventBase,
    type: z.literal("RUN_COMPLETED"),
    output: JsonValueSchema,
    outcome: z.string().nullable(),
    usage: TokenUsageSchema,
    costUsd: z.number().min(0),
    durationMs: z.int().min(0),
  }),
  z.object({
    ...EventBase,
    type: z.literal("RUN_FAILED"),
    error: ErrorInfoSchema,
    usage: TokenUsageSchema,
    costUsd: z.number().min(0),
    durationMs: z.int().min(0),
  }),
  z.object({
    ...EventBase,
    type: z.literal("RUN_CANCELLED"),
    by: z.string(),
    usage: TokenUsageSchema,
    costUsd: z.number().min(0),
    durationMs: z.int().min(0),
  }),
  z.object({
    ...EventBase,
    type: z.literal("RUN_TIMED_OUT"),
    timeoutMs: z.int(),
    usage: TokenUsageSchema,
    costUsd: z.number().min(0),
    durationMs: z.int().min(0),
  }),
  z.object({ ...EventBase, type: z.literal("CHECKPOINT_CREATED"), checkpointSeq: z.int().min(0) }),

  // ── node lifecycle ──
  z.object({
    ...NodeEventBase,
    type: z.literal("NODE_SCHEDULED"),
    kind: z.string(),
    nodeType: NodeTypeIdSchema.nullable(),
    inputHash: z.string(),
    idempotencyKey: z.string().nullable(),
    reusedFromNodeRunId: z.uuid().nullable(),
    batchId: z.string().nullable(),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("NODE_STARTED"),
    input: JsonValueSchema,
    pool: WorkerPoolSchema,
    workerId: z.string(),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("NODE_COMPLETED"),
    output: JsonValueSchema,
    firedPorts: z.array(PortNameSchema),
    usage: TokenUsageSchema.nullable(),
    costUsd: z.number().min(0),
    latencyMs: z.int().min(0),
    reused: z.boolean(),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("NODE_FAILED"),
    error: ErrorInfoSchema,
    firedPorts: z.array(PortNameSchema),
    latencyMs: z.int().min(0),
    terminal: z.boolean(),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("NODE_RETRIED"),
    error: ErrorInfoSchema,
    nextAttempt: z.int().min(2),
    delayMs: z.int().min(0),
    timerId: z.uuid(),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("NODE_SKIPPED"),
    reason: z.enum(["pruned", "race_lost", "parent_failed", "disabled", "early_exit"]),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("NODE_CANCELLED"),
    reason: z.enum(["run_cancelled", "race_lost", "early_exit", "parent_failed"]),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("NODE_WAITING"),
    reason: WaitReasonSchema,
    ref: z.string(),
    state: JsonValueSchema.nullable(),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("NODE_DELEGATED"),
    pool: WorkerPoolSchema,
    jobId: z.string(),
  }),

  // ── control flow ──
  z.object({
    ...NodeEventBase,
    type: z.literal("BRANCH_EVALUATED"),
    taken: z.array(PortNameSchema),
    evaluations: z.array(z.object({ port: PortNameSchema, result: z.boolean() })),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("JOIN_ARRIVED"),
    edgeId: EdgeIdSchema,
    from: NodeIdSchema,
    status: z.enum(["fired", "pruned"]),
    arrived: z.int().min(0),
    expected: z.int().min(0),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("LOOP_ITERATION_STARTED"),
    iteration: z.int().min(0),
    childScope: ScopePathSchema,
    carry: JsonValueSchema,
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("LOOP_ITERATION_COMPLETED"),
    iteration: z.int().min(0),
    childScope: ScopePathSchema,
    carry: JsonValueSchema,
    result: JsonValueSchema,
    exit: z.boolean(),
    usage: TokenUsageSchema,
    costUsd: z.number().min(0),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("LOOP_EXITED"),
    iterations: z.int().min(0),
    reason: z.enum([
      "exit_condition",
      "max_iterations",
      "timeout",
      "max_cost",
      "max_tokens",
      "body_failed",
      "items_done",
    ]),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("FOREACH_STARTED"),
    itemCount: z.int().min(0),
    concurrency: z.int().min(1),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("FOREACH_ITEM_COMPLETED"),
    index: z.int().min(0),
    childScope: ScopePathSchema,
    status: z.enum(["completed", "failed", "skipped"]),
    result: JsonValueSchema.nullable(),
    error: ErrorInfoSchema.nullable(),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("SUBFLOW_STARTED"),
    childRunId: z.uuid(),
    childVersionId: z.uuid(),
    depth: z.int().min(1),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("SUBFLOW_COMPLETED"),
    childRunId: z.uuid(),
    status: RunStatusSchema,
    output: JsonValueSchema.nullable(),
    error: ErrorInfoSchema.nullable(),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("TIMER_SET"),
    timerId: z.uuid(),
    fireAt: z.iso.datetime(),
    purpose: TimerPurposeSchema,
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("TIMER_FIRED"),
    timerId: z.uuid(),
    purpose: TimerPurposeSchema,
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("EVENT_RECEIVED"),
    eventName: z.string(),
    payload: JsonValueSchema,
  }),

  // ── intelligence ──
  z.object({
    ...NodeEventBase,
    type: z.literal("DECISION_REQUESTED"),
    batchId: z.string(),
    questionCount: z.int().min(1),
    provider: z.string(),
    model: z.string(),
    stateHash: z.string(),
    questions: z.array(z.string()),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("DECISION_COMPLETED"),
    batchId: z.string(),
    question: z.string(),
    decision: DecisionResultSchema,
    priceSnapshot: PriceSnapshotSchema.nullable(),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("PROVIDER_FAILOVER"),
    from: z.string(),
    to: z.string(),
    error: ErrorInfoSchema,
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("GENERATION_STARTED"),
    provider: z.string(),
    model: z.string(),
    promptHash: z.string(),
    stream: z.boolean(),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("GENERATION_COMPLETED"),
    provider: z.string(),
    model: z.string(),
    usage: TokenUsageSchema,
    costUsd: z.number().min(0),
    priceSnapshot: PriceSnapshotSchema.nullable(),
    finishReason: z.string(),
    outputChars: z.int().min(0),
    latencyMs: z.int().min(0),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("TOOL_CALLED"),
    toolCallId: z.string(),
    tool: z.string(),
    source: z.enum(["mcp", "openapi", "workflow", "builtin", "http"]),
    args: JsonValueSchema,
    capability: z.string().nullable(),
    coerced: z.boolean(),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("TOOL_RETURNED"),
    toolCallId: z.string(),
    tool: z.string(),
    ok: z.boolean(),
    result: JsonValueSchema.nullable(),
    error: ErrorInfoSchema.nullable(),
    latencyMs: z.int().min(0),
  }),

  // ── human ──
  z.object({
    ...NodeEventBase,
    type: z.literal("HUMAN_APPROVAL_REQUESTED"),
    humanTaskId: z.uuid(),
    request: HumanRequestSchema,
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("HUMAN_APPROVAL_RECEIVED"),
    humanTaskId: z.uuid(),
    response: HumanResponseSchema,
    by: z.string(),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("HUMAN_TASK_ESCALATED"),
    humanTaskId: z.uuid(),
    to: z.array(z.string()),
    reason: z.enum(["timer", "reviewer"]),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("HUMAN_TASK_EXPIRED"),
    humanTaskId: z.uuid(),
    action: z.enum(["fail", "route", "escalate"]),
  }),

  // ── telemetry ──
  z.object({
    ...NodeEventBase,
    type: z.literal("LOG"),
    level: z.enum(["debug", "info", "warn", "error"]),
    message: z.string(),
    data: JsonValueSchema.nullable(),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("METRIC"),
    name: z.string(),
    value: z.number(),
    labels: z.record(z.string(), z.string()),
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("ARTIFACT_CREATED"),
    artifactId: z.uuid(),
    name: z.string(),
    mimeType: z.string(),
    bytes: z.int().min(0),
    dataClass: DataClassSchema,
  }),
  z.object({
    ...NodeEventBase,
    type: z.literal("STATE_WRITTEN"),
    namespace: z.string(),
    key: z.string(),
    bytes: z.int().min(0),
  }),

  // ── ephemeral (seq = 0, never persisted, fanned out to SSE only) ──
  z.object({
    ...NodeEventBase,
    type: z.literal("GENERATION_DELTA"),
    ephemeral: z.literal(true),
    channel: z.enum(["text", "thinking", "tool_args"]),
    delta: z.string(),
    index: z.int().min(0),
  }),
  z.object({ ...EventBase, type: z.literal("HEARTBEAT"), ephemeral: z.literal(true) }),
]);
export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunEventType = RunEvent["type"];
/** Events that are appended to the log (everything but the ephemeral ones). */
export type DurableRunEvent = Exclude<RunEvent, { ephemeral: true }>;
/** Events fanned out to SSE only (`GENERATION_DELTA`, `HEARTBEAT`). */
export type EphemeralRunEvent = Extract<RunEvent, { ephemeral: true }>;
/** The event type with the given `type` discriminator. */
export type RunEventOf<T extends RunEventType> = Extract<RunEvent, { type: T }>;
/** Event types that end a run. */
export const TERMINAL_EVENT_TYPES: ReadonlySet<RunEventType> = new Set<RunEventType>([
  "RUN_COMPLETED",
  "RUN_FAILED",
  "RUN_CANCELLED",
  "RUN_TIMED_OUT",
]);
