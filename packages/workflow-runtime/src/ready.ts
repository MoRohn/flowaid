/**
 * `ready(plan, state)` (ARCHITECTURE.md §2.5, §5.3): which idle nodes can run and which can
 * never run. Pure; `step` turns the answer into events.
 *
 * - Control: OR within an exclusive group, AND across groups. A node runs once every incoming
 *   edge is resolved and every group has a fired edge; it is pruned as soon as one group has
 *   all of its edges pruned.
 * - Data: a same-scope producer must be resolved; a required dependency whose producer has no
 *   value (pruned, cancelled, failed) prunes the consumer. Producers in enclosing scopes were
 *   settled before the container started (hoisted dependencies).
 * - Joins: `all` waits for every edge, `any` and `race` for the first fired one, `count n` for
 *   n fired; a join that can no longer be satisfied is pruned; a timed-out join runs.
 */
import type {
  ControlDependency,
  ExecutionPlan,
  NodeId,
  PlanNode,
  ScopePath,
} from "@flowaid/workflow-core";
import { RESOLVED, nodeKey, nodeState, scopeDepth, type SchedulerState } from "./state.js";

export type EdgeStatus = "pending" | "fired" | "pruned";

export interface ReadyItem {
  scope: ScopePath;
  nodeId: NodeId;
  action: "run" | "prune";
}

export function edgeStatus(
  s: SchedulerState,
  scope: ScopePath,
  dep: ControlDependency,
): EdgeStatus {
  const producer = nodeState(s, scope, dep.from.node);
  switch (producer.status) {
    case "completed":
    case "reused":
    case "failed":
      return producer.firedPorts.includes(dep.from.port) ? "fired" : "pruned";
    case "skipped":
    case "cancelled":
      return "pruned";
    case "running":
    case "waiting":
    case "pending":
    case "retry_wait":
    case "idle":
      return "pending";
  }
}

/** Whether a resolved producer left a value behind. */
function hasValue(s: SchedulerState, scope: ScopePath, nodeId: NodeId): boolean {
  const n = nodeState(s, scope, nodeId);
  return (n.status === "completed" || n.status === "reused") && n.output !== undefined;
}

function joinVerdict(
  plan: ExecutionPlan,
  s: SchedulerState,
  scope: ScopePath,
  node: PlanNode,
): "run" | "prune" | "wait" {
  if (node.op.kind !== "join") return "wait";
  if (s.joins[nodeKey(scope, node.id)]?.timedOut) return "run";
  const statuses = node.controlIn.map((d) => edgeStatus(s, scope, d));
  const fired = statuses.filter((x) => x === "fired").length;
  const pruned = statuses.filter((x) => x === "pruned").length;
  const total = statuses.length;
  switch (node.op.mode.type) {
    case "all":
      if (pruned === total) return "prune";
      return fired + pruned === total ? "run" : "wait";
    case "any":
    case "race":
      if (fired >= 1) return "run";
      return pruned === total ? "prune" : "wait";
    case "count": {
      const n = node.op.mode.n;
      if (fired >= n) return "run";
      return fired + (total - fired - pruned) < n ? "prune" : "wait";
    }
  }
}

/** The verdict for one idle node. */
export function verdict(
  plan: ExecutionPlan,
  s: SchedulerState,
  scope: ScopePath,
  node: PlanNode,
): "run" | "prune" | "wait" {
  if (node.kind === "join") return joinVerdict(plan, s, scope, node);
  let waiting = false;
  if (node.controlIn.length > 0) {
    const groups = new Map<number, EdgeStatus[]>();
    for (const dep of node.controlIn) {
      const list = groups.get(dep.group) ?? [];
      list.push(edgeStatus(s, scope, dep));
      groups.set(dep.group, list);
    }
    for (const list of groups.values()) {
      if (list.every((x) => x === "pruned")) return "prune";
      if (list.some((x) => x === "pending")) waiting = true;
    }
  }
  for (const dep of node.dataIn) {
    const producer = plan.nodes[dep.from.node];
    if (!producer || producer.scope !== node.scope || dep.from.node === node.id) continue;
    const st = nodeState(s, scope, dep.from.node).status;
    if (!RESOLVED.has(st)) {
      waiting = true;
      continue;
    }
    if (!dep.optional && !hasValue(s, scope, dep.from.node)) return "prune";
  }
  return waiting ? "wait" : "run";
}

/** Every actionable node, shallow scopes first, then plan order. */
export function ready(plan: ExecutionPlan, s: SchedulerState): ReadyItem[] {
  if (
    s.run.status === "completed" ||
    s.run.status === "failed" ||
    s.run.status === "cancelled" ||
    s.run.status === "timed_out"
  )
    return [];
  const items: Array<ReadyItem & { depth: number; order: number }> = [];
  for (const sc of Object.values(s.scopes)) {
    if (sc.closed) continue;
    const planScope = plan.scopes[sc.planScope];
    if (!planScope) continue;
    planScope.order.forEach((nodeId, order) => {
      const node = plan.nodes[nodeId];
      if (!node) return;
      const status = nodeState(s, sc.path, nodeId).status;
      // Joins are scheduled on their first arrival and then wait in `pending`.
      if (status !== "idle" && !(node.kind === "join" && status === "pending")) return;
      const v = verdict(plan, s, sc.path, node);
      if (v === "wait") return;
      items.push({ scope: sc.path, nodeId, action: v, depth: scopeDepth(sc.path), order });
    });
  }
  items.sort(
    (a, b) =>
      a.depth - b.depth ||
      (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0) ||
      a.order - b.order,
  );
  return items.map(({ scope, nodeId, action }) => ({ scope, nodeId, action }));
}

/** A scope is drained when nothing in it is active and nothing more can start. */
export function scopeDrained(plan: ExecutionPlan, s: SchedulerState, path: ScopePath): boolean {
  const sc = s.scopes[path];
  if (!sc) return true;
  const planScope = plan.scopes[sc.planScope];
  if (!planScope) return true;
  for (const nodeId of planScope.order) {
    const status = nodeState(s, path, nodeId).status;
    if (
      status === "pending" ||
      status === "running" ||
      status === "waiting" ||
      status === "retry_wait"
    )
      return false;
    const node = plan.nodes[nodeId];
    if (status === "idle" && node && verdict(plan, s, path, node) !== "wait") return false;
  }
  return true;
}

/** Whether the scope failed: a node failed terminally without firing a route. */
export function scopeFailure(plan: ExecutionPlan, s: SchedulerState, path: ScopePath) {
  const sc = s.scopes[path];
  if (!sc) return null;
  for (const [nodeId, n] of Object.entries(sc.nodes)) {
    if (n.status === "failed" && n.firedPorts.length === 0 && plan.nodes[nodeId])
      return { nodeId, error: n.error };
  }
  return null;
}
