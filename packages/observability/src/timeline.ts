/**
 * `buildTimeline(run, nodeRuns, events)` — the spans behind `GET /v1/runs/:id/trace` and the
 * run page's timeline (UI.md §7.1).
 *
 * - One span per node run (attempt). The latest attempt of a node in a scope is the primary span;
 *   earlier attempts are its children, so a retried node renders as one row with stacked
 *   attempts.
 * - Nested scopes: a node run in scope `research#0/search#2` is a child of the latest attempt of
 *   `search` in scope `research#0`, which is a child of `research` in the root scope.
 * - Reused node runs (recorded replay) are flagged `reused`.
 * - Markers: retries, tool calls, waits, failovers and delegations, each with its `seq` and time.
 *
 * Projection rows are authoritative once they are final (`endedSeq` set). For live runs the
 * events after a row's last projected state are folded in, and node runs that exist only as
 * events so far (the projection lags the log) are built from them, so the page can call this
 * again on every SSE batch.
 */
import type {
  DecisionResult,
  NodeCategory,
  NodeId,
  NodeRun,
  NodeRunStatus,
  NodeTypeId,
  PortName,
  Run,
  RunEvent,
  RunEventType,
  ScopePath,
  TokenUsage,
} from "@flowaid/workflow-core";

/** A timeline span (the `Span` of UI.md §7.1). */
export interface TraceSpan {
  /** nodeRunId */
  id: string;
  /** Enclosing loop/foreach node run, the latest attempt for an earlier attempt, or null. */
  parentId: string | null;
  nodeId: NodeId;
  scope: ScopePath;
  attempt: number;
  name: string;
  kind: string;
  nodeType: NodeTypeId | null;
  category: NodeCategory;
  status: NodeRunStatus;
  startedAt: string | null;
  endedAt: string | null;
  latencyMs: number | null;
  queueLatencyMs: number | null;
  costUsd: number;
  usage: TokenUsage | null;
  decision: DecisionResult | null;
  firedPorts: PortName[];
  reused: boolean;
  markers: TimelineMarker[];
  children: string[];
}

export interface TimelineMarker {
  seq: number;
  type: RunEventType;
  at: string;
}

/** `GET /v1/runs/:id/trace`. */
export interface Trace {
  run: Run;
  spans: TraceSpan[];
}

/** Events shown as markers on a span. */
export const MARKER_EVENT_TYPES: ReadonlySet<RunEventType> = new Set<RunEventType>([
  "NODE_RETRIED",
  "TOOL_CALLED",
  "NODE_WAITING",
  "PROVIDER_FAILOVER",
  "NODE_DELEGATED",
  "HUMAN_TASK_ESCALATED",
]);

export interface NodeDisplay {
  name?: string;
  category?: NodeCategory;
}

export interface BuildTimelineOptions {
  /**
   * Name and category of a node (from the plan and the node manifests). Without it, names come
   * from the node run and categories from `defaultCategory`.
   */
  describe?: (nodeId: NodeId, nodeType: NodeTypeId | null, kind: string) => NodeDisplay | undefined;
}

const CONTROL_KINDS = new Set([
  "input",
  "output",
  "branch",
  "join",
  "loop",
  "foreach",
  "subflow",
  "wait",
]);

/** Category from the node kind and type id when no manifest is at hand. */
export function defaultCategory(kind: string, nodeType: NodeTypeId | null): NodeCategory {
  if (kind === "human") return "human";
  if (CONTROL_KINDS.has(kind) || !nodeType) return "flow";
  const segments = nodeType.split(".").slice(1).join(".");
  const rules: Array<[RegExp, NodeCategory]> = [
    [/^(decision|jev)\b/, "decision"],
    [/^agent\b/, "agent"],
    [/^(ai|llm|generation)\b/, "generation"],
    [/^(retrieval|knowledge|rag|vector)\b/, "retrieval"],
    [/^(state|memory)\b/, "state"],
    [/^(safety|guard|moderation)\b/, "safety"],
    [/^(tools?|http|mcp|openapi)\b/, "tool"],
    [/^(data|transform|json|text)\b/, "data"],
    [/^(human|approval)\b/, "human"],
    [/^(flow|control)\b/, "flow"],
  ];
  return rules.find(([pattern]) => pattern.test(segments))?.[1] ?? "developer";
}

/** Parent scope and container node of a scope path (`a#0/b#2` → `a#0`, `b`). */
export function parentOfScope(scope: ScopePath): { scope: ScopePath; container: NodeId } | null {
  if (scope === "") return null;
  const cut = scope.lastIndexOf("/");
  const last = cut < 0 ? scope : scope.slice(cut + 1);
  return { scope: cut < 0 ? "" : scope.slice(0, cut), container: last.slice(0, last.indexOf("#")) };
}

interface Working {
  row: Omit<TraceSpan, "parentId" | "children" | "markers" | "name" | "category">;
  name: string;
  scheduledSeq: number;
  scheduledAt: string | null;
  /** Projection says the row is final up to this seq. */
  finalSeq: number | null;
  markers: TimelineMarker[];
}

type NodeEvent = Extract<RunEvent, { nodeRunId: string; scope: string; attempt: number }>;

function isNodeEvent(event: RunEvent): event is NodeEvent {
  return "nodeRunId" in event && typeof event.nodeRunId === "string" && "scope" in event;
}

const toMs = (iso: string | null): number | null => (iso ? Date.parse(iso) : null);

function fromNodeRun(nr: NodeRun): Working {
  return {
    row: {
      id: nr.id,
      nodeId: nr.nodeId,
      scope: nr.scope,
      attempt: nr.attempt,
      kind: nr.kind,
      nodeType: nr.nodeType,
      status: nr.status,
      startedAt: nr.startedAt,
      endedAt: nr.endedAt,
      latencyMs: nr.latencyMs,
      queueLatencyMs: nr.queueLatencyMs,
      costUsd: nr.costUsd,
      usage: nr.usage,
      decision: nr.decision,
      firedPorts: [...nr.firedPorts],
      reused: nr.status === "reused" || nr.reusedFromNodeRunId !== null,
    },
    name: nr.nodeName,
    scheduledSeq: nr.scheduledSeq,
    scheduledAt: null,
    finalSeq: nr.endedSeq,
    markers: [],
  };
}

function fromScheduled(event: Extract<NodeEvent, { type: "NODE_SCHEDULED" }>): Working {
  return {
    row: {
      id: event.nodeRunId,
      nodeId: event.nodeId,
      scope: event.scope,
      attempt: event.attempt,
      kind: event.kind,
      nodeType: event.nodeType,
      status: "pending",
      startedAt: null,
      endedAt: null,
      latencyMs: null,
      queueLatencyMs: null,
      costUsd: 0,
      usage: null,
      decision: null,
      firedPorts: [],
      reused: event.reusedFromNodeRunId !== null,
    },
    name: event.nodeId,
    scheduledSeq: event.seq,
    scheduledAt: event.at,
    finalSeq: null,
    markers: [],
  };
}

const FOLDED_TYPES = [
  "NODE_SCHEDULED",
  "NODE_STARTED",
  "NODE_COMPLETED",
  "NODE_FAILED",
  "NODE_SKIPPED",
  "NODE_CANCELLED",
  "NODE_WAITING",
  "NODE_RETRIED",
  "HUMAN_APPROVAL_RECEIVED",
  "TIMER_FIRED",
  "EVENT_RECEIVED",
  "SUBFLOW_COMPLETED",
  "DECISION_COMPLETED",
] as const satisfies readonly RunEventType[];
type FoldedEvent = Extract<NodeEvent, { type: (typeof FOLDED_TYPES)[number] }>;
const FOLDED: ReadonlySet<RunEventType> = new Set(FOLDED_TYPES);

function isFolded(event: NodeEvent): event is FoldedEvent {
  return FOLDED.has(event.type);
}

/** Applies one node event to a live (non-final) row. */
function fold(w: Working, event: FoldedEvent): void {
  const row = w.row;
  switch (event.type) {
    case "NODE_SCHEDULED":
      w.scheduledAt ??= event.at;
      break;
    case "NODE_STARTED":
      row.status = "running";
      row.startedAt ??= event.at;
      if (row.queueLatencyMs === null && w.scheduledAt !== null)
        row.queueLatencyMs = Math.max(0, Date.parse(event.at) - Date.parse(w.scheduledAt));
      break;
    case "NODE_COMPLETED":
      row.status = event.reused ? "reused" : "completed";
      row.reused ||= event.reused;
      row.endedAt = event.at;
      row.latencyMs = event.latencyMs;
      row.costUsd = event.costUsd;
      row.usage = event.usage;
      row.firedPorts = [...event.firedPorts];
      break;
    case "NODE_FAILED":
      row.status = event.terminal ? "failed" : "retry_wait";
      row.endedAt = event.at;
      row.latencyMs = event.latencyMs;
      row.firedPorts = [...event.firedPorts];
      break;
    case "NODE_SKIPPED":
      row.status = "skipped";
      row.endedAt = event.at;
      break;
    case "NODE_CANCELLED":
      row.status = "cancelled";
      row.endedAt = event.at;
      break;
    case "NODE_WAITING":
      row.status = "waiting";
      break;
    case "NODE_RETRIED":
      row.status = "retry_wait";
      break;
    case "HUMAN_APPROVAL_RECEIVED":
    case "TIMER_FIRED":
    case "EVENT_RECEIVED":
    case "SUBFLOW_COMPLETED":
      if (row.status === "waiting") row.status = "running";
      break;
    case "DECISION_COMPLETED":
      row.decision = event.decision;
      break;
  }
}

/** Builds the span list of a run: ordered by schedule, then attempt. */
export function buildTimeline(
  run: Pick<Run, "id">,
  nodeRuns: readonly NodeRun[],
  events: readonly RunEvent[],
  options: BuildTimelineOptions = {},
): TraceSpan[] {
  const byId = new Map<string, Working>();
  for (const nr of nodeRuns) if (nr.runId === run.id) byId.set(nr.id, fromNodeRun(nr));

  const ordered = events
    .filter((e): e is NodeEvent => e.runId === run.id && isNodeEvent(e))
    .sort((a, b) => a.seq - b.seq);
  for (const event of ordered) {
    let w = byId.get(event.nodeRunId);
    if (!w) {
      if (event.type !== "NODE_SCHEDULED") continue;
      w = fromScheduled(event);
      byId.set(event.nodeRunId, w);
    }
    if (event.type === "NODE_SCHEDULED") w.scheduledAt ??= event.at;
    if (MARKER_EVENT_TYPES.has(event.type))
      w.markers.push({ seq: event.seq, type: event.type, at: event.at });
    if (isFolded(event) && (w.finalSeq === null || event.seq > w.finalSeq)) fold(w, event);
  }

  // Attempts of the same node in the same scope, latest last.
  const attempts = new Map<string, Working[]>();
  for (const w of byId.values()) {
    const key = `${w.row.scope}|${w.row.nodeId}`;
    const list = attempts.get(key);
    if (list) list.push(w);
    else attempts.set(key, [w]);
  }
  const latestOf = new Map<string, Working>();
  const parentOf = new Map<string, string | null>();
  for (const [key, list] of attempts) {
    list.sort((a, b) => a.row.attempt - b.row.attempt || a.scheduledSeq - b.scheduledSeq);
    const latest = list[list.length - 1] as Working;
    latestOf.set(key, latest);
    for (const w of list) {
      if (w === latest) continue;
      parentOf.set(w.row.id, latest.row.id);
      // A superseded attempt that was waiting for its retry has failed.
      if (w.row.status === "retry_wait") w.row.status = "failed";
    }
  }
  for (const latest of latestOf.values()) {
    const parent = parentOfScope(latest.row.scope);
    const container = parent ? latestOf.get(`${parent.scope}|${parent.container}`) : undefined;
    parentOf.set(latest.row.id, container ? container.row.id : null);
  }

  const sorted = [...byId.values()].sort(
    (a, b) =>
      a.scheduledSeq - b.scheduledSeq ||
      a.row.attempt - b.row.attempt ||
      (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0),
  );
  const children = new Map<string, string[]>();
  for (const w of sorted) {
    const parent = parentOf.get(w.row.id) ?? null;
    if (parent === null) continue;
    const list = children.get(parent);
    if (list) list.push(w.row.id);
    else children.set(parent, [w.row.id]);
  }

  return sorted.map((w) => {
    const described = options.describe?.(w.row.nodeId, w.row.nodeType, w.row.kind);
    const latencyMs =
      w.row.latencyMs ??
      (w.row.startedAt && w.row.endedAt
        ? Math.max(0, (toMs(w.row.endedAt) ?? 0) - (toMs(w.row.startedAt) ?? 0))
        : null);
    return {
      ...w.row,
      latencyMs,
      parentId: parentOf.get(w.row.id) ?? null,
      name: described?.name ?? w.name,
      category: described?.category ?? defaultCategory(w.row.kind, w.row.nodeType),
      markers: w.markers,
      children: children.get(w.row.id) ?? [],
    };
  });
}

/** Spans whose parent is null, in order (the timeline's top level). */
export function rootSpans(spans: readonly TraceSpan[]): TraceSpan[] {
  return spans.filter((s) => s.parentId === null);
}
