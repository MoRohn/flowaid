/**
 * The scheduler (ARCHITECTURE.md §5.9): every poll claims due schedules with `FOR UPDATE SKIP
 * LOCKED` (so replicas never fire one twice), starts a run per fire (origin `schedule`,
 * idempotency key `schedule:<id>:<fireAt>`), honours `overlap` (skip while the last run is still
 * active), `catch_up` and `jitter_ms`, and records `last_error` when a fire cannot start.
 *
 * Catch-up: the fires due at a poll are `next_run_at` and every cron time after it up to now. The
 * newest is on time when it is at most `misfireGraceMs` old (default 60 s, at least two polls);
 * every other due fire was missed (the scheduler was not running). With N missed fires:
 * - `skip` starts no missed run: only an on-time fire starts one;
 * - `one` starts exactly one run, at the newest due fire, for all of them;
 * - `all` starts one run per due fire, the newest `max_catch_up` of them (at most 100).
 *
 * Before starting a run the schedule's input is checked against the deployed version's inputs
 * schema; an input that does not match records `last_error` (and `schedule.failed`) instead, as
 * does a fire once the workspace's monthly budget is spent.
 */
import { Cron } from "croner";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import {
  PgRunStore,
  runs,
  schedules,
  workflowDeployments,
  workflowVersions,
  budgetStatusIfSet,
  type Database,
  type Tx,
} from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import { describeInputIssues, inputIssues } from "@flowaid/workflow-compiler";
import {
  BudgetExceededError,
  type JsonSchema,
  type QueueDriver,
  type Run,
} from "@flowaid/workflow-core";

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
  /** how late the newest due fire may be and still start under `catch_up: skip` (default 60 s) */
  misfireGraceMs?: number;
  onError?: (error: unknown, scheduleId: string) => void;
  /** A schedule could not start its run (recorded as `last_error`); drives `schedule.failed`. */
  onFailed?: (failure: {
    scheduleId: string;
    workspaceId: string;
    workflowId: string;
    error: string;
  }) => void;
}

/** How late the newest due fire may be and still count as on time (not missed). */
export const MISFIRE_GRACE_MS = 60_000;
/** Upper bound of `max_catch_up`: a long outage never starts more runs than this per schedule. */
export const MAX_CATCH_UP = 100;
/** Missed fires are counted up to this many (a per-second cron after a week offline is 600 000). */
export const DROPPED_COUNT_LIMIT = 10_000;

export interface DueFires {
  /** fires to start now, oldest first */
  fire: Date[];
  /**
   * due fires that start no run (missed under `skip`, folded into one by `one`, beyond the bound
   * of `all`), counted up to DROPPED_COUNT_LIMIT
   */
  dropped: number;
}

const fireCap = (catchUp: "skip" | "one" | "all", maxCatchUp: number) =>
  catchUp === "all" ? Math.min(MAX_CATCH_UP, Math.max(1, maxCatchUp)) : 1;

/**
 * The fires due at `now` under the catch-up policy (see the header). `nextRunAt` (which may carry
 * jitter) is the oldest due fire; the cron times after it up to `now` follow.
 */
export function dueFires(
  cron: string,
  timezone: string,
  nextRunAt: Date,
  now: Date,
  catchUp: "skip" | "one" | "all",
  maxCatchUp: number,
  misfireGraceMs = MISFIRE_GRACE_MS,
): DueFires {
  if (nextRunAt > now) return { fire: [], dropped: 0 };
  const job = new Cron(cron, { timezone, paused: true });
  const keep = fireCap(catchUp, maxCatchUp);
  // the newest `keep` cron times at or before now (previousRuns is newest first and exclusive of
  // its reference, which it truncates to the second)
  const recent = job
    .previousRuns(keep, new Date(now.getTime() + 1000))
    .filter((d) => d > nextRunAt && d <= now)
    .reverse();
  const due = recent.length < keep ? [nextRunAt, ...recent] : recent;
  // how many due fires there are in all (counted only when some are dropped)
  let total = due.length;
  if (recent.length >= keep) {
    total = 1;
    let cursor: Date | null = nextRunAt;
    while (total < DROPPED_COUNT_LIMIT + keep && (cursor = job.nextRun(cursor)) && cursor <= now)
      total++;
  }
  const newest = due[due.length - 1] as Date;
  let fire: Date[];
  if (catchUp === "all") fire = due;
  else if (catchUp === "one") fire = [newest];
  else fire = now.getTime() - newest.getTime() <= misfireGraceMs ? [newest] : [];
  return { fire, dropped: Math.min(DROPPED_COUNT_LIMIT, total - fire.length) };
}

/** What `last_error` says about due fires that started no run (`one` folding them is expected). */
function droppedNote(catchUp: "skip" | "one" | "all", dropped: number): string | null {
  if (dropped <= 0 || catchUp === "one") return null;
  const n = `${dropped >= DROPPED_COUNT_LIMIT ? `${DROPPED_COUNT_LIMIT}+` : dropped} missed run${dropped === 1 ? "" : "s"}`;
  return catchUp === "skip"
    ? `skipped ${n} (catch-up: skip)`
    : `skipped the oldest ${n} (catch-up: all starts at most max_catch_up)`;
}

async function planScheduledRun(
  tx: Tx,
  o: SchedulerOptions,
  s: typeof schedules.$inferSelect,
  fireAt: Date,
): Promise<{ run: Run; planHash: string } | null> {
  const [dep] = await tx
    .select({
      versionId: workflowDeployments.versionId,
      planHash: workflowVersions.planHash,
      inputs: sql<JsonSchema>`${workflowVersions.plan}->'inputs'`,
    })
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
  const issues = inputIssues(dep.inputs ?? {}, s.input);
  if (issues.length > 0)
    throw new Error(
      `the schedule's input does not match the deployed version's inputs, so no run was started: ${describeInputIssues(issues)}`,
    );
  // the monthly budget: a fire is refused (recorded as last_error, schedule.failed) once it is spent
  const budget = await budgetStatusIfSet(tx, s.workspaceId, (o.now ?? (() => new Date()))());
  if (budget?.reached && budget.monthlyCostUsd !== null)
    throw new BudgetExceededError(budget.month, budget.spentUsd, budget.monthlyCostUsd);
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
        const { fire, dropped } = dueFires(
          s.cron,
          s.timezone,
          s.nextRunAt as Date,
          now,
          s.catchUp,
          s.maxCatchUp,
          o.misfireGraceMs,
        );
        let lastRun: string | null = null;
        for (const fireAt of fire) {
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
            ...(fire.length ? { lastRunAt: now } : {}),
            ...(lastRun ? { lastRunId: lastRun } : {}),
            lastError: droppedNote(s.catchUp, dropped),
          })
          .where(eq(schedules.id, s.id));
      } catch (error) {
        o.onError?.(error, s.id);
        o.onFailed?.({
          scheduleId: s.id,
          workspaceId: s.workspaceId,
          workflowId: s.workflowId,
          error: error instanceof Error ? error.message.slice(0, 500) : String(error),
        });
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
  // a fire is on time for at least two polls, so a slow poll never drops one under `skip`
  o = {
    ...o,
    misfireGraceMs: o.misfireGraceMs ?? Math.max(MISFIRE_GRACE_MS, 2 * (o.pollMs ?? 15_000)),
  };
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
