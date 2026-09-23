/**
 * SchedulerState (ARCHITECTURE.md §5.3): everything the scheduler knows about a run, derived
 * only from its event log by `reduce`. It is plain JSON (checkpoints store it as is) and is
 * updated with structural sharing, so a reduction copies only the path it changes.
 *
 * Control-edge states are not stored: an edge is fired when its producer completed with the
 * edge's port among `firedPorts`, pruned when the producer resolved otherwise, and pending
 * before that (`edgeStatus`). Deriving them keeps edges and nodes from ever disagreeing.
 */
import type {
  ErrorInfo,
  ExecutionPlan,
  HumanRequest,
  JsonObject,
  JsonValue,
  NodeId,
  NodeRunStatus,
  PortName,
  RunStatus,
  ScopePath,
  TimerPurpose,
  TokenUsage,
  WaitReason,
} from "@flowaid/workflow-core";

export type NodeStatus = NodeRunStatus | "idle";

export interface NodeState {
  status: NodeStatus;
  nodeRunId: string | null;
  attempt: number;
  firedPorts: PortName[];
  /** Resolved input (containers and joins read it back; tasks keep it for re-entry). */
  input: JsonValue | null;
  /** Inline output, or `{ "$artifact": id }` once spilled; undefined = no value. */
  output: JsonValue | undefined;
  error: ErrorInfo | null;
  waiting: { reason: WaitReason; ref: string; state: JsonValue | null } | null;
  retryTimerId: string | null;
  inputHash: string | null;
  batchId: string | null;
  /** Spend already counted from DECISION_/GENERATION_COMPLETED of the current attempt. */
  spentUsd: number;
  spentUsage: TokenUsage;
}

export interface ScopeState {
  path: ScopePath;
  planScope: string;
  parent: { path: ScopePath; nodeId: NodeId } | null;
  nodes: Record<NodeId, NodeState>;
  iteration: { item?: JsonValue; index?: number; iteration?: number; carry?: JsonObject };
  /** Closed scopes (finished iterations) keep their nodes for output lookup but never schedule. */
  closed: boolean;
}

export interface LoopState {
  scope: ScopePath;
  nodeId: NodeId;
  iteration: number;
  carry: JsonObject;
  lastResult: JsonObject | null;
  startedAt: string;
  usage: TokenUsage;
  costUsd: number;
  exited: boolean;
}

export interface ForeachState {
  scope: ScopePath;
  nodeId: NodeId;
  items: JsonValue[];
  total: number;
  concurrency: number;
  opened: number;
  done: number;
  results: (JsonValue | null)[];
  errors: (ErrorInfo | null)[];
  failed: boolean;
  usage: TokenUsage;
  costUsd: number;
}

export interface JoinState {
  arrivals: Record<string, "fired" | "pruned">;
  timerId: string | null;
  timedOut: boolean;
}

export interface TimerState {
  fireAt: string;
  purpose: TimerPurpose;
  scope: ScopePath;
  nodeId: NodeId;
  nodeRunId: string;
}

export interface HumanTaskState {
  scope: ScopePath;
  nodeId: NodeId;
  nodeRunId: string;
  status: "open" | "done" | "expired";
  request: HumanRequest;
}

export interface SchedulerState {
  run: {
    id: string;
    status: RunStatus;
    lastSeq: number;
    input: JsonValue;
    usage: TokenUsage;
    costUsd: number;
    nodeRunCount: number;
    cancelRequested: boolean;
    startedAt: string | null;
    deadlineAt: string | null;
    outputs: { nodeId: NodeId; output: JsonValue; outcome: string | null }[];
    error: ErrorInfo | null;
  };
  scopes: Record<ScopePath, ScopeState>;
  /** nodeRunId → where it lives */
  nodeRuns: Record<string, { scope: ScopePath; nodeId: NodeId }>;
  loops: Record<string, LoopState>;
  foreach: Record<string, ForeachState>;
  joins: Record<string, JoinState>;
  timers: Record<string, TimerState>;
  humanTasks: Record<string, HumanTaskState>;
  subruns: Record<string, { scope: ScopePath; nodeId: NodeId; nodeRunId: string }>;
}

export const ZERO_USAGE: TokenUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
});

export const IDLE: NodeState = Object.freeze({
  status: "idle",
  nodeRunId: null,
  attempt: 1,
  firedPorts: [],
  input: null,
  output: undefined,
  error: null,
  waiting: null,
  retryTimerId: null,
  inputHash: null,
  batchId: null,
  spentUsd: 0,
  spentUsage: ZERO_USAGE,
});

/** `scope|node` key of per-node maps (loops, foreach, joins). */
export const nodeKey = (scope: ScopePath, nodeId: NodeId): string => `${scope}|${nodeId}`;

/** Path of iteration `index` of container `nodeId` in scope `parent`. */
export function childScopePath(parent: ScopePath, nodeId: NodeId, index: number): ScopePath {
  return parent === "" ? `${nodeId}#${index}` : `${parent}/${nodeId}#${index}`;
}

/** Depth of a scope path (root = 0). */
export const scopeDepth = (path: ScopePath): number => (path === "" ? 0 : path.split("/").length);

export function initialState(
  plan: ExecutionPlan,
  runId: string,
  input: JsonValue = null,
): SchedulerState {
  void plan;
  return {
    run: {
      id: runId,
      status: "queued",
      lastSeq: 0,
      input,
      usage: ZERO_USAGE,
      costUsd: 0,
      nodeRunCount: 0,
      cancelRequested: false,
      startedAt: null,
      deadlineAt: null,
      outputs: [],
      error: null,
    },
    scopes: {
      "": { path: "", planScope: "", parent: null, nodes: {}, iteration: {}, closed: false },
    },
    nodeRuns: {},
    loops: {},
    foreach: {},
    joins: {},
    timers: {},
    humanTasks: {},
    subruns: {},
  };
}

export function nodeState(s: SchedulerState, scope: ScopePath, nodeId: NodeId): NodeState {
  return s.scopes[scope]?.nodes[nodeId] ?? IDLE;
}

/** Statuses after which a node run never changes (in this attempt). */
export const RESOLVED: ReadonlySet<NodeStatus> = new Set<NodeStatus>([
  "completed",
  "reused",
  "failed",
  "skipped",
  "cancelled",
]);
/** Statuses of a node that is doing or awaiting something. */
export const ACTIVE: ReadonlySet<NodeStatus> = new Set<NodeStatus>([
  "pending",
  "running",
  "waiting",
  "retry_wait",
]);

export function addUsage(a: TokenUsage, b: TokenUsage | null | undefined): TokenUsage {
  if (!b) return a;
  const out: TokenUsage = {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
  if (a.cacheReadTokens !== undefined || b.cacheReadTokens !== undefined)
    out.cacheReadTokens = (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0);
  if (a.cacheWriteTokens !== undefined || b.cacheWriteTokens !== undefined)
    out.cacheWriteTokens = (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0);
  return out;
}

export function subtractUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: Math.max(0, a.inputTokens - b.inputTokens),
    outputTokens: Math.max(0, a.outputTokens - b.outputTokens),
  };
}

export const totalTokens = (u: TokenUsage): number => u.inputTokens + u.outputTokens;
