/**
 * `flowaid db reproject <runId>`: rebuilds a run's projections from its event log with the same
 * `applyProjection` that `appendEvents` uses. The run's node runs, human tasks, timers and event
 * subscriptions are deleted and replayed; the `runs` row is reset to its created state and
 * replayed. Lease and cancel-request columns are kept (they are not projections), as are human
 * task responses the API wrote by compare-and-set (the replayed HUMAN_APPROVAL_RECEIVED restores
 * them) and timer cancellations.
 */
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { NotFoundError, type DurableRunEvent } from "@flowaid/workflow-core";
import type { Database, Tx } from "./db.js";
import { applyProjection, runProjectionOf, writeRunProjection } from "./projections.js";
import { eventSubscriptions, humanTasks, nodeRuns, runEvents, runTimers, runs } from "./schema.js";

export interface ReprojectResult {
  runId: string;
  events: number;
  nodeRuns: number;
}

/** Replays one run inside an open transaction (the caller holds the scope). */
export async function reprojectRun(tx: Tx, runId: string): Promise<ReprojectResult> {
  const [row] = await tx.select().from(runs).where(eq(runs.id, runId)).for("update");
  if (!row) throw new NotFoundError(`Run ${runId} does not exist`);
  const cancelledTimers = await tx
    .select({ id: runTimers.id, cancelledAt: runTimers.cancelledAt })
    .from(runTimers)
    .where(and(eq(runTimers.runId, runId), isNotNull(runTimers.cancelledAt)));

  await tx.delete(nodeRuns).where(eq(nodeRuns.runId, runId));
  await tx.delete(humanTasks).where(eq(humanTasks.runId, runId));
  await tx.delete(runTimers).where(eq(runTimers.runId, runId));
  await tx.delete(eventSubscriptions).where(eq(eventSubscriptions.runId, runId));

  const projection = runProjectionOf({
    ...row,
    status: "queued",
    output: null,
    outcome: null,
    error: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    costUsd: "0",
    nodeRunCount: 0,
    startedAt: null,
    endedAt: null,
    expiresAt: null,
  });
  const events = await tx
    .select({ payload: runEvents.payload })
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(asc(runEvents.seq));
  for (const { payload } of events) {
    await applyProjection(tx, projection, payload as unknown as DurableRunEvent);
  }
  // Leases are live state, not history: keep what the row had.
  projection.leaseOwner = row.leaseOwner;
  projection.leaseUntil = row.leaseUntil;
  await writeRunProjection(tx, projection);
  for (const t of cancelledTimers) {
    await tx.update(runTimers).set({ cancelledAt: t.cancelledAt }).where(eq(runTimers.id, t.id));
  }
  return { runId, events: events.length, nodeRuns: projection.nodeRunCount };
}

/** Rebuilds one run's projections (system scope). */
export function reproject(database: Database, runId: string): Promise<ReprojectResult> {
  return database.system((tx) => reprojectRun(tx, runId));
}
