/**
 * The Orchestrator (ARCHITECTURE.md §5.4, §5.6, §5.8): drives runs through `step()` on real
 * stores. `handle(runId, trigger)`:
 *
 * 1. serialises triggers per run (an async mutex; across workers the lease serialises);
 * 2. takes the lease if this worker does not hold it (`RUN_LEASE_TAKEN` when it takes over) and
 *    recovers the state from the latest checkpoint plus the log after it; node runs that were
 *    running under a lost worker are reported with a `recovered` trigger first;
 * 3. runs `step()`, then appends its events in one fenced transaction — `WorkerLostError` means
 *    another worker owns the run, so this one drops it and aborts its executions;
 * 4. publishes `{ runId, fromSeq, toSeq }`, checkpoints every 200 events and before the lease is
 *    released, then performs the effects (executions are tracked; an execution finishing calls
 *    `handle` with its result).
 *
 * `startMaintenance()` fires due timers (compare-and-set, so a timer fires once however many
 * workers poll), renews leases, takes over expired ones and picks up cancel requests.
 */
import {
  CancelledError,
  WorkerLostError,
  type DurableRunEvent,
  type EventBus,
  type ExecutionPlan,
  type JsonValue,
  type QueueDriver,
  type Run,
  type RunStore,
  type WorkerPool,
} from "@flowaid/workflow-core";
import { uuidv7 } from "@flowaid/shared";
import {
  executeTask,
  type ExecutionCall,
  type NodeRegistry,
  type NodeServices,
} from "./executor.js";
import { reduce, reduceAll } from "./reduce.js";
import { initialState, nodeState, type SchedulerState } from "./state.js";
import {
  idempotencyKeyOf,
  step,
  type Effect,
  type IdSource,
  type StepContext,
  type Trigger,
} from "./step.js";

export const LEASE_TTL_MS = 30_000;
export const CHECKPOINT_EVERY = 200;
const TERMINAL = new Set(["completed", "failed", "cancelled", "timed_out"]);

export type HandleResult = "ok" | "busy" | "lost" | "terminal" | "missing";

export interface OrchestratorOptions {
  store: RunStore & { cancelTimer?(timerId: string): Promise<boolean> };
  queue: QueueDriver;
  bus?: EventBus;
  registry: NodeRegistry;
  services?: NodeServices;
  workerId?: string;
  pool?: WorkerPool;
  /** The compiled plan of a run's version. */
  loadPlan: (run: Run) => Promise<ExecutionPlan>;
  /** Per-run step context: variables, recorded outputs, subflow resolution, depth, run metadata. */
  context?: (run: Run) => Promise<Partial<Omit<StepContext, "ids" | "now" | "workerId">>>;
  /** Write-time redaction of an event before it is persisted (the in-memory state keeps raw values). */
  redact?: (event: DurableRunEvent, plan: ExecutionPlan) => DurableRunEvent;
  /** Creates and starts a child run (subflow). */
  onChildRun?: (
    effect: Extract<Effect, { type: "enqueue_child_run" }>,
    parent: Run,
  ) => Promise<void>;
  onCancelChild?: (childRunId: string) => Promise<void>;
  /** Ephemeral GENERATION_DELTA fan-out. */
  onDelta?: (runId: string, nodeRunId: string, channel: string, delta: string) => void;
  onError?: (error: unknown, context: { runId?: string; phase: string }) => void;
  now?: () => Date;
  ids?: IdSource;
  leaseTtlMs?: number;
  checkpointEvery?: number;
}

interface Held {
  run: Run;
  plan: ExecutionPlan;
  state: SchedulerState;
  ctx: Partial<Omit<StepContext, "ids" | "now" | "workerId">>;
  checkpointSeq: number;
}

const randomIds: IdSource = { uuid: () => uuidv7(), random: () => Math.random() };

export class Orchestrator {
  readonly workerId: string;
  private readonly held = new Map<string, Held>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly active = new Map<
    string,
    { runId: string; controller: AbortController; done: Promise<void> }
  >();
  private readonly idle = new Map<string, Set<() => void>>();
  private maintenance: ReturnType<typeof setInterval>[] = [];

  constructor(private readonly o: OrchestratorOptions) {
    this.workerId = o.workerId ?? `worker-${uuidv7().slice(-12)}`;
  }

  private now(): Date {
    return this.o.now?.() ?? new Date();
  }

  private error(error: unknown, phase: string, runId?: string): void {
    this.o.onError?.(error, { phase, ...(runId ? { runId } : {}) });
  }

  /** Runs `fn` after every earlier trigger of the same run. */
  private serial<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(runId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.locks.set(runId, tail);
    void tail.then(() => {
      if (this.locks.get(runId) === tail) this.locks.delete(runId);
    });
    return next;
  }

  handle(runId: string, trigger: Trigger): Promise<HandleResult> {
    return this.serial(runId, () => this.handleNow(runId, trigger));
  }

  /** Loads the run's state from its checkpoint and log. */
  private async recover(
    run: Run,
    plan: ExecutionPlan,
  ): Promise<{ state: SchedulerState; checkpointSeq: number }> {
    const cp = await this.o.store.latestCheckpoint(run.id, run.lastSeq);
    let state = cp
      ? (cp.state as unknown as SchedulerState)
      : initialState(plan, run.id, run.input);
    let after = cp?.seq ?? 0;
    for (;;) {
      const page = await this.o.store.listEvents(run.id, after, 1000);
      if (page.length === 0) break;
      state = reduceAll(plan, state, page);
      after = page[page.length - 1]?.seq ?? after;
      if (page.length < 1000) break;
    }
    return { state, checkpointSeq: cp?.seq ?? 0 };
  }

  private async take(
    runId: string,
    reason: "resume" | "expired" | "control",
  ): Promise<Held | "busy" | "missing" | "terminal"> {
    const cached = this.held.get(runId);
    if (cached) return cached;
    const run = await this.o.store.getRun(runId);
    if (!run) return "missing";
    if (TERMINAL.has(run.status)) return "terminal";
    const lease = await this.o.store.acquireLease(
      runId,
      this.workerId,
      this.o.leaseTtlMs ?? LEASE_TTL_MS,
    );
    if (!lease) return "busy";
    const plan = await this.o.loadPlan(run);
    const { state, checkpointSeq } = await this.recover({ ...run, lastSeq: lease.lastSeq }, plan);
    const ctx = (await this.o.context?.(run)) ?? {};
    const held: Held = { run, plan, state, ctx, checkpointSeq };
    this.held.set(runId, held);
    if (run.status !== "queued") {
      // Someone (maybe an earlier incarnation of this worker) ran it before.
      await this.appendRaw(held, [
        {
          type: "RUN_LEASE_TAKEN",
          workerId: this.workerId,
          previousWorkerId: null,
          reason,
        } as never,
      ]);
    }
    return held;
  }

  private async appendRaw(
    held: Held,
    events: Omit<DurableRunEvent, "seq" | "runId" | "at">[],
  ): Promise<void> {
    const at = this.now().toISOString();
    const expectedSeq = held.state.run.lastSeq;
    const full = events.map(
      (e, i) => ({ ...e, runId: held.run.id, seq: expectedSeq + 1 + i, at }) as DurableRunEvent,
    );
    await this.o.store.appendEvents(
      held.run.id,
      full.map((e) => this.strip(this.o.redact ? this.o.redact(e, held.plan) : e)),
      {
        leaseOwner: this.workerId,
        expectedSeq,
      },
    );
    for (const e of full) held.state = reduce(held.plan, held.state, e);
  }

  private strip(e: DurableRunEvent): Omit<DurableRunEvent, "seq" | "runId" | "at"> {
    const { seq: _s, runId: _r, at: _a, ...rest } = e;
    return rest;
  }

  private drop(runId: string, abort: boolean): void {
    this.held.delete(runId);
    if (!abort) return;
    for (const [id, a] of this.active) {
      if (a.runId !== runId) continue;
      a.controller.abort(new WorkerLostError("This worker lost the run's lease"));
      this.active.delete(id);
    }
  }

  private async handleNow(runId: string, trigger: Trigger): Promise<HandleResult> {
    const taken = await this.take(runId, trigger.type === "cancel" ? "control" : "resume");
    if (typeof taken === "string") return taken;
    const held = taken;
    try {
      // Node runs that were running under a lost worker come first.
      const lost = Object.entries(held.state.nodeRuns)
        .filter(
          ([id, at]) =>
            nodeState(held.state, at.scope, at.nodeId).status === "running" &&
            nodeState(held.state, at.scope, at.nodeId).nodeRunId === id,
        )
        .map(([id]) => id)
        .filter(
          (id) =>
            !this.active.has(id) && !(trigger.type === "node_result" && trigger.nodeRunId === id),
        );
      if (lost.length > 0 && held.state.run.status !== "queued")
        await this.runStep(held, { type: "recovered", lostNodeRunIds: lost });
      if (!this.held.has(runId)) return "ok";
      await this.runStep(held, trigger);
      // Responses recorded by the API (compare-and-set on human_tasks) while no worker held the run.
      if (this.held.has(runId) && trigger.type !== "human_response") {
        for (const [taskId, task] of Object.entries(held.state.humanTasks)) {
          if (task.status !== "open") continue;
          const row = await this.o.store.getHumanTask(taskId);
          if (row?.status === "responded" && row.response)
            await this.runStep(held, {
              type: "human_response",
              humanTaskId: taskId,
              response: row.response,
              by: row.respondedBy ?? "unknown",
            });
          if (!this.held.has(runId)) break;
        }
      }
      return "ok";
    } catch (error) {
      if (error instanceof WorkerLostError) {
        this.drop(runId, true);
        return "lost";
      }
      this.drop(runId, false);
      throw error;
    }
  }

  private async runStep(held: Held, trigger: Trigger): Promise<void> {
    const runId = held.run.id;
    const before = held.state.run.lastSeq;
    const result = step(held.plan, held.state, trigger, {
      ...held.ctx,
      ids: this.o.ids ?? randomIds,
      now: this.now().toISOString(),
      workerId: this.workerId,
      pool: this.o.pool ?? "general",
    });
    if (result.events.length > 0) {
      await this.o.store.appendEvents(
        runId,
        result.events.map((e) => this.strip(this.o.redact ? this.o.redact(e, held.plan) : e)),
        { leaseOwner: this.workerId, expectedSeq: before },
      );
    }
    held.state = result.state;
    const lastSeq = held.state.run.lastSeq;
    if (result.events.length > 0) {
      await this.o.bus
        ?.publish(`run:${runId}`, { runId, fromSeq: before + 1, toSeq: lastSeq })
        .catch((e: unknown) => this.error(e, "publish", runId));
    }
    const terminal = TERMINAL.has(held.state.run.status);
    const releasing = result.effects.some((e) => e.type === "release_lease");
    if (
      lastSeq - held.checkpointSeq >= (this.o.checkpointEvery ?? CHECKPOINT_EVERY) ||
      ((releasing || terminal) && lastSeq > held.checkpointSeq)
    ) {
      await this.o.store.saveCheckpoint(runId, lastSeq, held.state as unknown as JsonValue);
      held.checkpointSeq = lastSeq;
    }
    for (const effect of result.effects) await this.perform(held, effect);
    if (terminal) {
      this.drop(runId, false);
      this.notifyIdle(runId);
    } else if (releasing && !this.hasActive(runId)) {
      await this.o.store.releaseLease(runId, this.workerId);
      this.drop(runId, false);
      this.notifyIdle(runId);
    }
  }

  private hasActive(runId: string): boolean {
    for (const a of this.active.values()) if (a.runId === runId) return true;
    return false;
  }

  private async perform(held: Held, effect: Effect): Promise<void> {
    const runId = held.run.id;
    switch (effect.type) {
      case "execute":
        this.startExecution(held, effect);
        return;
      case "execute_batch":
        return;
      case "delegate":
        await this.o.queue.enqueue(
          `run:${effect.pool}`,
          { type: "node.exec", runId, nodeRunId: effect.nodeRunId, pool: effect.pool },
          { jobId: effect.jobId },
        );
        return;
      case "set_timer":
        await this.o.queue.scheduleTimer(effect.timer);
        return;
      case "cancel_timer":
        await this.o.store.cancelTimer?.(effect.timerId);
        await this.o.queue.cancelTimer(effect.timerId);
        return;
      case "create_human_task":
        return; // the human_tasks row is a projection of HUMAN_APPROVAL_REQUESTED
      case "enqueue_child_run":
        await this.o.onChildRun?.(effect, held.run);
        return;
      case "cancel_child_run":
        await this.o.onCancelChild?.(effect.childRunId);
        return;
      case "abort_node": {
        const a = this.active.get(effect.nodeRunId);
        a?.controller.abort(new CancelledError(`Node run aborted: ${effect.reason}`));
        this.active.delete(effect.nodeRunId);
        return;
      }
      case "release_lease":
        return;
    }
  }

  private startExecution(held: Held, effect: Extract<Effect, { type: "execute" }>): void {
    if (this.active.has(effect.nodeRunId)) return;
    const node = held.plan.nodes[effect.nodeId];
    if (!node) return;
    const runId = held.run.id;
    const n = nodeState(held.state, effect.scope, effect.nodeId);
    const controller = new AbortController();
    const ex = held.plan.execution;
    const call: ExecutionCall = {
      runId,
      workspaceId: held.run.workspaceId,
      workflowId: held.run.workflowId,
      workflowVersionId: held.run.workflowVersionId,
      environmentId: held.run.environmentId,
      environment: typeof held.ctx.run?.environment === "string" ? held.ctx.run.environment : "",
      origin: held.run.origin,
      startedAt: held.state.run.startedAt ?? this.now().toISOString(),
      sessionId: held.run.sessionId,
      nodeRunId: effect.nodeRunId,
      node,
      scope: effect.scope,
      attempt: n.attempt,
      idempotencyKey:
        node.idempotency === "keyed" && n.inputHash
          ? idempotencyKeyOf(runId, effect.scope, node.id, n.inputHash)
          : null,
      vars: {
        ...Object.fromEntries(
          held.plan.variables
            .filter((v) => v.default !== undefined)
            .map((v) => [v.name, v.default as JsonValue]),
        ),
        ...held.ctx.vars,
      },
      iteration: held.state.scopes[effect.scope]?.iteration ?? {},
      signal: controller.signal,
      emit: () => undefined,
      ...(this.o.onDelta
        ? { onDelta: (channel, delta) => this.o.onDelta?.(runId, effect.nodeRunId, channel, delta) }
        : {}),
      budget: {
        remainingCostUsd:
          ex.maxCostUsd !== undefined ? Math.max(0, ex.maxCostUsd - held.state.run.costUsd) : null,
        remainingTokens:
          ex.maxTokens !== undefined
            ? Math.max(
                0,
                ex.maxTokens - held.state.run.usage.inputTokens - held.state.run.usage.outputTokens,
              )
            : null,
        deadlineAt: held.state.run.deadlineAt,
      },
    };
    const done = (async () => {
      const result = await executeTask(held.plan, this.o.registry, this.o.services ?? {}, {
        call,
        input: effect.input,
        config: effect.config,
        ...(effect.resume ? { resume: effect.resume } : {}),
      });
      if (controller.signal.aborted) return;
      this.active.delete(effect.nodeRunId);
      await this.handle(runId, { type: "node_result", nodeRunId: effect.nodeRunId, result });
    })().catch((error: unknown) => {
      this.active.delete(effect.nodeRunId);
      this.error(error, "execute", runId);
    });
    this.active.set(effect.nodeRunId, { runId, controller, done });
  }

  /* ─── maintenance ─── */

  /** Fires due timers once (compare-and-set). */
  async fireDueTimers(limit = 50): Promise<number> {
    const due = await this.o.store.dueTimers(this.now(), limit);
    let fired = 0;
    for (const timer of due) {
      if (!(await this.o.store.markTimerFired(timer.id))) continue;
      fired += 1;
      await this.handle(timer.runId, { type: "timer", timerId: timer.id }).catch((e: unknown) =>
        this.error(e, "timer", timer.runId),
      );
    }
    return fired;
  }

  /** Renews held leases; checks cancel requests. */
  async heartbeat(): Promise<void> {
    for (const runId of [...this.held.keys()]) {
      const ok = await this.o.store.renewLease(
        runId,
        this.workerId,
        this.o.leaseTtlMs ?? LEASE_TTL_MS,
      );
      if (!ok) {
        this.drop(runId, true);
        continue;
      }
      const cancel = await this.o.store.cancelRequest(runId);
      if (cancel && !this.held.get(runId)?.state.run.cancelRequested)
        await this.handle(runId, { type: "cancel", by: cancel.by, reason: cancel.reason }).catch(
          (e: unknown) => this.error(e, "cancel", runId),
        );
    }
  }

  /** Takes over runs whose worker died. */
  async reapExpiredLeases(limit = 10): Promise<number> {
    const expired = await this.o.store.expiredLeases(this.now(), limit);
    let taken = 0;
    for (const lease of expired) {
      if (this.held.has(lease.runId)) continue;
      const r = await this.handle(lease.runId, { type: "resume" }).catch((e: unknown) => {
        this.error(e, "reap", lease.runId);
        return "busy" as const;
      });
      if (r === "ok") taken += 1;
    }
    return taken;
  }

  startMaintenance(
    opts: { timerPollMs?: number; heartbeatMs?: number; reapMs?: number } = {},
  ): void {
    this.stopMaintenance();
    const every = (ms: number, fn: () => Promise<unknown>) => {
      let running = false;
      const t = setInterval(() => {
        if (running) return;
        running = true;
        void fn()
          .catch((e: unknown) => this.error(e, "maintenance"))
          .finally(() => {
            running = false;
          });
      }, ms);
      t.unref?.();
      this.maintenance.push(t);
    };
    every(opts.timerPollMs ?? 1000, () => this.fireDueTimers());
    every(opts.heartbeatMs ?? 10_000, () => this.heartbeat());
    every(opts.reapMs ?? 15_000, () => this.reapExpiredLeases());
  }

  stopMaintenance(): void {
    for (const t of this.maintenance) clearInterval(t);
    this.maintenance = [];
  }

  /** Resolves when the run is terminal or parked (waiting, lease released) with nothing executing. */
  whenIdle(runId: string): Promise<void> {
    if (!this.held.has(runId) && !this.hasActive(runId) && !this.locks.has(runId))
      return Promise.resolve();
    return new Promise((resolve) => {
      const set = this.idle.get(runId) ?? new Set();
      set.add(resolve);
      this.idle.set(runId, set);
    });
  }

  private notifyIdle(runId: string): void {
    const set = this.idle.get(runId);
    if (!set) return;
    this.idle.delete(runId);
    for (const fn of set) fn();
  }

  /** Aborts executions and stops maintenance (SIGTERM). Held leases expire and are reaped elsewhere. */
  async close(): Promise<void> {
    this.stopMaintenance();
    for (const a of this.active.values())
      a.controller.abort(new CancelledError("Worker shutting down"));
    await Promise.allSettled([...this.active.values()].map((a) => a.done));
    this.active.clear();
    this.held.clear();
  }
}
