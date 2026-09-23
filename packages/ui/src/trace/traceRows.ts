/**
 * Flattens a run's node runs into the ordered row list the timeline renders:
 * retries of the same node are merged into one row (attempts become stacked
 * segments), children of loop nodes are grouped under "Iteration k of n"
 * headers, and collapsed groups hide their children.
 */
import type { NodeRunView } from "@/types";
import { toMs } from "./timeScale";

export interface TraceNodeRow {
  kind: "node";
  /** Stable row id: the id of the latest attempt. */
  id: string;
  /** The latest attempt (what the row shows). */
  nodeRun: NodeRunView;
  /** Every attempt of this node in this iteration, ascending by attempt. */
  attempts: NodeRunView[];
  depth: number;
  /** Set when this node owns loop iterations (a loop node run). */
  hasChildren: boolean;
}

export interface TraceGroupRow {
  kind: "group";
  id: string;
  /** Node run id of the loop that owns the iteration. */
  loopRunId: string;
  /** 1-based iteration number. */
  iteration: number;
  /** Total iterations, when known. */
  total?: number;
  label: string;
  depth: number;
  /** Node run ids inside the group (direct children). */
  childCount: number;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  status: NodeRunView["status"];
  collapsed: boolean;
}

export type TraceRow = TraceNodeRow | TraceGroupRow;

export interface BuildTraceRowsOptions {
  /** Group ids that are currently collapsed. */
  collapsed?: ReadonlySet<string>;
  /** Known iteration totals per loop node run id (e.g. from the loop's bounds). */
  loopTotals?: Readonly<Record<string, number>>;
}

/** Key shared by every attempt of the same node inside the same iteration. */
export function attemptKey(nodeRun: NodeRunView): string {
  return `${nodeRun.parentNodeRunId ?? ""}|${nodeRun.nodeId}|${(nodeRun.iteration ?? []).join(".")}`;
}

/** Group id for iteration `k` of the loop run `loopRunId`. */
export function iterationGroupId(loopRunId: string, iteration: number): string {
  return `${loopRunId}#${iteration}`;
}

function byStart(a: NodeRunView, b: NodeRunView, index: Map<string, number>): number {
  const ta = toMs(a.startedAt);
  const tb = toMs(b.startedAt);
  if (ta !== undefined && tb !== undefined && ta !== tb) return ta - tb;
  if (ta === undefined && tb !== undefined) return 1;
  if (tb === undefined && ta !== undefined) return -1;
  return (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0);
}

function groupStatus(children: NodeRunView[]): NodeRunView["status"] {
  if (children.some((c) => c.status === "failed")) return "failed";
  if (children.some((c) => c.status === "waiting")) return "waiting";
  if (children.some((c) => c.status === "retry_wait")) return "retry_wait";
  if (children.some((c) => c.status === "running")) return "running";
  if (children.some((c) => c.status === "pending")) return "pending";
  if (children.every((c) => c.status === "skipped")) return "skipped";
  if (children.some((c) => c.status === "cancelled")) return "cancelled";
  if (children.every((c) => c.status === "reused")) return "reused";
  return "completed";
}

/** Build the flattened, ordered list of rows. */
export function buildTraceRows(
  nodeRuns: readonly NodeRunView[],
  options: BuildTraceRowsOptions = {},
): TraceRow[] {
  const collapsed = options.collapsed ?? new Set<string>();
  const loopTotals = options.loopTotals ?? {};
  const order = new Map<string, number>();
  nodeRuns.forEach((n, i) => order.set(n.id, i));
  const known = new Set(nodeRuns.map((n) => n.id));

  // 1. merge attempts
  const attemptsByKey = new Map<string, NodeRunView[]>();
  for (const nr of nodeRuns) {
    const key = attemptKey(nr);
    const list = attemptsByKey.get(key);
    if (list) list.push(nr);
    else attemptsByKey.set(key, [nr]);
  }
  const merged: Array<{ latest: NodeRunView; attempts: NodeRunView[] }> = [];
  for (const attempts of attemptsByKey.values()) {
    attempts.sort((a, b) => a.attempt - b.attempt || byStart(a, b, order));
    const latest = attempts[attempts.length - 1];
    if (latest) merged.push({ latest, attempts });
  }

  // 2. index children by parent
  const childrenOf = new Map<string, Array<{ latest: NodeRunView; attempts: NodeRunView[] }>>();
  const roots: Array<{ latest: NodeRunView; attempts: NodeRunView[] }> = [];
  for (const m of merged) {
    const parent = m.latest.parentNodeRunId;
    if (parent && known.has(parent)) {
      const list = childrenOf.get(parent);
      if (list) list.push(m);
      else childrenOf.set(parent, [m]);
    } else roots.push(m);
  }
  // A retried parent: children may point at any attempt of it; fold them onto the latest attempt.
  for (const m of merged) {
    if (m.attempts.length < 2) continue;
    for (const a of m.attempts) {
      if (a.id === m.latest.id) continue;
      const list = childrenOf.get(a.id);
      if (!list) continue;
      childrenOf.delete(a.id);
      const target = childrenOf.get(m.latest.id);
      if (target) target.push(...list);
      else childrenOf.set(m.latest.id, list);
    }
  }

  const rows: TraceRow[] = [];

  const emit = (entry: { latest: NodeRunView; attempts: NodeRunView[] }, depth: number) => {
    const children = childrenOf.get(entry.latest.id) ?? [];
    rows.push({
      kind: "node",
      id: entry.latest.id,
      nodeRun: entry.latest,
      attempts: entry.attempts,
      depth,
      hasChildren: children.length > 0,
    });
    if (children.length === 0) return;

    // group children by their innermost iteration index
    const byIteration = new Map<number, Array<{ latest: NodeRunView; attempts: NodeRunView[] }>>();
    const ungrouped: Array<{ latest: NodeRunView; attempts: NodeRunView[] }> = [];
    for (const c of children) {
      const it = c.latest.iteration;
      const idx = it && it.length > 0 ? it[it.length - 1] : undefined;
      if (idx === undefined) {
        ungrouped.push(c);
        continue;
      }
      const list = byIteration.get(idx);
      if (list) list.push(c);
      else byIteration.set(idx, [c]);
    }
    ungrouped.sort((a, b) => byStart(a.latest, b.latest, order));
    for (const u of ungrouped) emit(u, depth + 1);

    const iterations = [...byIteration.keys()].sort((a, b) => a - b);
    const total = loopTotals[entry.latest.id];
    for (const idx of iterations) {
      const members = byIteration.get(idx) ?? [];
      members.sort((a, b) => byStart(a.latest, b.latest, order));
      const flat = members.flatMap((m) => m.attempts);
      const starts = flat.map((n) => toMs(n.startedAt)).filter((t): t is number => t !== undefined);
      const ends = flat.map((n) => toMs(n.endedAt)).filter((t): t is number => t !== undefined);
      const allEnded = flat.every((n) => n.endedAt !== undefined);
      const startMs = starts.length ? Math.min(...starts) : undefined;
      const endMs = allEnded && ends.length ? Math.max(...ends) : undefined;
      const gid = iterationGroupId(entry.latest.id, idx + 1);
      const isCollapsed = collapsed.has(gid);
      rows.push({
        kind: "group",
        id: gid,
        loopRunId: entry.latest.id,
        iteration: idx + 1,
        total,
        label: total ? `Iteration ${idx + 1} of ${total}` : `Iteration ${idx + 1}`,
        depth: depth + 1,
        childCount: members.length,
        startedAt: startMs !== undefined ? new Date(startMs).toISOString() : undefined,
        endedAt: endMs !== undefined ? new Date(endMs).toISOString() : undefined,
        durationMs: startMs !== undefined && endMs !== undefined ? endMs - startMs : undefined,
        status: groupStatus(members.map((m) => m.latest)),
        collapsed: isCollapsed,
      });
      if (isCollapsed) continue;
      for (const m of members) emit(m, depth + 2);
    }
  };

  roots.sort((a, b) => byStart(a.latest, b.latest, order));
  for (const r of roots) emit(r, 0);
  return rows;
}
