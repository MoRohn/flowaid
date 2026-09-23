/**
 * `RunStore` on Postgres (DATABASE.md, "Projections"; ARCHITECTURE.md §5).
 *
 * `appendEvents` is the only writer of a run's log and projections. In one transaction it
 * 1. fences: `UPDATE runs SET last_seq = last_seq + n WHERE id AND lease_owner AND last_seq =
 *    expectedSeq` — zero rows means another worker owns the run (`WorkerLostError`, rollback);
 * 2. inserts the events with dense `seq` (validated by `RunEventSchema`);
 * 3. applies the projections in event order;
 * 4. `pg_notify('run_events', {runId, fromSeq, toSeq})` — ids only, delivered on commit.
 *
 * Leases, timers and cancellation use the database clock (`now()`), so workers with skewed
 * clocks still agree on who owns a run. The worker uses the system scope (row-level security
 * bypassed); pass `workspaceId` to scope a store to one tenant (the API).
 */
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import {
  RunEventSchema,
  WorkerLostError,
  type AppendOptions,
  type DecisionResult,
  type DurableRunEvent,
  type HumanResponse,
  type HumanTask,
  type JsonObject,
  type JsonValue,
  type LeaseInfo,
  type NodeId,
  type NodeRun,
  type PortName,
  type Run,
  type RunEventOf,
  type RunEventType,
  type RunStore,
  type RunTimer,
  type ScopePath,
} from "@flowaid/workflow-core";
import type { Database, Tx } from "../db.js";
import { toHumanTask, toNodeRun, toRun, toRunTimer } from "../mappers.js";
import { applyProjection, runProjectionOf, writeRunProjection } from "../projections.js";
import { humanTasks, nodeRuns, runCheckpoints, runEvents, runTimers, runs } from "../schema.js";

/** Channel of the commit notifications. */
export const RUN_EVENTS_CHANNEL = "run_events";

const TERMINAL = ["completed", "failed", "cancelled", "timed_out"] as const;

/** Key of `recordedOutputs()`: one recorded result per (node, scope, input hash). */
export function recordedKey(nodeId: NodeId, scope: ScopePath, inputHash: string): string {
  return `${scope}|${nodeId}|${inputHash}`;
}

export interface PgRunStoreOptions {
  /** Scope every query to one workspace (row-level security); default: system scope. */
  workspaceId?: string;
  /** Event timestamps (default: the process clock). Leases and timers use the database clock. */
  now?: () => Date;
}

type AppendInput = Omit<DurableRunEvent, "seq" | "runId" | "at">;

export class PgRunStore implements RunStore {
  private readonly now: () => Date;

  constructor(
    private readonly database: Database,
    private readonly options: PgRunStoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  private tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.options.workspaceId
      ? this.database.tenant(this.options.workspaceId, fn)
      : this.database.system(fn);
  }

  async createRun(run: Run, created: RunEventOf<"RUN_CREATED">): Promise<void> {
    const event = RunEventSchema.parse({ ...created, runId: run.id }) as RunEventOf<"RUN_CREATED">;
    await this.tx(async (tx) => {
      await tx.insert(runs).values({
        id: run.id,
        workspaceId: run.workspaceId,
        workflowId: run.workflowId,
        workflowVersionId: run.workflowVersionId,
        environmentId: run.environmentId,
        status: run.status,
        origin: run.origin,
        mode: run.mode,
        input: run.input,
        output: run.output,
        outcome: run.outcome,
        error: run.error,
        parentRunId: run.parentRunId,
        parentNodeRunId: run.parentNodeRunId,
        sourceRunId: run.sourceRunId,
        sessionId: run.sessionId,
        idempotencyKey: run.idempotencyKey,
        labels: run.labels,
        lastSeq: event.seq,
        createdAt: new Date(run.createdAt),
      });
      await tx.insert(runEvents).values(eventRow(event));
      await notify(tx, run.id, event.seq, event.seq);
    });
  }

  async getRun(runId: string): Promise<Run | null> {
    const [row] = await this.tx((tx) => tx.select().from(runs).where(eq(runs.id, runId)));
    return row ? toRun(row) : null;
  }

  async appendEvents(
    runId: string,
    events: readonly AppendInput[],
    opts: AppendOptions,
  ): Promise<{ firstSeq: number; lastSeq: number }> {
    if (events.length === 0) return { firstSeq: opts.expectedSeq + 1, lastSeq: opts.expectedSeq };
    const at = this.now().toISOString();
    const full = events.map(
      (e, i) =>
        RunEventSchema.parse({ ...e, runId, seq: opts.expectedSeq + 1 + i, at }) as DurableRunEvent,
    );
    const firstSeq = opts.expectedSeq + 1;
    const lastSeq = opts.expectedSeq + events.length;
    await this.tx(async (tx) => {
      const [row] = await tx
        .update(runs)
        .set({ lastSeq })
        .where(
          and(
            eq(runs.id, runId),
            eq(runs.leaseOwner, opts.leaseOwner),
            eq(runs.lastSeq, opts.expectedSeq),
          ),
        )
        .returning();
      if (!row) {
        throw new WorkerLostError(
          `Run ${runId} is not leased by ${opts.leaseOwner} at seq ${opts.expectedSeq}; another worker owns it`,
        );
      }
      await tx.insert(runEvents).values(full.map(eventRow));
      const projection = runProjectionOf(row);
      for (const event of full) await applyProjection(tx, projection, event);
      await writeRunProjection(tx, projection);
      await notify(tx, runId, firstSeq, lastSeq);
    });
    return { firstSeq, lastSeq };
  }

  async listEvents(
    runId: string,
    afterSeq: number,
    limit: number,
    types?: readonly RunEventType[],
  ): Promise<DurableRunEvent[]> {
    const rows = await this.tx((tx) =>
      tx
        .select({ payload: runEvents.payload })
        .from(runEvents)
        .where(
          and(
            eq(runEvents.runId, runId),
            gt(runEvents.seq, afterSeq),
            types && types.length > 0 ? inArray(runEvents.type, [...types]) : undefined,
          ),
        )
        .orderBy(asc(runEvents.seq))
        .limit(limit),
    );
    return rows.map((r) => r.payload as unknown as DurableRunEvent);
  }

  async listNodeRuns(runId: string): Promise<NodeRun[]> {
    const rows = await this.tx((tx) =>
      tx
        .select()
        .from(nodeRuns)
        .where(eq(nodeRuns.runId, runId))
        .orderBy(asc(nodeRuns.scheduledSeq), asc(nodeRuns.attempt)),
    );
    return rows.map(toNodeRun);
  }

  async getNodeOutput(
    runId: string,
    scope: ScopePath,
    nodeId: NodeId,
  ): Promise<{ output: JsonValue; nodeRunId: string; attempt: number } | null> {
    const [row] = await this.tx((tx) =>
      tx
        .select({ id: nodeRuns.id, output: nodeRuns.output, attempt: nodeRuns.attempt })
        .from(nodeRuns)
        .where(
          and(
            eq(nodeRuns.runId, runId),
            eq(nodeRuns.scope, scope),
            eq(nodeRuns.nodeId, nodeId),
            inArray(nodeRuns.status, ["completed", "reused"]),
          ),
        )
        .orderBy(desc(nodeRuns.attempt))
        .limit(1),
    );
    return row ? { output: row.output ?? null, nodeRunId: row.id, attempt: row.attempt } : null;
  }

  async recordedOutputs(runId: string): Promise<
    Map<
      string,
      {
        nodeRunId: string;
        output: JsonValue;
        firedPorts: PortName[];
        decision: DecisionResult | null;
      }
    >
  > {
    const rows = await this.tx((tx) =>
      tx
        .select()
        .from(nodeRuns)
        .where(
          and(
            eq(nodeRuns.runId, runId),
            inArray(nodeRuns.status, ["completed", "reused"]),
            isNotNull(nodeRuns.inputHash),
          ),
        )
        .orderBy(asc(nodeRuns.scheduledSeq), asc(nodeRuns.attempt)),
    );
    const out = new Map<
      string,
      {
        nodeRunId: string;
        output: JsonValue;
        firedPorts: PortName[];
        decision: DecisionResult | null;
      }
    >();
    // Later attempts win: the map keeps the last completed attempt for each key.
    for (const row of rows) {
      out.set(recordedKey(row.nodeId, row.scope, row.inputHash ?? ""), {
        nodeRunId: row.reusedFromNodeRunId ?? row.id,
        output: row.output ?? null,
        firedPorts: row.firedPorts,
        decision: row.decision ?? null,
      });
    }
    return out;
  }

  async saveCheckpoint(runId: string, seq: number, state: JsonValue): Promise<void> {
    await this.tx((tx) =>
      tx
        .insert(runCheckpoints)
        .values({ runId, seq, state: state as JsonObject })
        .onConflictDoUpdate({
          target: [runCheckpoints.runId, runCheckpoints.seq],
          set: { state: state as JsonObject },
        }),
    );
  }

  async latestCheckpoint(
    runId: string,
    maxSeq: number,
  ): Promise<{ seq: number; state: JsonValue } | null> {
    const [row] = await this.tx((tx) =>
      tx
        .select({ seq: runCheckpoints.seq, state: runCheckpoints.state })
        .from(runCheckpoints)
        .where(and(eq(runCheckpoints.runId, runId), lte(runCheckpoints.seq, maxSeq)))
        .orderBy(desc(runCheckpoints.seq))
        .limit(1),
    );
    return row ? { seq: row.seq, state: row.state } : null;
  }

  async acquireLease(runId: string, workerId: string, ttlMs: number): Promise<LeaseInfo | null> {
    const [row] = await this.tx((tx) =>
      tx
        .update(runs)
        .set({ leaseOwner: workerId, leaseUntil: sql`now() + ${ttlMs} * interval '1 millisecond'` })
        .where(
          and(
            eq(runs.id, runId),
            notInArray(runs.status, [...TERMINAL]),
            or(
              isNull(runs.leaseOwner),
              eq(runs.leaseOwner, workerId),
              lt(runs.leaseUntil, sql`now()`),
            ),
          ),
        )
        .returning({ leaseUntil: runs.leaseUntil, lastSeq: runs.lastSeq }),
    );
    if (!row?.leaseUntil) return null;
    return { runId, workerId, leaseUntil: row.leaseUntil.toISOString(), lastSeq: row.lastSeq };
  }

  async renewLease(runId: string, workerId: string, ttlMs: number): Promise<boolean> {
    const rows = await this.tx((tx) =>
      tx
        .update(runs)
        .set({ leaseUntil: sql`now() + ${ttlMs} * interval '1 millisecond'` })
        .where(and(eq(runs.id, runId), eq(runs.leaseOwner, workerId)))
        .returning({ id: runs.id }),
    );
    return rows.length > 0;
  }

  async releaseLease(runId: string, workerId: string): Promise<void> {
    await this.tx((tx) =>
      tx
        .update(runs)
        .set({ leaseOwner: null, leaseUntil: null })
        .where(and(eq(runs.id, runId), eq(runs.leaseOwner, workerId))),
    );
  }

  async expiredLeases(now: Date, limit: number): Promise<LeaseInfo[]> {
    const rows = await this.tx((tx) =>
      tx
        .select({
          id: runs.id,
          owner: runs.leaseOwner,
          until: runs.leaseUntil,
          lastSeq: runs.lastSeq,
        })
        .from(runs)
        .where(and(isNotNull(runs.leaseOwner), lt(runs.leaseUntil, now)))
        .orderBy(asc(runs.leaseUntil))
        .limit(limit),
    );
    return rows.map((r) => ({
      runId: r.id,
      workerId: r.owner ?? "",
      leaseUntil: (r.until ?? now).toISOString(),
      lastSeq: r.lastSeq,
    }));
  }

  async dueTimers(now: Date, limit: number): Promise<RunTimer[]> {
    const rows = await this.tx((tx) =>
      tx
        .select()
        .from(runTimers)
        .where(
          and(isNull(runTimers.firedAt), isNull(runTimers.cancelledAt), lte(runTimers.fireAt, now)),
        )
        .orderBy(asc(runTimers.fireAt))
        .limit(limit),
    );
    return rows.map(toRunTimer);
  }

  async markTimerFired(timerId: string): Promise<boolean> {
    const rows = await this.tx((tx) =>
      tx
        .update(runTimers)
        .set({ firedAt: sql`now()` })
        .where(
          and(eq(runTimers.id, timerId), isNull(runTimers.firedAt), isNull(runTimers.cancelledAt)),
        )
        .returning({ id: runTimers.id }),
    );
    return rows.length > 0;
  }

  /** Cancels a pending timer (a node finished before its timeout). */
  async cancelTimer(timerId: string): Promise<boolean> {
    const rows = await this.tx((tx) =>
      tx
        .update(runTimers)
        .set({ cancelledAt: sql`now()` })
        .where(
          and(eq(runTimers.id, timerId), isNull(runTimers.firedAt), isNull(runTimers.cancelledAt)),
        )
        .returning({ id: runTimers.id }),
    );
    return rows.length > 0;
  }

  /** Records a cancel request (the API); the worker picks it up through `cancelRequest`. */
  async requestCancel(runId: string, by: string, reason: string | null): Promise<boolean> {
    const rows = await this.tx((tx) =>
      tx
        .update(runs)
        .set({ cancelRequestedAt: sql`now()`, cancelRequestedBy: by, cancelReason: reason })
        .where(
          and(
            eq(runs.id, runId),
            isNull(runs.cancelRequestedAt),
            notInArray(runs.status, [...TERMINAL]),
          ),
        )
        .returning({ id: runs.id }),
    );
    return rows.length > 0;
  }

  async cancelRequest(
    runId: string,
  ): Promise<{ by: string; reason: string | null; at: string } | null> {
    const [row] = await this.tx((tx) =>
      tx
        .select({
          at: runs.cancelRequestedAt,
          by: runs.cancelRequestedBy,
          reason: runs.cancelReason,
        })
        .from(runs)
        .where(eq(runs.id, runId)),
    );
    if (!row?.at) return null;
    return { by: row.by ?? "", reason: row.reason, at: row.at.toISOString() };
  }

  async getHumanTask(id: string): Promise<HumanTask | null> {
    const [row] = await this.tx((tx) => tx.select().from(humanTasks).where(eq(humanTasks.id, id)));
    return row ? toHumanTask(row) : null;
  }

  async respondHumanTask(id: string, response: HumanResponse, by: string): Promise<boolean> {
    const rows = await this.tx((tx) =>
      tx
        .update(humanTasks)
        .set({ status: "responded", response, respondedBy: by, respondedAt: sql`now()` })
        .where(and(eq(humanTasks.id, id), eq(humanTasks.status, "open")))
        .returning({ id: humanTasks.id }),
    );
    return rows.length > 0;
  }
}

/** The `run_events` row of an event. */
export function eventRow(event: DurableRunEvent): typeof runEvents.$inferInsert {
  const node = "nodeRunId" in event && "nodeId" in event ? event : null;
  return {
    runId: event.runId,
    seq: event.seq,
    type: event.type,
    nodeRunId: node?.nodeRunId ?? null,
    nodeId: node?.nodeId ?? null,
    scope: node && "scope" in node ? node.scope : null,
    payload: event as unknown as JsonObject,
    at: new Date(event.at),
  };
}

async function notify(tx: Tx, runId: string, fromSeq: number, toSeq: number): Promise<void> {
  await tx.execute(
    sql`select pg_notify(${RUN_EVENTS_CHANNEL}, ${JSON.stringify({ runId, fromSeq, toSeq })})`,
  );
}
