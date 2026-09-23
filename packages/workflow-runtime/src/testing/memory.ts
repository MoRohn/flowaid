/**
 * In-memory RunStore, QueueDriver and EventBus with the semantics of the Postgres ones: fenced
 * dense appends, leases with expiry, compare-and-set timers and human tasks, projections folded
 * from the log. `runLocally()` runs on them; tests use them where a database would be overkill.
 */
import {
  RunEventSchema,
  WorkerLostError,
  type AppendOptions,
  type DecisionResult,
  type DurableRunEvent,
  type EventBus,
  type HumanResponse,
  type HumanTask,
  type Job,
  type JsonValue,
  type LeaseInfo,
  type NodeId,
  type NodeRun,
  type PortName,
  type QueueDriver,
  type QueueName,
  type Run,
  type RunEventOf,
  type RunEventType,
  type RunStore,
  type RunTimer,
  type ScopePath,
} from "@flowaid/workflow-core";
import { recordedKey } from "../step.js";

interface RunRecord {
  run: Run;
  events: DurableRunEvent[];
  leaseOwner: string | null;
  leaseUntil: number;
  checkpoints: Map<number, JsonValue>;
  cancel: { by: string; reason: string | null; at: string } | null;
}

const TERMINAL = new Set(["completed", "failed", "cancelled", "timed_out"]);

/** Node runs folded from a log (the same rules as the Postgres projections). */
export function projectNodeRuns(run: Run, events: readonly DurableRunEvent[]): NodeRun[] {
  const rows = new Map<string, NodeRun>();
  const scheduledAt = new Map<string, string>();
  for (const e of events) {
    if (!("nodeRunId" in e) || typeof e.nodeRunId !== "string" || !("attempt" in e)) continue;
    const row = rows.get(e.nodeRunId);
    switch (e.type) {
      case "NODE_SCHEDULED":
        scheduledAt.set(e.nodeRunId, e.at);
        rows.set(e.nodeRunId, {
          id: e.nodeRunId,
          runId: run.id,
          nodeId: e.nodeId,
          scope: e.scope,
          attempt: e.attempt,
          status: "pending",
          kind: e.kind,
          nodeType: e.nodeType,
          nodeName: e.nodeId,
          input: null,
          output: null,
          firedPorts: [],
          decision: null,
          error: null,
          usage: null,
          costUsd: 0,
          latencyMs: null,
          queueLatencyMs: null,
          idempotencyKey: e.idempotencyKey,
          inputHash: e.inputHash,
          reusedFromNodeRunId: e.reusedFromNodeRunId,
          pool: "general",
          scheduledSeq: e.seq,
          endedSeq: null,
          startedAt: null,
          endedAt: null,
        });
        break;
      case "NODE_STARTED":
        if (row) {
          row.status = "running";
          row.input = e.input;
          row.pool = e.pool;
          row.startedAt ??= e.at;
          const s = scheduledAt.get(e.nodeRunId);
          row.queueLatencyMs ??= s ? Math.max(0, Date.parse(e.at) - Date.parse(s)) : null;
        }
        break;
      case "NODE_COMPLETED":
        if (row)
          Object.assign(row, {
            status: e.reused ? "reused" : "completed",
            output: e.output,
            firedPorts: e.firedPorts,
            usage: e.usage,
            costUsd: e.costUsd,
            latencyMs: e.latencyMs,
            endedAt: e.at,
            endedSeq: e.seq,
          });
        break;
      case "NODE_FAILED":
        if (row) {
          row.error = e.error;
          row.firedPorts = e.firedPorts;
          row.latencyMs = e.latencyMs;
          if (e.terminal) Object.assign(row, { status: "failed", endedAt: e.at, endedSeq: e.seq });
        }
        break;
      case "NODE_RETRIED":
        if (row) row.status = "retry_wait";
        break;
      case "NODE_SKIPPED":
      case "NODE_CANCELLED":
        if (row)
          Object.assign(row, {
            status: e.type === "NODE_SKIPPED" ? "skipped" : "cancelled",
            endedAt: e.at,
            endedSeq: e.seq,
          });
        break;
      case "NODE_WAITING":
        if (row) row.status = "waiting";
        break;
      case "DECISION_COMPLETED":
        if (row) row.decision = e.decision;
        break;
      case "HUMAN_TASK_EXPIRED":
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
        break;
    }
  }
  return [...rows.values()].sort(
    (a, b) => a.scheduledSeq - b.scheduledSeq || a.attempt - b.attempt,
  );
}

export class MemoryRunStore implements RunStore {
  private readonly runs = new Map<string, RunRecord>();
  private readonly tasks = new Map<string, HumanTask>();
  private readonly timers = new Map<
    string,
    RunTimer & { firedAt: number | null; cancelledAt: number | null }
  >();
  /** Commit notifications (the Postgres store NOTIFYs `run_events`). */
  readonly onCommit = new Set<(n: { runId: string; fromSeq: number; toSeq: number }) => void>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  private rec(runId: string): RunRecord {
    const r = this.runs.get(runId);
    if (!r) throw new WorkerLostError(`Run ${runId} does not exist`);
    return r;
  }

  createRun(run: Run, created: RunEventOf<"RUN_CREATED">): Promise<void> {
    if (this.runs.has(run.id)) return Promise.reject(new Error(`Run ${run.id} exists`));
    const event = RunEventSchema.parse({ ...created, runId: run.id }) as DurableRunEvent;
    this.runs.set(run.id, {
      run: { ...run, lastSeq: event.seq },
      events: [event],
      leaseOwner: null,
      leaseUntil: 0,
      checkpoints: new Map(),
      cancel: null,
    });
    this.notify(run.id, event.seq, event.seq);
    return Promise.resolve();
  }

  getRun(runId: string): Promise<Run | null> {
    const r = this.runs.get(runId);
    return Promise.resolve(
      r ? { ...r.run, nodeRunCount: projectNodeRuns(r.run, r.events).length } : null,
    );
  }

  appendEvents(
    runId: string,
    events: readonly Omit<DurableRunEvent, "seq" | "runId" | "at">[],
    opts: AppendOptions,
  ): Promise<{ firstSeq: number; lastSeq: number }> {
    const r = this.runs.get(runId);
    if (!r || r.leaseOwner !== opts.leaseOwner || r.run.lastSeq !== opts.expectedSeq)
      return Promise.reject(
        new WorkerLostError(
          `Run ${runId} is not leased by ${opts.leaseOwner} at seq ${opts.expectedSeq}`,
        ),
      );
    const at = new Date(this.now()).toISOString();
    const full = events.map(
      (e, i) =>
        RunEventSchema.parse({ ...e, runId, seq: opts.expectedSeq + 1 + i, at }) as DurableRunEvent,
    );
    for (const e of full) this.apply(r, e);
    r.events.push(...full);
    const lastSeq = opts.expectedSeq + full.length;
    r.run = { ...r.run, lastSeq };
    if (full.length > 0) this.notify(runId, opts.expectedSeq + 1, lastSeq);
    return Promise.resolve({ firstSeq: opts.expectedSeq + 1, lastSeq });
  }

  private apply(r: RunRecord, e: DurableRunEvent): void {
    const run = r.run;
    switch (e.type) {
      case "RUN_STARTED":
        r.run = { ...run, status: "starting", startedAt: run.startedAt ?? e.at };
        this.timers.set(`deadline:${run.id}`, {
          id: `deadline:${run.id}`,
          runId: run.id,
          nodeRunId: null,
          purpose: "run_deadline",
          fireAt: e.deadlineAt,
          firedAt: null,
          cancelledAt: null,
        });
        break;
      case "NODE_SCHEDULED":
        if (run.status === "starting") r.run = { ...run, status: "running" };
        break;
      case "RUN_WAITING":
        r.run = { ...run, status: e.reason === "human" ? "waiting_for_human" : "waiting" };
        break;
      case "RUN_RESUMED":
        r.run = { ...run, status: "running" };
        break;
      case "RUN_COMPLETED":
        r.run = {
          ...run,
          status: "completed",
          output: e.output,
          outcome: e.outcome,
          usage: e.usage,
          costUsd: e.costUsd,
          endedAt: e.at,
        };
        break;
      case "RUN_FAILED":
      case "RUN_CANCELLED":
      case "RUN_TIMED_OUT":
        r.run = {
          ...run,
          status:
            e.type === "RUN_FAILED"
              ? "failed"
              : e.type === "RUN_CANCELLED"
                ? "cancelled"
                : "timed_out",
          ...(e.type === "RUN_FAILED" ? { error: e.error } : {}),
          usage: e.usage,
          costUsd: e.costUsd,
          endedAt: e.at,
        };
        for (const t of this.tasks.values())
          if (t.runId === run.id && t.status === "open")
            this.tasks.set(t.id, { ...t, status: "cancelled" });
        break;
      case "TIMER_SET":
        this.timers.set(e.timerId, {
          id: e.timerId,
          runId: run.id,
          nodeRunId: e.nodeRunId,
          purpose: e.purpose,
          fireAt: e.fireAt,
          firedAt: null,
          cancelledAt: null,
        });
        break;
      case "TIMER_FIRED": {
        const t = this.timers.get(e.timerId);
        if (t && t.firedAt === null) t.firedAt = Date.parse(e.at);
        break;
      }
      case "HUMAN_APPROVAL_REQUESTED":
        if (!this.tasks.has(e.humanTaskId))
          this.tasks.set(e.humanTaskId, {
            id: e.humanTaskId,
            workspaceId: run.workspaceId,
            runId: run.id,
            nodeRunId: e.nodeRunId,
            nodeId: e.nodeId,
            scope: e.scope,
            workflowId: run.workflowId,
            request: e.request,
            status: "open",
            response: null,
            respondedBy: null,
            respondedAt: null,
            expiresAt: e.request.expiresAt,
            createdAt: e.at,
          });
        break;
      case "HUMAN_APPROVAL_RECEIVED": {
        const t = this.tasks.get(e.humanTaskId);
        if (t?.status === "open" && e.response.action !== "escalate")
          this.tasks.set(t.id, {
            ...t,
            status: "responded",
            response: e.response,
            respondedBy: e.by,
            respondedAt: e.at,
          });
        break;
      }
      case "HUMAN_TASK_EXPIRED": {
        const t = this.tasks.get(e.humanTaskId);
        if (t?.status === "open" && e.action !== "escalate")
          this.tasks.set(t.id, { ...t, status: "expired" });
        break;
      }
      case "RUN_CREATED":
      case "RUN_LEASE_TAKEN":
      case "RUN_CANCEL_REQUESTED":
      case "RUN_OUTPUT":
      case "CHECKPOINT_CREATED":
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
      case "EVENT_RECEIVED":
      case "DECISION_REQUESTED":
      case "DECISION_COMPLETED":
      case "PROVIDER_FAILOVER":
      case "GENERATION_STARTED":
      case "GENERATION_COMPLETED":
      case "TOOL_CALLED":
      case "TOOL_RETURNED":
      case "HUMAN_TASK_ESCALATED":
      case "LOG":
      case "METRIC":
      case "ARTIFACT_CREATED":
      case "STATE_WRITTEN":
        break;
    }
    if (TERMINAL.has(r.run.status)) {
      r.leaseOwner = null;
      r.leaseUntil = 0;
    }
  }

  private notify(runId: string, fromSeq: number, toSeq: number) {
    for (const fn of this.onCommit) fn({ runId, fromSeq, toSeq });
  }

  listEvents(
    runId: string,
    afterSeq: number,
    limit: number,
    types?: readonly RunEventType[],
  ): Promise<DurableRunEvent[]> {
    const r = this.runs.get(runId);
    if (!r) return Promise.resolve([]);
    return Promise.resolve(
      r.events
        .filter((e) => e.seq > afterSeq && (!types?.length || types.includes(e.type)))
        .slice(0, limit),
    );
  }

  listNodeRuns(runId: string): Promise<NodeRun[]> {
    const r = this.runs.get(runId);
    return Promise.resolve(r ? projectNodeRuns(r.run, r.events) : []);
  }

  async getNodeOutput(
    runId: string,
    scope: ScopePath,
    nodeId: NodeId,
  ): Promise<{ output: JsonValue; nodeRunId: string; attempt: number } | null> {
    const rows = (await this.listNodeRuns(runId)).filter(
      (n) =>
        n.scope === scope &&
        n.nodeId === nodeId &&
        (n.status === "completed" || n.status === "reused"),
    );
    const last = rows.at(-1);
    return last ? { output: last.output, nodeRunId: last.id, attempt: last.attempt } : null;
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
    const out = new Map<
      string,
      {
        nodeRunId: string;
        output: JsonValue;
        firedPorts: PortName[];
        decision: DecisionResult | null;
      }
    >();
    for (const n of await this.listNodeRuns(runId)) {
      if ((n.status === "completed" || n.status === "reused") && n.inputHash)
        out.set(recordedKey(n.nodeId, n.scope, n.inputHash), {
          nodeRunId: n.reusedFromNodeRunId ?? n.id,
          output: n.output,
          firedPorts: n.firedPorts,
          decision: n.decision,
        });
    }
    return out;
  }

  saveCheckpoint(runId: string, seq: number, state: JsonValue): Promise<void> {
    this.rec(runId).checkpoints.set(seq, state);
    return Promise.resolve();
  }

  latestCheckpoint(
    runId: string,
    maxSeq: number,
  ): Promise<{ seq: number; state: JsonValue } | null> {
    const r = this.runs.get(runId);
    if (!r) return Promise.resolve(null);
    const seq = Math.max(-1, ...[...r.checkpoints.keys()].filter((s) => s <= maxSeq));
    return Promise.resolve(seq < 0 ? null : { seq, state: r.checkpoints.get(seq) ?? null });
  }

  acquireLease(runId: string, workerId: string, ttlMs: number): Promise<LeaseInfo | null> {
    const r = this.runs.get(runId);
    if (!r || TERMINAL.has(r.run.status)) return Promise.resolve(null);
    if (r.leaseOwner && r.leaseOwner !== workerId && r.leaseUntil > this.now())
      return Promise.resolve(null);
    r.leaseOwner = workerId;
    r.leaseUntil = this.now() + ttlMs;
    return Promise.resolve({
      runId,
      workerId,
      leaseUntil: new Date(r.leaseUntil).toISOString(),
      lastSeq: r.run.lastSeq,
    });
  }

  renewLease(runId: string, workerId: string, ttlMs: number): Promise<boolean> {
    const r = this.runs.get(runId);
    if (!r || r.leaseOwner !== workerId) return Promise.resolve(false);
    r.leaseUntil = this.now() + ttlMs;
    return Promise.resolve(true);
  }

  releaseLease(runId: string, workerId: string): Promise<void> {
    const r = this.runs.get(runId);
    if (r?.leaseOwner === workerId) {
      r.leaseOwner = null;
      r.leaseUntil = 0;
    }
    return Promise.resolve();
  }

  expiredLeases(now: Date, limit: number): Promise<LeaseInfo[]> {
    const out: LeaseInfo[] = [];
    for (const r of this.runs.values()) {
      if (r.leaseOwner && r.leaseUntil < now.getTime())
        out.push({
          runId: r.run.id,
          workerId: r.leaseOwner,
          leaseUntil: new Date(r.leaseUntil).toISOString(),
          lastSeq: r.run.lastSeq,
        });
    }
    return Promise.resolve(out.slice(0, limit));
  }

  dueTimers(now: Date, limit: number): Promise<RunTimer[]> {
    const due = [...this.timers.values()]
      .filter(
        (t) =>
          t.firedAt === null && t.cancelledAt === null && Date.parse(t.fireAt) <= now.getTime(),
      )
      .sort((a, b) => Date.parse(a.fireAt) - Date.parse(b.fireAt))
      .slice(0, limit);
    return Promise.resolve(
      due.map(({ id, runId, nodeRunId, purpose, fireAt }) => ({
        id,
        runId,
        nodeRunId,
        purpose,
        fireAt,
      })),
    );
  }

  markTimerFired(timerId: string): Promise<boolean> {
    const t = this.timers.get(timerId);
    if (!t || t.firedAt !== null || t.cancelledAt !== null) return Promise.resolve(false);
    t.firedAt = this.now();
    return Promise.resolve(true);
  }

  cancelTimer(timerId: string): Promise<boolean> {
    const t = this.timers.get(timerId);
    if (!t || t.firedAt !== null || t.cancelledAt !== null) return Promise.resolve(false);
    t.cancelledAt = this.now();
    return Promise.resolve(true);
  }

  requestCancel(runId: string, by: string, reason: string | null): Promise<boolean> {
    const r = this.runs.get(runId);
    if (!r || r.cancel || TERMINAL.has(r.run.status)) return Promise.resolve(false);
    r.cancel = { by, reason, at: new Date(this.now()).toISOString() };
    return Promise.resolve(true);
  }

  cancelRequest(runId: string): Promise<{ by: string; reason: string | null; at: string } | null> {
    return Promise.resolve(this.runs.get(runId)?.cancel ?? null);
  }

  getHumanTask(id: string): Promise<HumanTask | null> {
    return Promise.resolve(this.tasks.get(id) ?? null);
  }

  respondHumanTask(id: string, response: HumanResponse, by: string): Promise<boolean> {
    const t = this.tasks.get(id);
    if (!t || t.status !== "open") return Promise.resolve(false);
    this.tasks.set(id, {
      ...t,
      status: "responded",
      response,
      respondedBy: by,
      respondedAt: new Date(this.now()).toISOString(),
    });
    return Promise.resolve(true);
  }

  /** Human tasks of a run (tests and runLocally). */
  humanTasksOf(runId: string): HumanTask[] {
    return [...this.tasks.values()].filter((t) => t.runId === runId);
  }
}

type Handler = (job: Job) => Promise<void>;

/** Queue in memory: delays with setTimeout, job-id dedupe while pending, at-least-once delivery. */
export class MemoryQueueDriver implements QueueDriver {
  private readonly handlers = new Map<
    string,
    { handler: Handler; active: number; concurrency: number }
  >();
  private readonly waiting = new Map<
    string,
    Array<{ id: string; job: Job; runAt: number; priority: number }>
  >();
  private readonly pendingIds = new Set<string>();
  private readonly timeouts = new Set<ReturnType<typeof setTimeout>>();
  private seq = 0;
  private closed = false;
  readonly failures: Array<{ job: Job; error: unknown }> = [];

  enqueue(
    queue: QueueName,
    job: Job,
    opts: { delayMs?: number; jobId?: string; priority?: number } = {},
  ): Promise<void> {
    if (this.closed) return Promise.resolve();
    const id = opts.jobId ?? `job-${(this.seq += 1)}`;
    if (this.pendingIds.has(id)) return Promise.resolve();
    this.pendingIds.add(id);
    const list = this.waiting.get(queue) ?? [];
    list.push({ id, job, runAt: Date.now() + (opts.delayMs ?? 0), priority: opts.priority ?? 0 });
    this.waiting.set(queue, list);
    if (opts.delayMs) this.wake(queue, opts.delayMs);
    queueMicrotask(() => this.pump(queue));
    return Promise.resolve();
  }

  private pump(queue: QueueName): void {
    const consumer = this.handlers.get(queue);
    const list = this.waiting.get(queue);
    if (!consumer || !list || this.closed) return;
    while (consumer.active < consumer.concurrency) {
      const now = Date.now();
      list.sort((a, b) => a.priority - b.priority || a.runAt - b.runAt);
      const index = list.findIndex((j) => j.runAt <= now);
      if (index < 0) {
        // Nothing is due yet. Timers can fire a little before Date.now() reaches runAt, so
        // always re-arm for the earliest waiting job instead of relying on the enqueue timer.
        this.wake(queue, Math.min(...list.map((j) => j.runAt)) - now);
        return;
      }
      const [next] = list.splice(index, 1);
      if (!next) return;
      this.pendingIds.delete(next.id);
      consumer.active += 1;
      void consumer
        .handler(next.job)
        .catch((error: unknown) => this.failures.push({ job: next.job, error }))
        .finally(() => {
          consumer.active -= 1;
          this.pump(queue);
        });
    }
  }

  /** Pumps `queue` again after `ms` (at least 1 ms). */
  private wake(queue: QueueName, ms: number): void {
    if (this.closed) return;
    const t = setTimeout(
      () => {
        this.timeouts.delete(t);
        this.pump(queue);
      },
      Math.max(1, Math.ceil(ms)),
    );
    this.timeouts.add(t);
  }

  consume(
    queue: QueueName,
    handler: Handler,
    opts: { concurrency: number },
  ): Promise<{ stop(): Promise<void> }> {
    this.handlers.set(queue, { handler, active: 0, concurrency: Math.max(1, opts.concurrency) });
    queueMicrotask(() => this.pump(queue));
    return Promise.resolve({
      stop: () => {
        this.handlers.delete(queue);
        return Promise.resolve();
      },
    });
  }

  scheduleTimer(_timer: RunTimer): Promise<void> {
    return Promise.resolve();
  }

  cancelTimer(_timerId: string): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    for (const t of this.timeouts) clearTimeout(t);
    this.handlers.clear();
    return Promise.resolve();
  }
}

/** Pub/sub in memory. */
export class MemoryEventBus implements EventBus {
  private readonly subscribers = new Map<string, Set<(message: JsonValue) => void>>();

  publish(channel: string, message: JsonValue): Promise<void> {
    for (const fn of this.subscribers.get(channel) ?? []) fn(message);
    return Promise.resolve();
  }

  subscribe(
    channel: string,
    onMessage: (message: JsonValue) => void,
  ): Promise<() => Promise<void>> {
    const set = this.subscribers.get(channel) ?? new Set();
    set.add(onMessage);
    this.subscribers.set(channel, set);
    return Promise.resolve(() => {
      set.delete(onMessage);
      return Promise.resolve();
    });
  }
}
