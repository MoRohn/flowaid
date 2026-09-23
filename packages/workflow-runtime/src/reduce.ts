/**
 * The reducer (ARCHITECTURE.md §5.3): `reduce(plan, state, event)` is pure and total — replaying
 * a log (or a checkpoint plus the tail after it) yields the same state. It only records what
 * happened; every decision about what to do next is made by `step`.
 */
import type {
  DurableRunEvent,
  ExecutionPlan,
  JsonObject,
  NodeId,
  ScopePath,
  TokenUsage,
} from "@flowaid/workflow-core";
import {
  IDLE,
  ZERO_USAGE,
  addUsage,
  childScopePath,
  nodeKey,
  subtractUsage,
  type ForeachState,
  type NodeState,
  type SchedulerState,
  type ScopeState,
} from "./state.js";

type NodeEvent = Extract<DurableRunEvent, { nodeRunId: string; scope: string; attempt: number }>;

function withScope(
  s: SchedulerState,
  path: ScopePath,
  fn: (scope: ScopeState) => ScopeState,
): SchedulerState {
  const scope = s.scopes[path];
  if (!scope) return s;
  return { ...s, scopes: { ...s.scopes, [path]: fn(scope) } };
}

function withNode(
  s: SchedulerState,
  path: ScopePath,
  nodeId: NodeId,
  fn: (node: NodeState) => NodeState,
): SchedulerState {
  return withScope(s, path, (scope) => ({
    ...scope,
    nodes: { ...scope.nodes, [nodeId]: fn(scope.nodes[nodeId] ?? IDLE) },
  }));
}

/** Adds spend to the run and to every loop/foreach enclosing `scope`. */
function charge(
  s: SchedulerState,
  scope: ScopePath,
  usage: TokenUsage,
  costUsd: number,
): SchedulerState {
  if (costUsd === 0 && usage.inputTokens === 0 && usage.outputTokens === 0) return s;
  let next: SchedulerState = {
    ...s,
    run: { ...s.run, usage: addUsage(s.run.usage, usage), costUsd: s.run.costUsd + costUsd },
  };
  // Walk up the containers: scope "a#0/b#2" is inside loop/foreach b (in a#0) and a (in root).
  let path = scope;
  while (path !== "") {
    const cut = path.lastIndexOf("/");
    const parent = cut < 0 ? "" : path.slice(0, cut);
    const last = cut < 0 ? path : path.slice(cut + 1);
    const container = last.slice(0, last.indexOf("#"));
    const key = nodeKey(parent, container);
    const loop = next.loops[key];
    if (loop)
      next = {
        ...next,
        loops: {
          ...next.loops,
          [key]: { ...loop, usage: addUsage(loop.usage, usage), costUsd: loop.costUsd + costUsd },
        },
      };
    const fe = next.foreach[key];
    if (fe)
      next = {
        ...next,
        foreach: {
          ...next.foreach,
          [key]: { ...fe, usage: addUsage(fe.usage, usage), costUsd: fe.costUsd + costUsd },
        },
      };
    path = parent;
  }
  return next;
}

function openScope(
  s: SchedulerState,
  parent: ScopePath,
  nodeId: NodeId,
  index: number,
  planScope: string,
  iteration: ScopeState["iteration"],
): SchedulerState {
  const path = childScopePath(parent, nodeId, index);
  return {
    ...s,
    scopes: {
      ...s.scopes,
      [path]: {
        path,
        planScope,
        parent: { path: parent, nodeId },
        nodes: {},
        iteration,
        closed: false,
      },
    },
  };
}

function bodyScopeOf(plan: ExecutionPlan, nodeId: NodeId): string {
  const op = plan.nodes[nodeId]?.op;
  return op && (op.kind === "loop" || op.kind === "foreach") ? op.bodyScope : nodeId;
}

function reduceNodeEvent(plan: ExecutionPlan, s: SchedulerState, e: NodeEvent): SchedulerState {
  const { scope, nodeId } = e;
  switch (e.type) {
    case "NODE_SCHEDULED": {
      const next = withNode(s, scope, nodeId, (n) => ({
        ...IDLE,
        attempt: e.attempt,
        status: "pending",
        nodeRunId: e.nodeRunId,
        inputHash: e.inputHash,
        batchId: e.batchId,
        input: n.input,
      }));
      return {
        ...next,
        run: {
          ...next.run,
          nodeRunCount: next.run.nodeRunCount + 1,
          status: next.run.status === "starting" ? "running" : next.run.status,
        },
        nodeRuns: { ...next.nodeRuns, [e.nodeRunId]: { scope, nodeId } },
      };
    }
    case "NODE_STARTED":
      return withNode(s, scope, nodeId, (n) => ({ ...n, status: "running", input: e.input }));
    case "NODE_DELEGATED":
      return withNode(s, scope, nodeId, (n) => ({
        ...n,
        status: "waiting",
        waiting: { reason: "delegated", ref: e.jobId, state: null },
      }));
    case "NODE_COMPLETED": {
      const node = s.scopes[scope]?.nodes[nodeId] ?? IDLE;
      const usage = e.usage ?? ZERO_USAGE;
      // Spend already counted from decision/generation events is not counted twice.
      const extraUsage = subtractUsage(usage, node.spentUsage);
      const extraCost = Math.max(0, e.costUsd - node.spentUsd);
      const next = withNode(s, scope, nodeId, (n) => ({
        ...n,
        status: e.reused ? "reused" : "completed",
        output: e.output,
        firedPorts: e.firedPorts,
        waiting: null,
        error: null,
      }));
      return charge(next, scope, extraUsage, extraCost);
    }
    case "NODE_FAILED":
      return withNode(s, scope, nodeId, (n) =>
        e.terminal
          ? {
              ...n,
              status: "failed",
              error: e.error,
              firedPorts: e.firedPorts,
              waiting: null,
              output: undefined,
            }
          : { ...n, error: e.error },
      );
    case "NODE_RETRIED":
      return withNode(s, scope, nodeId, (n) => ({
        ...n,
        status: "retry_wait",
        error: e.error,
        retryTimerId: e.timerId,
        waiting: null,
      }));
    case "NODE_SKIPPED":
      return withNode(s, scope, nodeId, (n) => ({
        ...n,
        status: "skipped",
        nodeRunId: e.nodeRunId,
        firedPorts: [],
        waiting: null,
      }));
    case "NODE_CANCELLED":
      return withNode(s, scope, nodeId, (n) => ({
        ...n,
        status: "cancelled",
        firedPorts: [],
        waiting: null,
      }));
    case "NODE_WAITING":
      return withNode(s, scope, nodeId, (n) => ({
        ...n,
        status: "waiting",
        waiting: { reason: e.reason, ref: e.ref, state: e.state },
      }));
    case "TIMER_SET":
      return {
        ...s,
        timers: {
          ...s.timers,
          [e.timerId]: {
            fireAt: e.fireAt,
            purpose: e.purpose,
            scope,
            nodeId,
            nodeRunId: e.nodeRunId,
          },
        },
      };
    case "TIMER_FIRED": {
      const { [e.timerId]: _gone, ...timers } = s.timers;
      let next: SchedulerState = { ...s, timers };
      if (e.purpose === "retry") {
        next = withNode(next, scope, nodeId, (n) =>
          n.retryTimerId === e.timerId ? { ...IDLE, attempt: n.attempt + 1, input: n.input } : n,
        );
      }
      if (e.purpose === "join_timeout") {
        const key = nodeKey(scope, nodeId);
        const join = next.joins[key];
        if (join) next = { ...next, joins: { ...next.joins, [key]: { ...join, timedOut: true } } };
      }
      return next;
    }
    case "DECISION_COMPLETED":
    case "GENERATION_COMPLETED": {
      const usage = e.type === "DECISION_COMPLETED" ? (e.decision.usage ?? ZERO_USAGE) : e.usage;
      const cost = e.type === "DECISION_COMPLETED" ? e.decision.costUsd : e.costUsd;
      const next = withNode(s, scope, nodeId, (n) => ({
        ...n,
        spentUsd: n.spentUsd + cost,
        spentUsage: addUsage(n.spentUsage, usage),
      }));
      return charge(next, scope, usage, cost);
    }
    case "HUMAN_APPROVAL_REQUESTED":
      return {
        ...s,
        humanTasks: {
          ...s.humanTasks,
          [e.humanTaskId]: {
            scope,
            nodeId,
            nodeRunId: e.nodeRunId,
            status: "open",
            request: e.request,
          },
        },
      };
    case "HUMAN_APPROVAL_RECEIVED": {
      const task = s.humanTasks[e.humanTaskId];
      if (!task || e.response.action === "escalate") return s;
      return {
        ...s,
        humanTasks: { ...s.humanTasks, [e.humanTaskId]: { ...task, status: "done" } },
      };
    }
    case "HUMAN_TASK_EXPIRED": {
      const task = s.humanTasks[e.humanTaskId];
      if (!task || e.action === "escalate") return s;
      return {
        ...s,
        humanTasks: { ...s.humanTasks, [e.humanTaskId]: { ...task, status: "expired" } },
      };
    }
    case "LOOP_ITERATION_STARTED": {
      const key = nodeKey(scope, nodeId);
      const prev = s.loops[key];
      const next: SchedulerState = {
        ...s,
        loops: {
          ...s.loops,
          [key]: {
            scope,
            nodeId,
            iteration: e.iteration,
            carry: e.carry as JsonObject,
            lastResult: prev?.lastResult ?? null,
            startedAt: prev?.startedAt ?? e.at,
            usage: prev?.usage ?? ZERO_USAGE,
            costUsd: prev?.costUsd ?? 0,
            exited: false,
          },
        },
      };
      return openScope(next, scope, nodeId, e.iteration, bodyScopeOf(plan, nodeId), {
        iteration: e.iteration,
        carry: e.carry as JsonObject,
      });
    }
    case "LOOP_ITERATION_COMPLETED": {
      const key = nodeKey(scope, nodeId);
      const loop = s.loops[key];
      const next = withScope(s, e.childScope, (sc) => ({ ...sc, closed: true }));
      if (!loop) return next;
      return {
        ...next,
        loops: {
          ...next.loops,
          [key]: { ...loop, carry: e.carry as JsonObject, lastResult: e.result as JsonObject },
        },
      };
    }
    case "LOOP_EXITED": {
      const key = nodeKey(scope, nodeId);
      const loop = s.loops[key];
      let next: SchedulerState = loop
        ? { ...s, loops: { ...s.loops, [key]: { ...loop, exited: true } } }
        : s;
      // A body failure or a bound leaves the current iteration scope closed.
      if (loop)
        next = withScope(next, childScopePath(scope, nodeId, loop.iteration), (sc) => ({
          ...sc,
          closed: true,
        }));
      return next;
    }
    case "FOREACH_STARTED": {
      const key = nodeKey(scope, nodeId);
      const node = s.scopes[scope]?.nodes[nodeId] ?? IDLE;
      const items = ((node.input as { items?: unknown } | null)?.items ??
        []) as ForeachState["items"];
      const total = Math.min(items.length, e.itemCount);
      let next: SchedulerState = {
        ...s,
        foreach: {
          ...s.foreach,
          [key]: {
            scope,
            nodeId,
            items,
            total,
            concurrency: e.concurrency,
            opened: 0,
            done: 0,
            results: Array.from({ length: items.length }, () => null),
            errors: Array.from({ length: items.length }, () => null),
            failed: false,
            usage: ZERO_USAGE,
            costUsd: 0,
          },
        },
      };
      for (let i = 0; i < Math.min(total, e.concurrency); i += 1)
        next = openForeachItem(plan, next, key);
      return next;
    }
    case "FOREACH_ITEM_COMPLETED": {
      const key = nodeKey(scope, nodeId);
      const fe = s.foreach[key];
      let next = withScope(s, e.childScope, (sc) => ({ ...sc, closed: true }));
      if (!fe) return next;
      const results = fe.results.slice();
      const errors = fe.errors.slice();
      results[e.index] = e.result ?? null;
      errors[e.index] = e.error ?? null;
      const op = plan.nodes[nodeId]?.op;
      const failed =
        fe.failed ||
        (e.status === "failed" && op?.kind === "foreach" && op.failurePolicy === "fail_fast");
      next = {
        ...next,
        foreach: { ...next.foreach, [key]: { ...fe, results, errors, done: fe.done + 1, failed } },
      };
      if (!failed && fe.opened < fe.total) next = openForeachItem(plan, next, key);
      return next;
    }
    case "SUBFLOW_STARTED":
      return {
        ...s,
        subruns: { ...s.subruns, [e.childRunId]: { scope, nodeId, nodeRunId: e.nodeRunId } },
      };
    case "SUBFLOW_COMPLETED": {
      const { [e.childRunId]: _gone, ...subruns } = s.subruns;
      return { ...s, subruns };
    }
    case "JOIN_ARRIVED": {
      const key = nodeKey(scope, nodeId);
      const join = s.joins[key] ?? { arrivals: {}, timerId: null, timedOut: false };
      return {
        ...s,
        joins: {
          ...s.joins,
          [key]: { ...join, arrivals: { ...join.arrivals, [e.edgeId]: e.status } },
        },
      };
    }
    case "BRANCH_EVALUATED":
    case "EVENT_RECEIVED":
    case "DECISION_REQUESTED":
    case "PROVIDER_FAILOVER":
    case "GENERATION_STARTED":
    case "TOOL_CALLED":
    case "TOOL_RETURNED":
    case "HUMAN_TASK_ESCALATED":
    case "LOG":
    case "METRIC":
    case "ARTIFACT_CREATED":
    case "STATE_WRITTEN":
      return s;
  }
}

function openForeachItem(plan: ExecutionPlan, s: SchedulerState, key: string): SchedulerState {
  const fe = s.foreach[key];
  if (!fe || fe.opened >= fe.total) return s;
  const index = fe.opened;
  const next: SchedulerState = {
    ...s,
    foreach: { ...s.foreach, [key]: { ...fe, opened: index + 1 } },
  };
  return openScope(next, fe.scope, fe.nodeId, index, bodyScopeOf(plan, fe.nodeId), {
    item: fe.items[index] ?? null,
    index,
  });
}

export function reduce(plan: ExecutionPlan, s: SchedulerState, e: DurableRunEvent): SchedulerState {
  const base: SchedulerState = { ...s, run: { ...s.run, lastSeq: Math.max(s.run.lastSeq, e.seq) } };
  if ("nodeRunId" in e && "scope" in e && "attempt" in e && typeof e.nodeRunId === "string") {
    return reduceNodeEvent(plan, base, e);
  }
  switch (e.type) {
    case "RUN_CREATED":
      return { ...base, run: { ...base.run, input: e.input } };
    case "RUN_STARTED":
      return {
        ...base,
        run: {
          ...base.run,
          status: "starting",
          startedAt: base.run.startedAt ?? e.at,
          deadlineAt: e.deadlineAt,
        },
      };
    case "RUN_WAITING": {
      let status: SchedulerState["run"]["status"] = "waiting";
      if (e.reason === "human") status = "waiting_for_human";
      else if (e.reason === "timer") {
        const retrying =
          e.nodeRunIds.length > 0 &&
          e.nodeRunIds.every((id) => {
            const at = base.nodeRuns[id];
            return at ? base.scopes[at.scope]?.nodes[at.nodeId]?.status === "retry_wait" : false;
          });
        if (retrying) status = "retrying";
      }
      return { ...base, run: { ...base.run, status } };
    }
    case "RUN_RESUMED":
      return { ...base, run: { ...base.run, status: "running" } };
    case "RUN_CANCEL_REQUESTED":
      return { ...base, run: { ...base.run, cancelRequested: true } };
    case "RUN_OUTPUT":
      return {
        ...base,
        run: {
          ...base.run,
          outputs: [
            ...base.run.outputs,
            { nodeId: e.nodeId, output: e.output, outcome: e.outcome },
          ],
        },
      };
    case "RUN_COMPLETED":
      return { ...base, run: { ...base.run, status: "completed" } };
    case "RUN_FAILED":
      return { ...base, run: { ...base.run, status: "failed", error: e.error } };
    case "RUN_CANCELLED":
      return { ...base, run: { ...base.run, status: "cancelled" } };
    case "RUN_TIMED_OUT":
      return { ...base, run: { ...base.run, status: "timed_out" } };
    case "HUMAN_TASK_EXPIRED":
    case "RUN_LEASE_TAKEN":
    case "CHECKPOINT_CREATED":
    case "NODE_SCHEDULED":
    case "NODE_STARTED":
    case "NODE_COMPLETED":
    case "NODE_FAILED":
    case "NODE_RETRIED":
    case "NODE_SKIPPED":
    case "NODE_CANCELLED":
    case "NODE_WAITING":
    case "NODE_DELEGATED":
    case "BRANCH_EVALUATED":
    case "JOIN_ARRIVED":
    case "LOOP_ITERATION_STARTED":
    case "LOOP_ITERATION_COMPLETED":
    case "LOOP_EXITED":
    case "FOREACH_STARTED":
    case "FOREACH_ITEM_COMPLETED":
    case "SUBFLOW_STARTED":
    case "SUBFLOW_COMPLETED":
    case "TIMER_SET":
    case "TIMER_FIRED":
    case "EVENT_RECEIVED":
    case "DECISION_REQUESTED":
    case "DECISION_COMPLETED":
    case "PROVIDER_FAILOVER":
    case "GENERATION_STARTED":
    case "GENERATION_COMPLETED":
    case "TOOL_CALLED":
    case "TOOL_RETURNED":
    case "HUMAN_APPROVAL_REQUESTED":
    case "HUMAN_APPROVAL_RECEIVED":
    case "HUMAN_TASK_ESCALATED":
    case "LOG":
    case "METRIC":
    case "ARTIFACT_CREATED":
    case "STATE_WRITTEN":
      return base;
  }
}

/** Reduces a whole log from a starting state. */
export function reduceAll(
  plan: ExecutionPlan,
  s: SchedulerState,
  events: readonly DurableRunEvent[],
): SchedulerState {
  return events.reduce((acc, e) => reduce(plan, acc, e), s);
}
