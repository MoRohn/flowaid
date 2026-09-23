/**
 * Adapters from the runtime contracts (`@flowaid/workflow-core`) to the few
 * view types the components need for joins. Pure functions; the app calls
 * them with the objects the API returns.
 */
import type {
  DecisionResult,
  ErrorInfo,
  HumanRequest,
  NodeRun,
  NodeRunStatus,
  RunEvent,
  RunEventOf,
  RunStatus,
  TokenUsage,
} from "@flowaid/workflow-core";
import { RunEventSchema } from "@flowaid/workflow-core";
import type { NodeCategory } from "./categories";
import { formatProbability } from "./format";
import type {
  ApprovalRequestView,
  EnvironmentView,
  IterationProgress,
  IterationView,
  LogLineView,
  NodeRunView,
  Run,
  RunView,
  Span,
  ToolCallView,
} from "@/types";
import { assertNever } from "@/types";
import type { TraceNodeRow } from "@/trace/traceRows";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** "loop_x#3/each_y#0" → [3, 0]; "" → undefined. */
export function scopeIterations(scope: string): number[] | undefined {
  if (scope === "") return undefined;
  const out: number[] = [];
  for (const segment of scope.split("/")) {
    const hash = segment.lastIndexOf("#");
    const n = Number(segment.slice(hash + 1));
    if (Number.isInteger(n)) out.push(n);
  }
  return out.length ? out : undefined;
}

/** The route a branch/router/gate took: its first fired control port other than `done`. */
export function routeFromPorts(firedPorts: readonly string[]): string | undefined {
  return firedPorts.find((p) => p !== "done");
}

function ms(
  startedAt: string | null | undefined,
  endedAt: string | null | undefined,
): number | undefined {
  if (!startedAt || !endedAt) return undefined;
  const a = Date.parse(startedAt);
  const b = Date.parse(endedAt);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : undefined;
}

// ---------------------------------------------------------------------------
// Node runs and spans
// ---------------------------------------------------------------------------

export interface NodeRunJoins {
  /** From the node manifest. */
  category: NodeCategory;
  /** Overrides `nodeRun.nodeName`. */
  nodeName?: string;
  /** Enclosing loop/foreach node run (from the timeline). */
  parentNodeRunId?: string;
}

/** `NodeRun` projection → `NodeRunView`. */
export function toNodeRunView(nodeRun: NodeRun, joins: NodeRunJoins): NodeRunView {
  const view: NodeRunView = {
    id: nodeRun.id,
    nodeId: nodeRun.nodeId,
    nodeName: joins.nodeName ?? nodeRun.nodeName,
    nodeType: nodeRun.nodeType ?? nodeRun.kind,
    category: joins.category,
    status: nodeRun.status,
    attempt: nodeRun.attempt,
    scope: nodeRun.scope,
    firedPorts: nodeRun.firedPorts,
    costUsd: nodeRun.costUsd,
  };
  const iteration = scopeIterations(nodeRun.scope);
  if (iteration) view.iteration = iteration;
  if (joins.parentNodeRunId) view.parentNodeRunId = joins.parentNodeRunId;
  if (nodeRun.startedAt) view.startedAt = nodeRun.startedAt;
  if (nodeRun.endedAt) view.endedAt = nodeRun.endedAt;
  const duration = nodeRun.latencyMs ?? ms(nodeRun.startedAt, nodeRun.endedAt);
  if (duration !== undefined) view.durationMs = duration;
  if (nodeRun.queueLatencyMs !== null) view.queueLatencyMs = nodeRun.queueLatencyMs;
  if (nodeRun.decision) view.decision = nodeRun.decision;
  const route = routeFromPorts(nodeRun.firedPorts);
  if (route !== undefined) view.routeTaken = route;
  if (nodeRun.usage) view.usage = nodeRun.usage;
  if (nodeRun.error) view.error = nodeRun.error;
  if (nodeRun.reusedFromNodeRunId) view.reusedFromNodeRunId = nodeRun.reusedFromNodeRunId;
  if (nodeRun.input !== null) view.input = nodeRun.input;
  if (nodeRun.output !== null) view.output = nodeRun.output;
  return view;
}

/** Trace `Span` → `NodeRunView` (the span already carries the category and the parent). */
export function spanToNodeRunView(span: Span): NodeRunView {
  const view: NodeRunView = {
    id: span.id,
    nodeId: span.nodeId,
    nodeName: span.name,
    nodeType: span.nodeType ?? span.kind,
    category: span.category,
    status: span.status,
    attempt: span.attempt,
    scope: span.scope,
    firedPorts: span.firedPorts,
    costUsd: span.costUsd,
  };
  const iteration = scopeIterations(span.scope);
  if (iteration) view.iteration = iteration;
  if (span.parentId) view.parentNodeRunId = span.parentId;
  if (span.startedAt) view.startedAt = span.startedAt;
  if (span.endedAt) view.endedAt = span.endedAt;
  const duration = span.latencyMs ?? ms(span.startedAt, span.endedAt);
  if (duration !== undefined) view.durationMs = duration;
  if (span.queueLatencyMs !== null) view.queueLatencyMs = span.queueLatencyMs;
  if (span.decision) view.decision = span.decision;
  const route = routeFromPorts(span.firedPorts);
  if (route !== undefined) view.routeTaken = route;
  if (span.usage) view.usage = span.usage;
  return view;
}

/**
 * One timeline row for a span. Attempts of the same node are separate spans
 * in a trace; pass them as `attempts` (ascending) to draw stacked segments.
 */
export function spanToTraceRow(
  span: Span,
  options: { depth?: number; attempts?: Span[] } = {},
): TraceNodeRow {
  const attempts = (options.attempts && options.attempts.length ? options.attempts : [span]).map(
    spanToNodeRunView,
  );
  const latest = attempts[attempts.length - 1] ?? spanToNodeRunView(span);
  return {
    kind: "node",
    id: latest.id,
    nodeRun: latest,
    attempts,
    depth: options.depth ?? 0,
    hasChildren: span.children.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export interface RunJoins {
  workflowName: string;
  version: number | "draft";
  environment?: EnvironmentView;
  nodeRuns?: NodeRunView[];
  pendingApproval?: ApprovalRequestView;
}

/** `Run` projection → `RunView`. */
export function toRunView(run: Run, joins: RunJoins): RunView {
  const view: RunView = {
    id: run.id,
    workflowId: run.workflowId,
    workflowName: joins.workflowName,
    version: joins.version,
    status: run.status,
    origin: run.origin,
    createdAt: run.createdAt,
    costUsd: run.costUsd,
    usage: run.usage,
    nodeRuns: joins.nodeRuns ?? [],
    input: run.input,
  };
  if (joins.environment) view.environment = joins.environment;
  if (run.startedAt) view.startedAt = run.startedAt;
  if (run.endedAt) view.endedAt = run.endedAt;
  const duration = ms(run.startedAt, run.endedAt);
  if (duration !== undefined) view.durationMs = duration;
  if (run.output !== null) view.output = run.output;
  if (run.error) view.error = run.error;
  if (joins.pendingApproval) view.pendingApproval = joins.pendingApproval;
  return view;
}

// ---------------------------------------------------------------------------
// Human tasks
// ---------------------------------------------------------------------------

/** The columns of a `human_tasks` row the review surfaces read. */
export interface HumanTaskLike {
  id: string;
  runId: string;
  nodeId: string;
  request: HumanRequest;
  createdAt: string;
}

export interface HumanTaskJoins {
  nodeName: string;
  /** The decision that sent the run here, when one did. */
  decision?: DecisionResult;
  /** Pass threshold of the gate that routed here, for the reason line. */
  threshold?: number;
  /** Overrides the derived reason. */
  reason?: string;
}

/** "Why you are seeing this" from the request origin and the triggering decision. */
export function approvalReason(
  request: Pick<HumanRequest, "origin">,
  joins: Omit<HumanTaskJoins, "nodeName" | "reason">,
): string {
  const conf = joins.decision ? formatProbability(joins.decision.confidence) : undefined;
  switch (request.origin) {
    case "human_node":
      return conf !== undefined
        ? joins.threshold !== undefined
          ? `Confidence ${conf} is below the pass threshold ${formatProbability(joins.threshold)}`
          : `Confidence ${conf} routed the run to a person`
        : "This step always asks a person";
    case "task_suspend":
      return "The agent needs approval before calling this tool";
    case "decision_failover":
      return conf !== undefined
        ? `Every decision provider failed; the last answer (confidence ${conf}) needs a person`
        : "Every decision provider failed; a person answers instead";
    default:
      return assertNever(request.origin, "human request origin");
  }
}

/** `human_tasks` row (+ joins) → `ApprovalRequestView`. */
export function humanTaskToApproval(
  task: HumanTaskLike,
  joins: HumanTaskJoins,
): ApprovalRequestView {
  const view: ApprovalRequestView = {
    id: task.id,
    runId: task.runId,
    nodeId: task.nodeId,
    nodeName: joins.nodeName,
    request: task.request,
    requestedAt: task.createdAt,
    reason: joins.reason ?? approvalReason(task.request, joins),
  };
  if (joins.decision) view.decision = joins.decision;
  return view;
}

// ---------------------------------------------------------------------------
// Event folding (live runs)
// ---------------------------------------------------------------------------

export interface FoldRunEventsOptions {
  /** Category of a node id (from the definition + catalog). Default "flow". */
  categoryFor?: (nodeId: string) => NodeCategory | undefined;
  /** Display name of a node id. Defaults to the id. */
  nodeNameFor?: (nodeId: string) => string | undefined;
  /** Node runs already known (from `GET /v1/runs/:id`) that the events extend. */
  nodeRuns?: readonly NodeRunView[];
}

export interface FoldedRun {
  status?: RunStatus;
  nodeRuns: NodeRunView[];
  output?: unknown;
  error?: ErrorInfo;
  usage?: TokenUsage;
  costUsd?: number;
  durationMs?: number;
  /** Streamed generation text per node run id (`GENERATION_DELTA`, text channel). */
  streams: Record<string, string>;
  /** Open human task ids by node run id (`HUMAN_APPROVAL_REQUESTED` without a `_RECEIVED`). */
  openHumanTasks: Record<string, string>;
  /** Highest `seq` folded. */
  lastSeq: number;
  /** Events that did not validate against `RunEventSchema` (by index). */
  invalid: number[];
}

type NodeEvent = Extract<
  RunEvent,
  { nodeRunId: string; nodeId: string; scope: string; attempt: number }
>;

/** The events that move a loop or foreach node run's `IterationProgress`. */
export type IterationEvent = RunEventOf<
  | "LOOP_ITERATION_STARTED"
  | "LOOP_ITERATION_COMPLETED"
  | "LOOP_EXITED"
  | "FOREACH_STARTED"
  | "FOREACH_ITEM_COMPLETED"
>;

function withIteration(iterations: readonly IterationView[], next: IterationView): IterationView[] {
  const out = iterations.filter((it) => it.index !== next.index);
  out.push(next);
  out.sort((a, b) => a.index - b.index);
  return out;
}

/**
 * Folds one loop/foreach event into a container node run's progress (pure; returns a new
 * object). `LOOP_ITERATION_STARTED` opens iteration `i` (the badge reads `i + 1` of
 * `maxIterations`), `LOOP_ITERATION_COMPLETED` closes it, `LOOP_EXITED` records the reason,
 * `FOREACH_STARTED` sets the item count and each `FOREACH_ITEM_COMPLETED` adds a finished
 * item (the badge reads completed of `itemCount`). Redelivered events are idempotent.
 */
export function foldIterationEvent(
  progress: IterationProgress | undefined,
  e: IterationEvent,
): IterationProgress {
  const mode =
    e.type === "FOREACH_STARTED" || e.type === "FOREACH_ITEM_COMPLETED" ? "foreach" : "loop";
  const base: IterationProgress = progress ?? {
    mode,
    started: 0,
    completed: 0,
    failed: 0,
    iterations: [],
  };
  switch (e.type) {
    case "LOOP_ITERATION_STARTED": {
      const known = base.iterations.find((it) => it.index === e.iteration);
      const iterations = withIteration(base.iterations, {
        index: e.iteration,
        scope: e.childScope,
        status: known && known.status !== "running" ? known.status : "running",
      });
      return {
        ...base,
        mode: "loop",
        iterations,
        started: Math.max(base.started, e.iteration + 1),
      };
    }
    case "LOOP_ITERATION_COMPLETED": {
      const iterations = withIteration(base.iterations, {
        index: e.iteration,
        scope: e.childScope,
        status: "completed",
      });
      return {
        ...base,
        mode: "loop",
        iterations,
        started: Math.max(base.started, e.iteration + 1),
        completed: iterations.filter((it) => it.status !== "running").length,
      };
    }
    case "LOOP_EXITED": {
      const failedBody = e.reason === "body_failed";
      const iterations = failedBody
        ? base.iterations.map((it) =>
            it.status === "running" ? { ...it, status: "failed" as const } : it,
          )
        : base.iterations;
      const failed = iterations.filter((it) => it.status === "failed").length;
      return {
        ...base,
        mode: "loop",
        iterations,
        started: Math.max(base.started, e.iterations),
        completed: Math.max(
          base.completed,
          iterations.filter((it) => it.status !== "running").length,
        ),
        failed,
        exitReason: e.reason,
      };
    }
    case "FOREACH_STARTED":
      return { ...base, mode: "foreach", total: e.itemCount, concurrency: e.concurrency };
    case "FOREACH_ITEM_COMPLETED": {
      const iterations = withIteration(base.iterations, {
        index: e.index,
        scope: e.childScope,
        status: e.status,
      });
      const completed = iterations.filter((it) => it.status !== "running").length;
      return {
        ...base,
        mode: "foreach",
        iterations,
        started: Math.max(base.started, completed),
        completed,
        failed: iterations.filter((it) => it.status === "failed").length,
      };
    }
  }
}

/**
 * Folds a run's events (durable and ephemeral, in `seq` order) into the
 * node-run views the canvas and timeline render: `NODE_*` drive status and
 * timing, `DECISION_COMPLETED` attaches the decision, `TOOL_CALLED` /
 * `TOOL_RETURNED` the tool call, `LOG` the log lines and `RUN_*` the run
 * status. Unknown or malformed events are skipped and reported in `invalid`.
 */
export function foldRunEvents(
  events: readonly unknown[],
  options: FoldRunEventsOptions = {},
): FoldedRun {
  const byId = new Map<string, NodeRunView>();
  for (const n of options.nodeRuns ?? []) byId.set(n.id, { ...n });
  const result: FoldedRun = {
    nodeRuns: [],
    streams: {},
    openHumanTasks: {},
    lastSeq: -1,
    invalid: [],
  };

  const nodeRun = (e: NodeEvent): NodeRunView => {
    let view = byId.get(e.nodeRunId);
    if (!view) {
      view = {
        id: e.nodeRunId,
        nodeId: e.nodeId,
        nodeName: options.nodeNameFor?.(e.nodeId) ?? e.nodeId,
        nodeType: e.nodeId,
        category: options.categoryFor?.(e.nodeId) ?? "flow",
        status: "pending",
        attempt: e.attempt,
        scope: e.scope,
      };
      const iteration = scopeIterations(e.scope);
      if (iteration) view.iteration = iteration;
      byId.set(e.nodeRunId, view);
    }
    view.attempt = e.attempt;
    return view;
  };
  const setStatus = (view: NodeRunView, status: NodeRunStatus) => {
    view.status = status;
  };
  const end = (view: NodeRunView, e: NodeEvent, latencyMs?: number) => {
    view.endedAt = e.at;
    if (latencyMs !== undefined) view.durationMs = latencyMs;
    else if (view.startedAt) {
      const d = ms(view.startedAt, e.at);
      if (d !== undefined) view.durationMs = d;
    }
  };

  events.forEach((raw, index) => {
    const parsed = RunEventSchema.safeParse(raw);
    if (!parsed.success) {
      result.invalid.push(index);
      return;
    }
    const e = parsed.data;
    result.lastSeq = Math.max(result.lastSeq, e.seq);
    switch (e.type) {
      case "RUN_CREATED":
        result.status = "queued";
        break;
      case "RUN_STARTED":
        result.status = "running";
        break;
      case "RUN_LEASE_TAKEN":
        break;
      case "RUN_WAITING":
        result.status = e.reason === "human" ? "waiting_for_human" : "waiting";
        break;
      case "RUN_RESUMED":
        result.status = "running";
        break;
      case "RUN_CANCEL_REQUESTED":
        break;
      case "RUN_OUTPUT":
        result.output = e.output;
        break;
      case "RUN_COMPLETED":
        result.status = "completed";
        result.output = e.output;
        result.usage = e.usage;
        result.costUsd = e.costUsd;
        result.durationMs = e.durationMs;
        break;
      case "RUN_FAILED":
        result.status = "failed";
        result.error = e.error;
        result.usage = e.usage;
        result.costUsd = e.costUsd;
        result.durationMs = e.durationMs;
        break;
      case "RUN_CANCELLED":
        result.status = "cancelled";
        result.usage = e.usage;
        result.costUsd = e.costUsd;
        result.durationMs = e.durationMs;
        break;
      case "RUN_TIMED_OUT":
        result.status = "timed_out";
        result.usage = e.usage;
        result.costUsd = e.costUsd;
        result.durationMs = e.durationMs;
        break;
      case "CHECKPOINT_CREATED":
        break;
      case "NODE_SCHEDULED": {
        const v = nodeRun(e);
        v.nodeType = e.nodeType ?? e.kind;
        setStatus(v, "pending");
        if (e.reusedFromNodeRunId) v.reusedFromNodeRunId = e.reusedFromNodeRunId;
        break;
      }
      case "NODE_STARTED": {
        const v = nodeRun(e);
        setStatus(v, "running");
        v.startedAt = e.at;
        v.input = e.input;
        break;
      }
      case "NODE_COMPLETED": {
        const v = nodeRun(e);
        setStatus(v, e.reused ? "reused" : "completed");
        v.output = e.output;
        v.firedPorts = e.firedPorts;
        const route = routeFromPorts(e.firedPorts);
        if (route !== undefined) v.routeTaken = route;
        if (e.usage) v.usage = e.usage;
        v.costUsd = e.costUsd;
        end(v, e, e.latencyMs);
        break;
      }
      case "NODE_FAILED": {
        const v = nodeRun(e);
        setStatus(v, "failed");
        v.error = e.error;
        v.firedPorts = e.firedPorts;
        end(v, e, e.latencyMs);
        break;
      }
      case "NODE_RETRIED": {
        const v = nodeRun(e);
        setStatus(v, "retry_wait");
        v.error = e.error;
        end(v, e);
        break;
      }
      case "NODE_SKIPPED": {
        const v = nodeRun(e);
        setStatus(v, "skipped");
        end(v, e);
        break;
      }
      case "NODE_CANCELLED": {
        const v = nodeRun(e);
        setStatus(v, "cancelled");
        end(v, e);
        break;
      }
      case "NODE_WAITING": {
        const v = nodeRun(e);
        setStatus(v, "waiting");
        break;
      }
      case "NODE_DELEGATED":
        nodeRun(e);
        break;
      case "BRANCH_EVALUATED": {
        const v = nodeRun(e);
        v.firedPorts = e.taken;
        const route = routeFromPorts(e.taken);
        if (route !== undefined) v.routeTaken = route;
        break;
      }
      case "LOOP_ITERATION_STARTED":
      case "LOOP_ITERATION_COMPLETED":
      case "LOOP_EXITED":
      case "FOREACH_STARTED":
      case "FOREACH_ITEM_COMPLETED": {
        const v = nodeRun(e);
        v.progress = foldIterationEvent(v.progress, e);
        break;
      }
      case "JOIN_ARRIVED":
      case "SUBFLOW_STARTED":
      case "SUBFLOW_COMPLETED":
      case "TIMER_SET":
      case "TIMER_FIRED":
      case "EVENT_RECEIVED":
        nodeRun(e);
        break;
      case "DECISION_REQUESTED":
        nodeRun(e);
        break;
      case "DECISION_COMPLETED": {
        const v = nodeRun(e);
        v.decision = e.decision;
        v.decisionQuestion = e.question;
        break;
      }
      case "PROVIDER_FAILOVER":
        nodeRun(e);
        break;
      case "GENERATION_STARTED":
        nodeRun(e);
        break;
      case "GENERATION_COMPLETED": {
        const v = nodeRun(e);
        v.usage = e.usage;
        v.costUsd = e.costUsd;
        break;
      }
      case "TOOL_CALLED": {
        const v = nodeRun(e);
        const call: ToolCallView = { name: e.tool, args: e.args };
        v.toolCall = call;
        break;
      }
      case "TOOL_RETURNED": {
        const v = nodeRun(e);
        const prev = v.toolCall;
        const call: ToolCallView = {
          name: e.tool,
          args: prev?.args,
          ok: e.ok,
          durationMs: e.latencyMs,
        };
        if (e.result !== null) call.result = e.result;
        if (e.error) call.error = e.error;
        const status = statusCodeOf(e.result);
        if (status !== undefined) call.statusCode = status;
        v.toolCall = call;
        break;
      }
      case "HUMAN_APPROVAL_REQUESTED": {
        const v = nodeRun(e);
        setStatus(v, "waiting");
        result.openHumanTasks[e.nodeRunId] = e.humanTaskId;
        break;
      }
      case "HUMAN_APPROVAL_RECEIVED": {
        nodeRun(e);
        delete result.openHumanTasks[e.nodeRunId];
        break;
      }
      case "HUMAN_TASK_ESCALATED":
        nodeRun(e);
        break;
      case "HUMAN_TASK_EXPIRED": {
        nodeRun(e);
        delete result.openHumanTasks[e.nodeRunId];
        break;
      }
      case "LOG": {
        const v = nodeRun(e);
        const line: LogLineView = {
          at: e.at,
          level: e.level,
          message: e.message,
          nodeId: e.nodeId,
        };
        if (e.data !== null) line.data = e.data;
        v.logs = [...(v.logs ?? []), line];
        break;
      }
      case "METRIC":
      case "ARTIFACT_CREATED":
      case "STATE_WRITTEN":
        nodeRun(e);
        break;
      case "GENERATION_DELTA": {
        nodeRun(e);
        if (e.channel === "text")
          result.streams[e.nodeRunId] = (result.streams[e.nodeRunId] ?? "") + e.delta;
        break;
      }
      case "HEARTBEAT":
        break;
      default:
        assertNever(e, "run event");
    }
  });

  result.nodeRuns = [...byId.values()];
  return result;
}

/** HTTP status carried in a tool result object (`{ status: 503 }` / `{ statusCode: 200 }`), when present. */
function statusCodeOf(result: RunEventOf<"TOOL_RETURNED">["result"]): number | undefined {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return undefined;
  const status = result.statusCode ?? result.status;
  return typeof status === "number" && Number.isInteger(status) ? status : undefined;
}
