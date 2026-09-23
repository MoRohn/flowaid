/**
 * Projections (DATABASE.md, "Projections"): how each durable run event changes `runs`,
 * `node_runs`, `human_tasks`, `run_timers` and `event_subscriptions`. `appendEvents` applies them
 * in event order inside its fenced transaction, and `reproject` replays a run's whole log through
 * the same code, so `project(events) ≡ rows` holds by construction.
 *
 * Changes to the `runs` row are accumulated in memory (`RunProjection`) and written once per
 * batch; node-level changes are written per event, keyed by node run id.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DurableRunEvent, ErrorInfo, JsonValue, TokenUsage } from "@flowaid/workflow-core";
import type { Queryable } from "./db.js";
import type { RunRow } from "./mappers.js";
import { eventSubscriptions, humanTasks, nodeRuns, runTimers, runs } from "./schema.js";

type RunStatus = RunRow["status"];
type RetentionClass = RunRow["retentionClass"];

/** Days a finished run keeps its data, per retention class (0 = purge on completion). */
export const RETENTION_DAYS: Readonly<Record<RetentionClass, number>> = {
  standard: 90,
  short: 7,
  long: 400,
  none: 0,
};

const TERMINAL: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);

/** The `runs` columns a batch of events changes. */
export interface RunProjection {
  id: string;
  workspaceId: string;
  workflowId: string;
  retentionClass: RetentionClass;
  status: RunStatus;
  output: JsonValue | null;
  outcome: string | null;
  error: ErrorInfo | null;
  usage: TokenUsage;
  costUsd: number;
  nodeRunCount: number;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  expiresAt: Date | null;
}

export function runProjectionOf(row: RunRow): RunProjection {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    workflowId: row.workflowId,
    retentionClass: row.retentionClass,
    status: row.status,
    output: row.output ?? null,
    outcome: row.outcome,
    error: row.error ?? null,
    usage: { ...row.usage },
    costUsd: Number(row.costUsd),
    nodeRunCount: row.nodeRunCount,
    leaseOwner: row.leaseOwner,
    leaseUntil: row.leaseUntil,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    expiresAt: row.expiresAt,
  };
}

/** Sums two token usages (cache counts only when either side has them). */
export function addUsage(a: TokenUsage, b: TokenUsage | null | undefined): TokenUsage {
  if (!b) return a;
  const out: TokenUsage = {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
  if (a.cacheReadTokens !== undefined || b.cacheReadTokens !== undefined)
    out.cacheReadTokens = (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0);
  if (a.cacheWriteTokens !== undefined || b.cacheWriteTokens !== undefined)
    out.cacheWriteTokens = (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0);
  return out;
}

/** Money as the `numeric(12,6)` text Postgres stores. */
export const money = (usd: number): string => (Math.round(usd * 1e6) / 1e6).toFixed(6);

const date = (isoText: string) => new Date(isoText);

function finish(run: RunProjection, status: RunStatus, at: Date): void {
  run.status = status;
  run.endedAt = at;
  run.expiresAt = new Date(at.getTime() + RETENTION_DAYS[run.retentionClass] * 86_400_000);
  run.leaseOwner = null;
  run.leaseUntil = null;
}

/** Applies one event. Node rows are written now; `run` is written by `writeRunProjection`. */
export async function applyProjection(
  tx: Queryable,
  run: RunProjection,
  event: DurableRunEvent,
): Promise<void> {
  const at = date(event.at);
  switch (event.type) {
    case "RUN_STARTED":
      if (!TERMINAL.has(run.status)) run.status = "starting";
      run.startedAt ??= at;
      run.leaseOwner = event.workerId;
      run.leaseUntil = date(event.leaseUntil);
      return;
    case "RUN_LEASE_TAKEN":
      run.leaseOwner = event.workerId;
      return;
    case "RUN_WAITING": {
      if (event.reason === "human") run.status = "waiting_for_human";
      else if (event.reason === "timer" && event.nodeRunIds.length > 0) {
        const waiting = await tx
          .select({ status: nodeRuns.status })
          .from(nodeRuns)
          .where(inArray(nodeRuns.id, event.nodeRunIds));
        run.status =
          waiting.length > 0 && waiting.every((w) => w.status === "retry_wait")
            ? "retrying"
            : "waiting";
      } else run.status = "waiting";
      return;
    }
    case "RUN_RESUMED":
      run.status = "running";
      return;
    case "RUN_COMPLETED":
      run.output = event.output;
      run.outcome = event.outcome;
      run.usage = event.usage;
      run.costUsd = event.costUsd;
      finish(run, "completed", at);
      return;
    case "RUN_FAILED":
    case "RUN_CANCELLED":
    case "RUN_TIMED_OUT": {
      if (event.type === "RUN_FAILED") run.error = event.error;
      run.usage = event.usage;
      run.costUsd = event.costUsd;
      finish(
        run,
        event.type === "RUN_FAILED"
          ? "failed"
          : event.type === "RUN_CANCELLED"
            ? "cancelled"
            : "timed_out",
        at,
      );
      await tx
        .update(humanTasks)
        .set({ status: "cancelled" })
        .where(and(eq(humanTasks.runId, run.id), eq(humanTasks.status, "open")));
      await tx.delete(eventSubscriptions).where(eq(eventSubscriptions.runId, run.id));
      return;
    }

    case "NODE_SCHEDULED": {
      const inserted = await tx
        .insert(nodeRuns)
        .values({
          id: event.nodeRunId,
          runId: run.id,
          workspaceId: run.workspaceId,
          nodeId: event.nodeId,
          scope: event.scope,
          attempt: event.attempt,
          kind: event.kind as (typeof nodeRuns.$inferInsert)["kind"],
          nodeType: event.nodeType,
          nodeName: event.nodeId,
          status: "pending",
          idempotencyKey: event.idempotencyKey,
          inputHash: event.inputHash,
          reusedFromNodeRunId: event.reusedFromNodeRunId,
          scheduledSeq: event.seq,
        })
        .onConflictDoNothing()
        .returning({ id: nodeRuns.id });
      if (inserted.length > 0) run.nodeRunCount += 1;
      if (run.status === "starting") run.status = "running";
      return;
    }
    case "NODE_STARTED":
      if (run.status === "starting") run.status = "running";
      await tx
        .update(nodeRuns)
        .set({
          status: "running",
          startedAt: sql`coalesce(${nodeRuns.startedAt}, ${event.at}::timestamptz)`,
          input: event.input,
          pool: event.pool,
          workerId: event.workerId,
          queueLatencyMs: sql`coalesce(${nodeRuns.queueLatencyMs}, greatest(0, floor(extract(epoch from (${event.at}::timestamptz - (select e.at from run_events e where e.run_id = ${run.id} and e.seq = ${nodeRuns.scheduledSeq}))) * 1000))::int)`,
        })
        .where(eq(nodeRuns.id, event.nodeRunId));
      return;
    case "NODE_COMPLETED":
      run.usage = addUsage(run.usage, event.usage);
      run.costUsd += event.costUsd;
      await tx
        .update(nodeRuns)
        .set({
          status: event.reused ? "reused" : "completed",
          output: event.output,
          firedPorts: event.firedPorts,
          usage: event.usage,
          costUsd: money(event.costUsd),
          latencyMs: event.latencyMs,
          endedAt: at,
          endedSeq: event.seq,
        })
        .where(eq(nodeRuns.id, event.nodeRunId));
      return;
    case "NODE_FAILED":
      await tx
        .update(nodeRuns)
        .set(
          event.terminal
            ? {
                status: "failed",
                error: event.error,
                firedPorts: event.firedPorts,
                latencyMs: event.latencyMs,
                endedAt: at,
                endedSeq: event.seq,
              }
            : { error: event.error, firedPorts: event.firedPorts, latencyMs: event.latencyMs },
        )
        .where(eq(nodeRuns.id, event.nodeRunId));
      return;
    case "NODE_RETRIED":
      await tx
        .update(nodeRuns)
        .set({ status: "retry_wait", error: event.error })
        .where(eq(nodeRuns.id, event.nodeRunId));
      await tx
        .insert(runTimers)
        .values({
          id: event.timerId,
          runId: run.id,
          nodeRunId: event.nodeRunId,
          purpose: "retry",
          fireAt: new Date(at.getTime() + event.delayMs),
        })
        .onConflictDoNothing();
      return;
    case "NODE_SKIPPED":
    case "NODE_CANCELLED":
      await tx
        .update(nodeRuns)
        .set({
          status: event.type === "NODE_SKIPPED" ? "skipped" : "cancelled",
          endedAt: at,
          endedSeq: event.seq,
        })
        .where(eq(nodeRuns.id, event.nodeRunId));
      return;
    case "NODE_WAITING":
      await tx
        .update(nodeRuns)
        .set({ status: "waiting", waitState: event.state })
        .where(eq(nodeRuns.id, event.nodeRunId));
      if (event.reason === "event") {
        await tx
          .insert(eventSubscriptions)
          .values({
            workspaceId: run.workspaceId,
            eventName: event.ref,
            correlationKey: null,
            runId: run.id,
            nodeRunId: event.nodeRunId,
            createdAt: at,
          })
          .onConflictDoNothing();
      }
      return;
    case "EVENT_RECEIVED":
      await tx
        .delete(eventSubscriptions)
        .where(
          and(
            eq(eventSubscriptions.runId, run.id),
            eq(eventSubscriptions.nodeRunId, event.nodeRunId),
          ),
        );
      return;
    case "DECISION_COMPLETED":
      await tx
        .update(nodeRuns)
        .set({
          decision: event.decision,
          decisionKind: event.decision.kind,
          decisionValue: String(event.decision.value),
          decisionConfidence: event.decision.confidence.toFixed(5),
          decisionProvider: event.decision.provider,
        })
        .where(eq(nodeRuns.id, event.nodeRunId));
      return;
    case "GENERATION_COMPLETED":
      await tx
        .update(nodeRuns)
        .set({
          usage: sql`jsonb_build_object(
            'inputTokens', coalesce((${nodeRuns.usage}->>'inputTokens')::int, 0) + ${event.usage.inputTokens},
            'outputTokens', coalesce((${nodeRuns.usage}->>'outputTokens')::int, 0) + ${event.usage.outputTokens})`,
          costUsd: sql`${nodeRuns.costUsd} + ${money(event.costUsd)}::numeric`,
        })
        .where(eq(nodeRuns.id, event.nodeRunId));
      return;
    case "TIMER_SET":
      await tx
        .insert(runTimers)
        .values({
          id: event.timerId,
          runId: run.id,
          nodeRunId: event.nodeRunId,
          purpose: event.purpose,
          fireAt: date(event.fireAt),
        })
        .onConflictDoNothing();
      return;
    case "TIMER_FIRED":
      await tx
        .update(runTimers)
        .set({ firedAt: sql`coalesce(${runTimers.firedAt}, ${event.at}::timestamptz)` })
        .where(eq(runTimers.id, event.timerId));
      return;
    case "HUMAN_APPROVAL_REQUESTED":
      await tx
        .insert(humanTasks)
        .values({
          id: event.humanTaskId,
          workspaceId: run.workspaceId,
          runId: run.id,
          nodeRunId: event.nodeRunId,
          nodeId: event.nodeId,
          scope: event.scope,
          workflowId: run.workflowId,
          request: event.request,
          status: "open",
          assignees: event.request.assignees,
          expiresAt: event.request.expiresAt ? date(event.request.expiresAt) : null,
          createdAt: at,
        })
        .onConflictDoNothing();
      return;
    case "HUMAN_APPROVAL_RECEIVED":
      // Normally already `responded` through the API's compare-and-set; this covers replays.
      await tx
        .update(humanTasks)
        .set({
          status: "responded",
          response: event.response,
          respondedBy: event.by,
          respondedAt: at,
        })
        .where(and(eq(humanTasks.id, event.humanTaskId), eq(humanTasks.status, "open")));
      return;
    case "HUMAN_TASK_ESCALATED":
      await tx
        .update(humanTasks)
        .set({ assignees: event.to, escalatedAt: at })
        .where(eq(humanTasks.id, event.humanTaskId));
      return;
    case "HUMAN_TASK_EXPIRED":
      await tx
        .update(humanTasks)
        .set({ status: "expired" })
        .where(and(eq(humanTasks.id, event.humanTaskId), eq(humanTasks.status, "open")));
      return;
    // RUN_CREATED (row inserted by createRun), RUN_CANCEL_REQUESTED (flag columns set by the
    // API), RUN_OUTPUT (merged at completion), CHECKPOINT_CREATED (row written by the
    // orchestrator) and the telemetry, control-flow and tool events change no row.
    case "RUN_CREATED":
    case "RUN_CANCEL_REQUESTED":
    case "RUN_OUTPUT":
    case "CHECKPOINT_CREATED":
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
    case "DECISION_REQUESTED":
    case "PROVIDER_FAILOVER":
    case "GENERATION_STARTED":
    case "TOOL_CALLED":
    case "TOOL_RETURNED":
    case "LOG":
    case "METRIC":
    case "ARTIFACT_CREATED":
    case "STATE_WRITTEN":
      return;
  }
}

/** Writes the accumulated `runs` changes. */
export async function writeRunProjection(
  tx: Queryable,
  run: RunProjection,
  lastSeq?: number,
): Promise<void> {
  await tx
    .update(runs)
    .set({
      status: run.status,
      output: run.output,
      outcome: run.outcome,
      error: run.error,
      usage: run.usage,
      costUsd: money(run.costUsd),
      nodeRunCount: run.nodeRunCount,
      leaseOwner: run.leaseOwner,
      leaseUntil: run.leaseUntil,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      expiresAt: run.expiresAt,
      ...(lastSeq === undefined ? {} : { lastSeq }),
    })
    .where(eq(runs.id, run.id));
}
