/**
 * The scheduler (ARCHITECTURE.md §5.9): every poll claims due schedules with `FOR UPDATE SKIP
 * LOCKED` (so replicas never fire one twice), starts a run per fire (origin `schedule`,
 * idempotency key `schedule:<id>:<fireAt>`), honours `overlap` (skip while the last run is still
 * active), `catch_up` (skip / one / all up to `max_catch_up`) and `jitter_ms`, and records
 * `last_error` when a fire cannot start.
 */
import { Cron } from "croner";
import { and, eq, inArray, lte } from "drizzle-orm";
import {
  PgRunStore,
  runs,
  schedules,
  workflowDeployments,
  workflowVersions,
  type Database,
  type Tx,
} from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import type { QueueDriver, Run } from "@flowaid/workflow-core";

const ACTIVE: Run["status"][] = [
  "queued",
  "starting",
  "running",
  "waiting",
  "waiting_for_human",
  "retrying",
];

export interface SchedulerOptions {
  db: Database;
  queue: QueueDriver;
  now?: () => Date;
  batch?: number;
  onError?: (error: unknown, scheduleId: string) => void;
}

/** Fire times due at `now`, oldest first, per the catch-up policy. */
export function dueFires(
  cron: string,
  timezone: string,
  nextRunAt: Date,
  now: Date,
  catchUp: "skip" | "one" | "all",
  maxCatchUp: number,
): Date[] {
  if (nextRunAt > now) return [];
  if (catchUp === "skip" || catchUp === "one") return [nextRunAt];
  const job = new Cron(cron, { timezone, paused: true });
  const fires: Date[] = [nextRunAt];
  let cursor = nextRunAt;
  while (fires.length < Math.max(1, maxCatchUp)) {
    const next = job.nextRun(cursor);
    if (!next || next > now) break;
    fires.push(next);
    cursor = next;
  }
  return fires;
}

async function planScheduledRun(
  tx: Tx,
  o: SchedulerOptions,
  s: typeof schedules.$inferSelect,
  fireAt: Date,
): Promise<{ run: Run; planHash: string } | null> {
  const [dep] = await tx
    .select({ versionId: workflowDeployments.versionId, planHash: workflowVersions.planHash })
    .from(workflowDeployments)
    .innerJoin(workflowVersions, eq(workflowVersions.id, workflowDeployments.versionId))
    .where(
      and(
        eq(workflowDeployments.workflowId, s.workflowId),
        eq(workflowDeployments.environmentId, s.environmentId),
        eq(workflowDeployments.active, true),
      ),
    );
  if (!dep) throw new Error("the workflow is not deployed to this schedule's environment");
  const key = `schedule:${s.id}:${fireAt.toISOString()}`;
  const [existing] = await tx
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.workspaceId, s.workspaceId), eq(runs.idempotencyKey, key)));
  if (existing) return null;
  const id = uuidv7();
  const now = (o.now ?? (() => new Date()))().toISOString();
  const run: Run = {
    id,
    workspaceId: s.workspaceId,
    workflowId: s.workflowId,
    workflowVersionId: dep.versionId,
    environmentId: s.environmentId,
    status: "queued",
    origin: "schedule",
    mode: "async",
    input: s.input,
    output: null,
    outcome: null,
    error: null,
    parentRunId: null,
    parentNodeRunId: null,
    sourceRunId: null,
    sessionId: null,
    idempotencyKey: key,
    labels: { scheduleId: s.id, fireAt: fireAt.toISOString() },
    lastSeq: 1,
    usage: { inputTokens: 0, outputTokens: 0 },
    costUsd: 0,
    nodeRunCount: 0,
    createdAt: now,
    startedAt: null,
    endedAt: null,
  };
  // The run row and RUN_CREATED go through the store after the schedule transaction commits.
  return { run, planHash: dep.planHash };
}

/** One scheduler pass; returns the ids of the runs it started. */
export async function tickSchedules(o: SchedulerOptions): Promise<string[]> {
  const now = (o.now ?? (() => new Date()))();
  const pending: { run: Run; planHash: string }[] = [];
  await o.db.system(async (tx) => {
    const due = await tx
      .select()
      .from(schedules)
      .where(and(eq(schedules.enabled, true), lte(schedules.nextRunAt, now)))
      .orderBy(schedules.nextRunAt)
      .limit(o.batch ?? 20)
      .for("update", { skipLocked: true });
    for (const s of due) {
      try {
        if (s.overlap === "skip" && s.lastRunId) {
          const [last] = await tx
            .select({ status: runs.status })
            .from(runs)
            .where(and(eq(runs.id, s.lastRunId), inArray(runs.status, ACTIVE)));
          if (last) {
            const next = new Cron(s.cron, { timezone: s.timezone, paused: true }).nextRun(now);
            await tx
              .update(schedules)
              .set({
                nextRunAt: next ?? null,
                lastError: "skipped: the previous run is still active",
              })
              .where(eq(schedules.id, s.id));
            continue;
          }
        }
        const fires = dueFires(
          s.cron,
          s.timezone,
          s.nextRunAt as Date,
          now,
          s.catchUp,
          s.maxCatchUp,
        );
        let lastRun: string | null = null;
        for (const fireAt of s.catchUp === "skip" ? fires.slice(-1) : fires) {
          const planned = await planScheduledRun(tx, o, s, fireAt);
          if (planned) {
            pending.push(planned);
            lastRun = planned.run.id;
          }
        }
        const jitter = s.jitterMs > 0 ? Math.floor(Math.random() * s.jitterMs) : 0;
        const next = new Cron(s.cron, { timezone: s.timezone, paused: true }).nextRun(now);
        await tx
          .update(schedules)
          .set({
            nextRunAt: next ? new Date(next.getTime() + jitter) : null,
            lastRunAt: now,
            ...(lastRun ? { lastRunId: lastRun } : {}),
            lastError: null,
          })
          .where(eq(schedules.id, s.id));
      } catch (error) {
        o.onError?.(error, s.id);
        await tx
          .update(schedules)
          .set({
            lastError: error instanceof Error ? error.message.slice(0, 500) : String(error),
            nextRunAt:
              new Cron(s.cron, { timezone: s.timezone, paused: true }).nextRun(now) ?? null,
          })
          .where(eq(schedules.id, s.id));
      }
    }
  });
  const store = new PgRunStore(o.db);
  const started: string[] = [];
  for (const { run, planHash } of pending) {
    try {
      await store.createRun(run, {
        type: "RUN_CREATED",
        runId: run.id,
        seq: 1,
        at: run.createdAt,
        workflowVersionId: run.workflowVersionId,
        environmentId: run.environmentId,
        origin: "schedule",
        mode: "async",
        input: run.input,
        planHash,
        idempotencyKey: run.idempotencyKey,
        sourceRunId: null,
      });
      await o.queue.enqueue(
        "run:general",
        { type: "run.start", runId: run.id },
        { jobId: `run.start:${run.id}` },
      );
      started.push(run.id);
    } catch (error) {
      // A concurrent tick created the same fire (idempotency key): nothing to do.
      if (!/runs_idem_uq|duplicate key/.test(String((error as { cause?: unknown }).cause ?? error)))
        o.onError?.(error, String(run.labels.scheduleId));
    }
  }
  return started;
}

export function startScheduler(o: SchedulerOptions & { pollMs?: number }): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const loop = async () => {
    if (stopped) return;
    try {
      await tickSchedules(o);
    } catch (error) {
      o.onError?.(error, "*");
    }
    if (!stopped) timer = setTimeout(() => void loop(), o.pollMs ?? 15_000);
  };
  void loop();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
