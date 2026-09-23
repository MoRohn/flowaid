/**
 * Pure derivation of per-node and per-edge execution state from a `RunView`.
 *
 * Node state: the latest node run for each node (highest attempt, then last
 * seen). Edge state, from the source and target node runs:
 *
 * - control edges (`ctl:<port>` → `ctl-in`) follow the port the source fired
 *   (ARCHITECTURE.md §5.3): a completed or reused source fires
 *   `routeTaken ?? "done"`, a failed source fires `failed`; the edge off the
 *   fired port is `taken` (then `active`, `error` or `reused` by its target)
 *   and every other control edge of the source is `not-taken` (pruned);
 * - data edges (`out:<port>` → `in:<port>`) are `taken` once the source
 *   completed, and `not-taken` when it failed, was skipped or cancelled;
 * - `active`    the target is running or in a retry back-off
 * - `error`     the target failed after the edge delivered
 * - `reused`    the target reused a cached result (green dashed, UI.md §4.3)
 * - `not-taken` the target was skipped or cancelled
 * - `idle`      nothing has happened at the source yet
 */
import { parseHandleId } from "@/node";
import type { NodeRunView, RunView, WorkflowEdgeView } from "@/types";
import type { CanvasEdgeState, CanvasRunState } from "./types";

export interface RunStateNodeInput {
  id: string;
}

export interface RunStateEdgeInput {
  id: string;
  source: string;
  target: string;
  /** Prefixed source handle; `ctl:<port>` marks a control edge. */
  sourceHandle?: string | null;
  /** Explicit edge kind; else inferred from `sourceHandle` (or `route`). */
  kind?: "control" | "data";
  /** Control port the edge leaves; defaults to the port of `sourceHandle`. */
  route?: string;
}

type RunLike = Pick<NodeRunView, "status" | "routeTaken">;

/** Picks the most recent node run per node id. */
export function latestNodeRuns(nodeRuns: NodeRunView[]): Map<string, NodeRunView> {
  const latest = new Map<string, NodeRunView>();
  for (const r of nodeRuns) {
    const prev = latest.get(r.nodeId);
    if (!prev || r.attempt >= prev.attempt) latest.set(r.nodeId, r);
  }
  return latest;
}

/** The control port an edge leaves, or undefined for a data edge. */
export function controlPortOf(
  edge: Pick<RunStateEdgeInput, "sourceHandle" | "kind" | "route">,
): string | undefined {
  const parsed = parseHandleId(edge.sourceHandle);
  if (edge.kind === "data" || parsed?.kind === "out") return undefined;
  if (edge.route !== undefined) return edge.route;
  if (parsed?.kind === "ctl") return parsed.port;
  return edge.kind === "control" ? "done" : undefined;
}

/** The control port a settled source fired: its route (or `done`) on completion, `failed` on failure. */
export function firedPortOf(source: RunLike): string | undefined {
  if (source.status === "completed" || source.status === "reused")
    return source.routeTaken ?? "done";
  if (source.status === "failed") return "failed";
  return undefined;
}

function byTarget(target: RunLike | undefined): CanvasEdgeState {
  if (target) {
    if (target.status === "running" || target.status === "retry_wait") return "active";
    if (target.status === "waiting") return "taken";
    if (target.status === "failed") return "error";
    if (target.status === "reused") return "reused";
    if (target.status === "skipped" || target.status === "cancelled") return "not-taken";
  }
  return "taken";
}

export function deriveEdgeState(
  edge: RunStateEdgeInput,
  source: RunLike | undefined,
  target: RunLike | undefined,
): CanvasEdgeState {
  if (!source || source.status === "pending") return "idle";
  if (source.status === "running" || source.status === "waiting" || source.status === "retry_wait")
    return "idle";
  const port = controlPortOf(edge);
  if (port !== undefined) {
    const fired = firedPortOf(source);
    return fired !== undefined && fired === port ? byTarget(target) : "not-taken";
  }
  if (source.status !== "completed" && source.status !== "reused") return "not-taken";
  return byTarget(target);
}

export function deriveCanvasRunState(
  nodes: RunStateNodeInput[],
  edges: Array<RunStateEdgeInput | WorkflowEdgeView>,
  run: RunView | undefined,
): CanvasRunState {
  const nodeStates: Record<string, NodeRunView> = {};
  const edgeStates: Record<string, CanvasEdgeState> = {};
  if (!run) {
    for (const e of edges) edgeStates[e.id] = "idle";
    return { nodes: nodeStates, edges: edgeStates };
  }
  const latest = latestNodeRuns(run.nodeRuns);
  for (const n of nodes) {
    const r = latest.get(n.id);
    if (r) nodeStates[n.id] = r;
  }
  for (const e of edges) {
    edgeStates[e.id] = deriveEdgeState(e, nodeStates[e.source], nodeStates[e.target]);
  }
  return { nodes: nodeStates, edges: edgeStates };
}
