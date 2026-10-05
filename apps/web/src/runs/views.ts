/** Run-side API rows → @flowaid/ui view types. Pure, so they are unit tested. */
import type {
  DecisionResult,
  NodeRun,
  RunEvent,
  WorkflowDefinition,
  WorkflowNode,
} from "@flowaid/workflow-core";
import type { ApprovalRequestView, EnvironmentView, NodeRunView, RunView } from "@flowaid/ui";
import { foldRunEvents, humanTaskToApproval, toNodeRunView, toRunView } from "@flowaid/ui/lib";
import type { Environment, HumanTask, Run } from "~/api/types";
import { nodeCategory } from "./graph";
import type { Catalog } from "./types";

export interface RunJoinsLookup {
  workflowNames: ReadonlyMap<string, string>;
  /** Version numbers by version id, for runs listed without `include=version`. */
  versions?: ReadonlyMap<string, number | "draft">;
  environments: readonly Environment[];
}

export function environmentView(
  envs: readonly Environment[],
  id: string | null | undefined,
): EnvironmentView | undefined {
  const e = envs.find((x) => x.id === id);
  return e ? { id: e.id, name: e.name, protected: e.protected } : undefined;
}

/** A list row: the run without node runs. */
export function toRunRow(run: Run, j: RunJoinsLookup): RunView {
  const env = environmentView(j.environments, run.environmentId);
  const view = toRunView(run as Parameters<typeof toRunView>[0], {
    workflowName: j.workflowNames.get(run.workflowId) ?? "Untitled workflow",
    version:
      run.version !== undefined
        ? (run.version ?? "draft")
        : (j.versions?.get(run.workflowVersionId) ?? "draft"),
    ...(env ? { environment: env } : {}),
  });
  if (run.decisions)
    view.decisions = run.decisions.map((d) => ({
      ...d,
      kind: d.kind as NonNullable<RunView["decisions"]>[number]["kind"],
    }));
  return view;
}

/** Node id → definition node, for names and categories. */
export function nodeIndex(definition: WorkflowDefinition | undefined): Map<string, WorkflowNode> {
  return new Map((definition?.nodes ?? []).map((n) => [n.id, n]));
}

export function nodeRunViews(
  nodeRuns: readonly NodeRun[],
  definition: WorkflowDefinition | undefined,
  catalog: Catalog,
): NodeRunView[] {
  const byId = nodeIndex(definition);
  return nodeRuns.map((nr) => {
    const def = byId.get(nr.nodeId);
    return toNodeRunView(nr, {
      category: def ? nodeCategory(def, catalog) : nr.kind === "human" ? "human" : "flow",
      ...(def ? { nodeName: def.name } : {}),
    });
  });
}

export interface LiveRunInput {
  run: Run;
  nodeRuns: readonly NodeRun[];
  events: readonly unknown[];
  definition?: WorkflowDefinition;
  catalog: Catalog;
  workflowName: string;
  version: number | "draft";
  environment?: EnvironmentView;
  pendingApproval?: ApprovalRequestView;
}

/**
 * The trace's RunView: the stored node runs, extended by every event received so far (the
 * events are the source of truth while the run is live; the projection fills inputs/outputs).
 */
export function toLiveRunView(i: LiveRunInput) {
  const byId = nodeIndex(i.definition);
  const base = nodeRunViews(i.nodeRuns, i.definition, i.catalog);
  const folded = foldRunEvents(i.events, {
    nodeRuns: base,
    categoryFor: (id) => (byId.has(id) ? nodeCategory(byId.get(id), i.catalog) : undefined),
    nodeNameFor: (id) => byId.get(id)?.name,
  });
  // The stored projection wins for fields events do not carry (input/output of node runs).
  const stored = new Map(base.map((n) => [n.id, n]));
  const nodeRuns = supersedeRetried(
    folded.nodeRuns.map((n) => {
      const s = stored.get(n.id);
      return s ? { ...n, input: n.input ?? s.input, output: n.output ?? s.output } : n;
    }),
  );
  const view = toRunView(i.run as Parameters<typeof toRunView>[0], {
    workflowName: i.workflowName,
    version: i.version,
    nodeRuns,
    ...(i.environment ? { environment: i.environment } : {}),
    ...(i.pendingApproval ? { pendingApproval: i.pendingApproval } : {}),
  });
  const reopened =
    folded.status === "failed" &&
    (retriedAfterFailure(i.events) ||
      (isActiveRun(i.run.status) && i.run.lastSeq >= folded.lastSeq));
  if (reopened) {
    // a retry-node reopened the failed run in place: it runs again, with no error or end yet
    view.status = isActiveRun(i.run.status) ? i.run.status : "running";
    delete view.error;
    delete view.endedAt;
    delete view.durationMs;
  } else {
    if (folded.status) view.status = folded.status;
    if (folded.error) view.error = folded.error;
    if (folded.durationMs !== undefined) view.durationMs = folded.durationMs;
  }
  if (folded.output !== undefined) view.output = folded.output;
  if (folded.costUsd !== undefined) view.costUsd = folded.costUsd;
  if (folded.usage) view.usage = folded.usage;
  return { view, folded };
}

/** The reason given when the run was cancelled (its RUN_CANCEL_REQUESTED), if any. */
export function runCancelReason(events: readonly unknown[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i] as { type?: unknown; reason?: unknown };
    if (e.type === "RUN_CANCEL_REQUESTED")
      return typeof e.reason === "string" && e.reason.trim() ? e.reason.trim() : undefined;
  }
  return undefined;
}

/** The time limit a timed-out run reached, from its RUN_TIMED_OUT event. */
export function runTimeoutMs(events: readonly unknown[]): number | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i] as { type?: unknown; timeoutMs?: unknown };
    if (e.type === "RUN_TIMED_OUT" && typeof e.timeoutMs === "number") return e.timeoutMs;
  }
  return undefined;
}

/**
 * Whether a retry-node reopened the run after it failed (ARCHITECTURE.md §5.9): its events go on
 * after RUN_FAILED with NODE_RETRIED. The fold keeps the last RUN_* status, so without this the
 * header read "Failed" while the retry ran.
 */
export function retriedAfterFailure(events: readonly unknown[]): boolean {
  let failed = -1;
  let retried = -1;
  for (const e of events) {
    const x = e as { type?: unknown; seq?: unknown; ephemeral?: unknown };
    if (x.ephemeral === true || typeof x.seq !== "number") continue;
    if (x.type === "RUN_FAILED") failed = Math.max(failed, x.seq);
    else if (x.type === "NODE_RETRIED") retried = Math.max(retried, x.seq);
  }
  return failed >= 0 && retried > failed;
}

/**
 * An attempt that a later attempt of the same step replaced has failed: the fold leaves it
 * `retry_wait` (its NODE_RETRIED), which read as one more active span for good.
 */
function supersedeRetried(nodeRuns: NodeRunView[]): NodeRunView[] {
  const latest = new Map<string, number>();
  for (const n of nodeRuns) {
    const key = `${n.scope ?? ""}|${n.nodeId}`;
    latest.set(key, Math.max(latest.get(key) ?? 0, n.attempt));
  }
  return nodeRuns.map((n) =>
    n.status === "retry_wait" && n.attempt < (latest.get(`${n.scope ?? ""}|${n.nodeId}`) ?? 0)
      ? { ...n, status: "failed" }
      : n,
  );
}

/** Durable events only, parsed, in seq order (EventLog input). */
export function durableEvents(events: readonly unknown[]): RunEvent[] {
  return events.filter(
    (e): e is RunEvent =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as { type?: unknown }).type === "string" &&
      (e as { ephemeral?: unknown }).ephemeral !== true,
  );
}

/** Merges streamed events into the loaded ones: durable events dedupe by seq, deltas append. */
export function mergeEvents(current: readonly unknown[], incoming: readonly unknown[]): unknown[] {
  const seen = new Set<number>();
  for (const e of current) {
    const x = e as { seq?: number; ephemeral?: boolean };
    if (!x.ephemeral && typeof x.seq === "number") seen.add(x.seq);
  }
  const out = [...current];
  for (const e of incoming) {
    const x = e as { seq?: number; ephemeral?: boolean };
    if (!x.ephemeral && typeof x.seq === "number") {
      if (seen.has(x.seq)) continue;
      seen.add(x.seq);
    }
    out.push(e);
  }
  return out;
}

export function lastDurableSeq(events: readonly unknown[]): number {
  let max = 0;
  for (const e of events) {
    const x = e as { seq?: number; ephemeral?: boolean };
    if (!x.ephemeral && typeof x.seq === "number") max = Math.max(max, x.seq);
  }
  return max;
}

/** The latest decision of the node run that sent the run to this task (for the "why" line). */
function decisionBefore(nodeRuns: readonly NodeRunView[] | undefined): DecisionResult | undefined {
  return [...(nodeRuns ?? [])].reverse().find((n) => n.decision)?.decision;
}

export function taskToApproval(
  task: HumanTask,
  nodeName: string,
  nodeRuns?: readonly NodeRunView[],
): ApprovalRequestView {
  const decision = task.request.origin === "human_node" ? undefined : decisionBefore(nodeRuns);
  return humanTaskToApproval(
    {
      id: task.id,
      runId: task.runId,
      nodeId: task.nodeId,
      request: task.request,
      createdAt: task.createdAt,
    },
    { nodeName, ...(decision ? { decision } : {}) },
  );
}

export const TERMINAL_RUN = new Set(["completed", "failed", "cancelled", "timed_out"]);
export const isActiveRun = (status: string) => !TERMINAL_RUN.has(status);
