/**
 * `step(plan, state, trigger, ctx)` (ARCHITECTURE.md §5.4): the pure scheduler. It turns one
 * trigger (start, a node result, a timer, a human response, …) into the events to append and
 * the effects to perform after the append commits. Every emitted event is reduced immediately,
 * so later decisions in the same step see it; the loop runs until nothing more can happen
 * without the outside world.
 */
import { sha256Hex, stableStringify } from "@flowaid/shared";
import {
  BoundsExceededError,
  HumanTaskExpiredError,
  NoOutputError,
  NonIdempotentInterruptedError,
  SchemaValidationError,
  SubflowError,
  TimeoutError,
  WorkerLostError,
  evaluateExpression,
  projectValue,
  toFlowaidError,
  type DecisionResult,
  type DurableRunEvent,
  type ErrorInfo,
  type EvalScope,
  type ExecutionPlan,
  type HumanDecision,
  type HumanRequest,
  type HumanResponse,
  type JsonObject,
  type JsonValue,
  type NodeId,
  type PlanNode,
  type PortName,
  type RunEventOf,
  type RunStatus,
  type ScopePath,
  type TimerPurpose,
  type TokenUsage,
  type WaitReason,
  type WorkerPool,
} from "@flowaid/workflow-core";
import {
  evalScope,
  evaluateBinding,
  evaluateRecord,
  setPointer,
  type RunMeta,
} from "./bindings.js";
import { reduce } from "./reduce.js";
import { ready, scopeDrained, scopeFailure, verdict } from "./ready.js";
import {
  ACTIVE,
  childScopePath,
  nodeKey,
  nodeState,
  totalTokens,
  type SchedulerState,
} from "./state.js";

/* ───────────────────────────── public types ───────────────────────────── */

/** Events a node execution may produce besides its result (address added by `step`). */
type Emittable =
  | "DECISION_REQUESTED"
  | "DECISION_COMPLETED"
  | "PROVIDER_FAILOVER"
  | "GENERATION_STARTED"
  | "GENERATION_COMPLETED"
  | "TOOL_CALLED"
  | "TOOL_RETURNED"
  | "LOG"
  | "METRIC"
  | "ARTIFACT_CREATED"
  | "STATE_WRITTEN";
type Addr = "runId" | "seq" | "at" | "nodeRunId" | "nodeId" | "scope" | "attempt";
export type NodeEmitted = { [T in Emittable]: Omit<RunEventOf<T>, Addr> }[Emittable];

export type SuspendWait =
  | { kind: "human"; request: Omit<HumanRequest, "origin"> }
  | { kind: "event"; eventName: string; timeoutMs?: number };

/** What an executor reports for one node run. */
export type ExecutorOutcome =
  | {
      kind: "ok";
      output: JsonObject;
      route?: PortName;
      usage?: TokenUsage;
      costUsd?: number;
      decision?: DecisionResult;
      latencyMs: number;
      events?: NodeEmitted[];
    }
  | {
      kind: "suspend";
      wait: SuspendWait;
      state: JsonValue;
      latencyMs: number;
      events?: NodeEmitted[];
    }
  | { kind: "error"; error: ErrorInfo; latencyMs: number; events?: NodeEmitted[] };

export type Trigger =
  | { type: "start" }
  | { type: "resume" }
  | { type: "node_result"; nodeRunId: string; result: ExecutorOutcome }
  | { type: "batch_result"; batchId: string; results: Record<string, ExecutorOutcome> }
  | { type: "timer"; timerId: string }
  | { type: "human_response"; humanTaskId: string; response: HumanResponse; by: string }
  | { type: "event"; eventName: string; payload: JsonValue }
  | {
      type: "subflow_completed";
      childRunId: string;
      status: RunStatus;
      output: JsonValue | null;
      error: ErrorInfo | null;
    }
  | { type: "delegated_result"; nodeRunId: string; result: ExecutorOutcome }
  | { type: "cancel"; by: string; reason: string | null }
  | { type: "recovered"; lostNodeRunIds: string[] };

export type ResumeInfo =
  | { kind: "human"; state: JsonValue; response: HumanResponse; by: string; humanTaskId: string }
  | { kind: "event"; state: JsonValue; payload: JsonValue }
  | { kind: "timeout"; state: JsonValue };

export interface TimerSpec {
  id: string;
  runId: string;
  nodeRunId: string | null;
  purpose: TimerPurpose;
  fireAt: string;
}

export type Effect =
  | {
      type: "execute";
      scope: ScopePath;
      nodeId: NodeId;
      nodeRunId: string;
      input: JsonObject;
      config: JsonObject;
      resume?: ResumeInfo;
    }
  | { type: "execute_batch"; batchId: string; nodeRunIds: string[] }
  | { type: "delegate"; pool: WorkerPool; nodeRunId: string; jobId: string }
  | { type: "set_timer"; timer: TimerSpec }
  | { type: "cancel_timer"; timerId: string }
  | { type: "create_human_task"; humanTaskId: string; nodeRunId: string; request: HumanRequest }
  | {
      type: "enqueue_child_run";
      childRunId: string;
      workflowId: string;
      versionId: string;
      input: JsonValue;
      parentNodeRunId: string;
      depth: number;
    }
  | { type: "cancel_child_run"; childRunId: string }
  | {
      type: "abort_node";
      nodeRunId: string;
      reason: "run_cancelled" | "race_lost" | "early_exit" | "parent_failed";
    }
  | { type: "release_lease" };

export interface RecordedOutput {
  nodeRunId: string;
  output: JsonValue;
  firedPorts: PortName[];
  decision: DecisionResult | null;
}

/** Deterministic id and randomness source (tests pass a seeded one). */
export interface IdSource {
  uuid(): string;
  /** Uniform in [0, 1) — retry jitter. */
  random(): number;
}

export interface StepContext {
  ids: IdSource;
  now: string;
  workerId: string;
  /** Pool this worker orchestrates in (nodes of other pools are delegated). */
  pool?: WorkerPool;
  vars?: Readonly<Record<string, JsonValue>>;
  run?: Partial<RunMeta>;
  /** Recorded replay: `recordedKey(nodeId, scope, inputHash)` → recorded result. */
  recorded?: ReadonlyMap<string, RecordedOutput>;
  /** Restart-from-node: these nodes (and whatever depends on them) always execute. */
  neverReuse?: ReadonlySet<NodeId>;
  /** Resolves a subflow's version (the environment's deployment when `versionId` is null). */
  subflowVersion?: (workflowId: string, versionId: string | null) => string | null;
  /** Subflow nesting depth of this run (root = 0). */
  depth?: number;
  /** Lease TTL recorded in RUN_STARTED (default 30 s). */
  leaseTtlMs?: number;
}

export interface StepResult {
  state: SchedulerState;
  events: DurableRunEvent[];
  effects: Effect[];
}

/** Recorded-output key; identical to the database's `recordedKey`. */
export function recordedKey(nodeId: NodeId, scope: ScopePath, inputHash: string): string {
  return `${scope}|${nodeId}|${inputHash}`;
}

/** `inputHash = sha256(canonical(inputs) + canonical(config) + typeVersion)` (§5.9). */
export function inputHashOf(inputs: JsonValue, config: JsonValue, typeVersion: string): string {
  return sha256Hex(`${stableStringify(inputs)}${stableStringify(config)}${typeVersion}`);
}

/** `base64url(sha256(runId|scope|nodeId|inputHash))[:32]` (§5.8), stable across attempts. */
export function idempotencyKeyOf(
  runId: string,
  scope: ScopePath,
  nodeId: NodeId,
  inputHash: string,
): string {
  const hex = sha256Hex(`${runId}|${scope}|${nodeId}|${inputHash}`);
  const bytes = new Uint8Array(hex.match(/../g)?.map((h) => parseInt(h, 16)) ?? []);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 32);
}

/** The run-deadline timer id: derived from the run id so recovery finds it without state. */
export function deadlineTimerId(runId: string): string {
  const h = sha256Hex(`${runId}|run_deadline`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Full-jitter exponential backoff (AWS Architecture Blog, "Exponential Backoff and Jitter"). */
export function retryDelay(
  backoff: {
    type: "none" | "fixed" | "exponential";
    initialMs: number;
    maxMs: number;
    factor: number;
    jitter: boolean;
  },
  attempt: number,
  random: number,
  retryAfterMs?: number,
): number {
  if (retryAfterMs !== undefined && retryAfterMs >= 0) return Math.round(retryAfterMs);
  if (backoff.type === "none") return 0;
  const base =
    backoff.type === "fixed"
      ? backoff.initialMs
      : Math.min(backoff.maxMs, backoff.initialMs * backoff.factor ** (attempt - 1));
  const capped = Math.min(backoff.maxMs, base);
  return Math.round(backoff.jitter ? random * capped : capped);
}

/* ───────────────────────────── the stepper ───────────────────────────── */

type AnyEvent = Omit<DurableRunEvent, "runId" | "seq" | "at">;

const addMs = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

/** A wait `until.at` value as an ISO timestamp (ISO text or epoch milliseconds). */
function timestampOf(value: JsonValue | undefined): string {
  const date =
    typeof value === "number"
      ? new Date(value)
      : typeof value === "string"
        ? new Date(value)
        : new Date(Number.NaN);
  if (Number.isNaN(date.getTime()))
    throw new SchemaValidationError("wait.until.at is not a timestamp", [
      { path: "/until/at", message: "expected an ISO date-time or epoch milliseconds" },
    ]);
  return date.toISOString();
}
const TERMINAL: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);

class Stepper {
  s: SchedulerState;
  readonly events: DurableRunEvent[] = [];
  readonly effects: Effect[] = [];
  private readonly pool: WorkerPool;

  constructor(
    readonly plan: ExecutionPlan,
    state: SchedulerState,
    readonly ctx: StepContext,
  ) {
    this.s = state;
    this.pool = ctx.pool ?? "general";
  }

  get terminal(): boolean {
    return TERMINAL.has(this.s.run.status);
  }

  emit(partial: AnyEvent): void {
    const event = {
      ...partial,
      runId: this.s.run.id,
      seq: this.s.run.lastSeq + 1,
      at: this.ctx.now,
    } as DurableRunEvent;
    this.s = reduce(this.plan, this.s, event);
    this.events.push(event);
  }

  addr(scope: ScopePath, nodeId: NodeId) {
    const n = nodeState(this.s, scope, nodeId);
    return { nodeRunId: n.nodeRunId ?? "", nodeId, scope, attempt: n.attempt };
  }

  node(nodeId: NodeId): PlanNode {
    const node = this.plan.nodes[nodeId];
    if (!node) throw new Error(`plan has no node ${nodeId}`);
    return node;
  }

  /** Variables: definition defaults, overridden by the environment and run values in `ctx.vars`. */
  vars(): Record<string, JsonValue> {
    const out: Record<string, JsonValue> = {};
    for (const v of this.plan.variables) if (v.default !== undefined) out[v.name] = v.default;
    return { ...out, ...this.ctx.vars };
  }

  scopeOf(ctxScope: ScopePath): EvalScope {
    return evalScope({
      plan: this.plan,
      state: this.s,
      scope: ctxScope,
      vars: this.vars(),
      run: {
        id: this.s.run.id,
        workflowId: this.plan.workflowId,
        workflowVersionId: null,
        environment: null,
        startedAt: this.s.run.startedAt,
        sessionId: null,
        ...this.ctx.run,
      },
      now: this.ctx.now,
    });
  }

  errorInfo(error: unknown, scope: ScopePath, nodeId: NodeId): ErrorInfo {
    const n = nodeState(this.s, scope, nodeId);
    return toFlowaidError(error).toInfo({
      runId: this.s.run.id,
      nodeId,
      ...(n.nodeRunId ? { nodeRunId: n.nodeRunId } : {}),
    });
  }

  durationMs(): number {
    return this.s.run.startedAt
      ? Math.max(0, Date.parse(this.ctx.now) - Date.parse(this.s.run.startedAt))
      : 0;
  }

  /* ─── scheduling ─── */

  schedule(
    scope: ScopePath,
    nodeId: NodeId,
    extra: {
      inputHash?: string;
      idempotencyKey?: string | null;
      reusedFrom?: string | null;
      batchId?: string | null;
    } = {},
  ) {
    const node = this.node(nodeId);
    const attempt = nodeState(this.s, scope, nodeId).attempt;
    this.emit({
      type: "NODE_SCHEDULED",
      nodeRunId: this.ctx.ids.uuid(),
      nodeId,
      scope,
      attempt,
      kind: node.kind,
      nodeType: node.op.kind === "task" ? node.op.type : null,
      inputHash: extra.inputHash ?? "",
      idempotencyKey: extra.idempotencyKey ?? null,
      reusedFromNodeRunId: extra.reusedFrom ?? null,
      batchId: extra.batchId ?? null,
    } as AnyEvent);
  }

  started(scope: ScopePath, nodeId: NodeId, input: JsonValue) {
    this.emit({
      type: "NODE_STARTED",
      ...this.addr(scope, nodeId),
      input,
      pool: this.node(nodeId).pool,
      workerId: this.ctx.workerId,
    } as AnyEvent);
  }

  complete(
    scope: ScopePath,
    nodeId: NodeId,
    output: JsonObject,
    firedPorts: PortName[],
    extra: {
      usage?: TokenUsage | null;
      costUsd?: number;
      latencyMs?: number;
      reused?: boolean;
    } = {},
  ) {
    this.emit({
      type: "NODE_COMPLETED",
      ...this.addr(scope, nodeId),
      output,
      firedPorts,
      usage: extra.usage ?? null,
      costUsd: extra.costUsd ?? 0,
      latencyMs: extra.latencyMs ?? 0,
      reused: extra.reused ?? false,
    } as AnyEvent);
  }

  setTimer(scope: ScopePath, nodeId: NodeId, purpose: TimerPurpose, fireAt: string): string {
    const timerId = this.ctx.ids.uuid();
    const a = this.addr(scope, nodeId);
    this.emit({ type: "TIMER_SET", ...a, timerId, fireAt, purpose } as AnyEvent);
    this.effects.push({
      type: "set_timer",
      timer: { id: timerId, runId: this.s.run.id, nodeRunId: a.nodeRunId, purpose, fireAt },
    });
    return timerId;
  }

  cancelTimersOf(nodeRunId: string) {
    for (const [id, t] of Object.entries(this.s.timers)) {
      if (t.nodeRunId === nodeRunId) this.effects.push({ type: "cancel_timer", timerId: id });
    }
  }

  /** Fails a node: a retry when the policy allows it, else terminal per `onError`. */
  fail(scope: ScopePath, nodeId: NodeId, error: ErrorInfo, latencyMs = 0, allowRetry = true) {
    const node = this.node(nodeId);
    const n = nodeState(this.s, scope, nodeId);
    const retry = node.policy.retry;
    const retryable = error.retryable || (retry.retryOn?.includes(error.code) ?? false);
    const safeToRepeat = node.idempotency !== "none" || retry.allowOnIrreversible;
    if (
      allowRetry &&
      retryable &&
      safeToRepeat &&
      n.attempt < retry.maxAttempts &&
      !this.s.run.cancelRequested
    ) {
      const details = error.details as { retryAfterMs?: unknown } | undefined;
      const retryAfter =
        typeof details?.retryAfterMs === "number" ? details.retryAfterMs : undefined;
      const delayMs = retryDelay(retry.backoff, n.attempt, this.ctx.ids.random(), retryAfter);
      const timerId = this.ctx.ids.uuid();
      const a = this.addr(scope, nodeId);
      this.emit({
        type: "NODE_FAILED",
        ...a,
        error,
        firedPorts: [],
        latencyMs,
        terminal: false,
      } as AnyEvent);
      this.emit({
        type: "NODE_RETRIED",
        ...a,
        error,
        nextAttempt: n.attempt + 1,
        delayMs,
        timerId,
      } as AnyEvent);
      const fireAt = addMs(this.ctx.now, delayMs);
      this.emit({ type: "TIMER_SET", ...a, timerId, fireAt, purpose: "retry" } as AnyEvent);
      this.effects.push({
        type: "set_timer",
        timer: {
          id: timerId,
          runId: this.s.run.id,
          nodeRunId: a.nodeRunId,
          purpose: "retry",
          fireAt,
        },
      });
      return;
    }
    const fired: PortName[] =
      node.policy.onError === "route" && node.controlOut.includes("failed")
        ? ["failed"]
        : node.policy.onError === "ignore" && node.controlOut.includes("done")
          ? ["done"]
          : [];
    this.emit({
      type: "NODE_FAILED",
      ...this.addr(scope, nodeId),
      error,
      firedPorts: fired,
      latencyMs,
      terminal: true,
    } as AnyEvent);
    if (n.nodeRunId) this.cancelTimersOf(n.nodeRunId);
  }

  /** Cancels every active node in `scopes` (recursively their containers' children). */
  cancelActive(
    scopes: readonly ScopePath[],
    reason: "run_cancelled" | "race_lost" | "early_exit" | "parent_failed",
  ) {
    const within = (path: ScopePath) =>
      scopes.some((s) => s === "" || path === s || path.startsWith(`${s}/`));
    for (const sc of Object.values(this.s.scopes)) {
      if (!within(sc.path)) continue;
      for (const [nodeId, n] of Object.entries(sc.nodes)) {
        if (!ACTIVE.has(n.status) || !n.nodeRunId) continue;
        this.cancelNode(sc.path, nodeId, reason);
      }
    }
  }

  cancelNode(
    scope: ScopePath,
    nodeId: NodeId,
    reason: "run_cancelled" | "race_lost" | "early_exit" | "parent_failed",
  ) {
    const n = nodeState(this.s, scope, nodeId);
    if (!n.nodeRunId) return;
    if (n.status === "running" || n.status === "pending" || n.waiting?.reason === "delegated")
      this.effects.push({ type: "abort_node", nodeRunId: n.nodeRunId, reason });
    this.cancelTimersOf(n.nodeRunId);
    for (const [childRunId, sub] of Object.entries(this.s.subruns)) {
      if (sub.nodeRunId === n.nodeRunId)
        this.effects.push({ type: "cancel_child_run", childRunId });
    }
    this.emit({ type: "NODE_CANCELLED", ...this.addr(scope, nodeId), reason } as AnyEvent);
  }

  skip(
    scope: ScopePath,
    nodeId: NodeId,
    reason: "pruned" | "race_lost" | "parent_failed" | "disabled" | "early_exit",
  ) {
    const n = nodeState(this.s, scope, nodeId);
    this.emit({
      type: "NODE_SKIPPED",
      nodeRunId: n.nodeRunId ?? this.ctx.ids.uuid(),
      nodeId,
      scope,
      attempt: n.attempt,
      reason,
    } as AnyEvent);
  }

  /* ─── run-level endings ─── */

  finishRun(kind: "completed" | "failed" | "timed_out", error?: ErrorInfo) {
    if (this.terminal) return;
    const usage = this.s.run.usage;
    const costUsd = this.s.run.costUsd;
    const durationMs = this.durationMs();
    if (kind === "completed") {
      const output: JsonObject = {};
      let outcome: string | null = null;
      for (const o of this.s.run.outputs) {
        if (o.output !== null && typeof o.output === "object" && !Array.isArray(o.output))
          Object.assign(output, o.output);
        outcome = o.outcome ?? outcome;
      }
      const single = this.s.run.outputs.length === 1 ? this.s.run.outputs[0]?.output : undefined;
      const value =
        single !== undefined &&
        (single === null || typeof single !== "object" || Array.isArray(single))
          ? single
          : output;
      this.emit({
        type: "RUN_COMPLETED",
        output: value,
        outcome,
        usage,
        costUsd,
        durationMs,
      } as AnyEvent);
    } else if (kind === "failed") {
      this.emit({
        type: "RUN_FAILED",
        error: error ?? new NoOutputError("The run failed").toInfo(),
        usage,
        costUsd,
        durationMs,
      } as AnyEvent);
    } else {
      const timeoutMs = this.plan.execution.timeoutMs;
      this.emit({ type: "RUN_TIMED_OUT", timeoutMs, usage, costUsd, durationMs } as AnyEvent);
    }
    for (const id of Object.keys(this.s.timers))
      this.effects.push({ type: "cancel_timer", timerId: id });
    this.effects.push({ type: "cancel_timer", timerId: deadlineTimerId(this.s.run.id) });
    this.effects.push({ type: "release_lease" });
  }

  failRun(error: ErrorInfo) {
    this.cancelActive([""], "parent_failed");
    this.finishRun("failed", error);
  }

  /* ─── triggers ─── */

  start() {
    if (this.s.run.status !== "queued") return;
    const deadlineAt = addMs(this.ctx.now, this.plan.execution.timeoutMs);
    this.emit({
      type: "RUN_STARTED",
      workerId: this.ctx.workerId,
      leaseUntil: addMs(this.ctx.now, this.ctx.leaseTtlMs ?? 30_000),
      deadlineAt,
    } as AnyEvent);
    this.effects.push({
      type: "set_timer",
      timer: {
        id: deadlineTimerId(this.s.run.id),
        runId: this.s.run.id,
        nodeRunId: null,
        purpose: "run_deadline",
        fireAt: deadlineAt,
      },
    });
  }

  resumeIfWaiting(reason: WaitReason, nodeRunId: string | null) {
    const st = this.s.run.status;
    if (st === "waiting" || st === "waiting_for_human" || st === "retrying")
      this.emit({ type: "RUN_RESUMED", reason, nodeRunId } as AnyEvent);
  }

  locate(nodeRunId: string) {
    const at = this.s.nodeRuns[nodeRunId];
    if (!at) return null;
    const n = nodeState(this.s, at.scope, at.nodeId);
    return n.nodeRunId === nodeRunId ? { ...at, n } : null;
  }

  nodeResult(nodeRunId: string, result: ExecutorOutcome) {
    const found = this.locate(nodeRunId);
    if (!found) return; // stale: cancelled, raced, or already handled
    const { scope, nodeId, n } = found;
    if (n.status !== "running" && !(n.status === "waiting" && n.waiting?.reason === "delegated"))
      return;
    if (n.status === "waiting") this.resumeIfWaiting("delegated", nodeRunId);
    const a = this.addr(scope, nodeId);
    for (const e of result.events ?? []) this.emit({ ...e, ...a });
    const node = this.node(nodeId);
    switch (result.kind) {
      case "ok": {
        const route = result.route ?? "done";
        if (!node.controlOut.includes(route) && node.controlOut.length > 0) {
          this.fail(
            scope,
            nodeId,
            new SchemaValidationError(`Node ${nodeId} routed to undeclared port '${route}'`, [
              { path: "/route", message: `not one of ${node.controlOut.join(", ")}` },
            ]).toInfo({ runId: this.s.run.id, nodeId, nodeRunId }),
            result.latencyMs,
            false,
          );
          return;
        }
        this.complete(scope, nodeId, result.output, node.controlOut.length > 0 ? [route] : [], {
          usage: result.usage ?? null,
          costUsd: result.costUsd ?? 0,
          latencyMs: result.latencyMs,
        });
        return;
      }
      case "error":
        this.fail(scope, nodeId, result.error, result.latencyMs);
        return;
      case "suspend": {
        if (result.wait.kind === "human") {
          const humanTaskId = this.ctx.ids.uuid();
          const request: HumanRequest = { ...result.wait.request, origin: "task_suspend" };
          this.emit({ type: "HUMAN_APPROVAL_REQUESTED", ...a, humanTaskId, request } as AnyEvent);
          this.emit({
            type: "NODE_WAITING",
            ...a,
            reason: "human",
            ref: humanTaskId,
            state: result.state,
          } as AnyEvent);
          this.effects.push({ type: "create_human_task", humanTaskId, nodeRunId, request });
          if (request.expiresAt) this.setTimer(scope, nodeId, "human_expiry", request.expiresAt);
        } else {
          this.emit({
            type: "NODE_WAITING",
            ...a,
            reason: "event",
            ref: result.wait.eventName,
            state: result.state,
          } as AnyEvent);
          if (result.wait.timeoutMs)
            this.setTimer(scope, nodeId, "wait", addMs(this.ctx.now, result.wait.timeoutMs));
        }
        return;
      }
    }
  }

  timer(timerId: string) {
    if (timerId === deadlineTimerId(this.s.run.id)) {
      if (!this.terminal) this.timeOut();
      return;
    }
    const t = this.s.timers[timerId];
    if (!t) return; // cancelled or already fired
    const n = nodeState(this.s, t.scope, t.nodeId);
    const a = { nodeRunId: t.nodeRunId, nodeId: t.nodeId, scope: t.scope, attempt: n.attempt };
    this.emit({ type: "TIMER_FIRED", ...a, timerId, purpose: t.purpose } as AnyEvent);
    if (n.nodeRunId !== t.nodeRunId) return;
    const node = this.node(t.nodeId);
    switch (t.purpose) {
      case "retry":
        this.resumeIfWaiting("timer", t.nodeRunId);
        return; // the reducer made the node idle again; the loop reschedules it
      case "wait": {
        if (n.status !== "waiting") return;
        this.resumeIfWaiting("timer", t.nodeRunId);
        if (node.kind === "wait") {
          const timedOut = n.waiting?.reason === "event";
          this.complete(t.scope, t.nodeId, { payload: null, fired_at: this.ctx.now }, [
            timedOut ? "timeout" : "done",
          ]);
        } else if (node.kind === "task" && n.waiting?.reason === "event") {
          this.reexecute(t.scope, t.nodeId, { kind: "timeout", state: n.waiting.state });
        }
        return;
      }
      case "node_timeout": {
        if (n.status !== "waiting") return;
        this.resumeIfWaiting("subflow", t.nodeRunId);
        for (const [childRunId, sub] of Object.entries(this.s.subruns))
          if (sub.nodeRunId === t.nodeRunId)
            this.effects.push({ type: "cancel_child_run", childRunId });
        this.fail(
          t.scope,
          t.nodeId,
          new TimeoutError("The subflow did not finish in time").toInfo({
            runId: this.s.run.id,
            nodeId: t.nodeId,
            nodeRunId: t.nodeRunId,
          }),
          0,
          false,
        );
        return;
      }
      case "human_expiry":
      case "human_escalation": {
        const entry = Object.entries(this.s.humanTasks).find(
          ([, h]) => h.nodeRunId === t.nodeRunId && h.status === "open",
        );
        if (!entry) return;
        const [humanTaskId] = entry;
        const op = node.op.kind === "human" ? node.op : null;
        if (t.purpose === "human_escalation") {
          const to = op?.escalation?.to ?? [];
          this.emit({
            type: "HUMAN_TASK_ESCALATED",
            ...a,
            humanTaskId,
            to,
            reason: "timer",
          } as AnyEvent);
          return;
        }
        const action = op?.onExpire ?? "fail";
        this.emit({ type: "HUMAN_TASK_EXPIRED", ...a, humanTaskId, action } as AnyEvent);
        if (action === "escalate" && op) {
          this.emit({
            type: "HUMAN_TASK_ESCALATED",
            ...a,
            humanTaskId,
            to: op.escalation?.to ?? [],
            reason: "timer",
          } as AnyEvent);
          if (op.expiresInMs)
            this.setTimer(t.scope, t.nodeId, "human_expiry", addMs(this.ctx.now, op.expiresInMs));
          return;
        }
        this.resumeIfWaiting("human", t.nodeRunId);
        if (action === "route" && node.controlOut.includes("expired")) {
          const decision: HumanDecision = {
            action: "expire",
            option: null,
            by: "system",
            at: this.ctx.now,
            comment: null,
          };
          this.complete(t.scope, t.nodeId, { decision: decision, value: null }, ["expired"]);
        } else {
          this.fail(
            t.scope,
            t.nodeId,
            new HumanTaskExpiredError(`Human task ${humanTaskId} expired`).toInfo({
              runId: this.s.run.id,
              nodeId: t.nodeId,
              nodeRunId: t.nodeRunId,
            }),
            0,
            false,
          );
        }
        return;
      }
      case "join_timeout": // the reducer marked the join timed out; the loop completes it
      case "loop_timeout":
      case "run_deadline":
        return;
    }
  }

  reexecute(scope: ScopePath, nodeId: NodeId, resume: ResumeInfo) {
    const n = nodeState(this.s, scope, nodeId);
    if (!n.nodeRunId) return;
    this.emit({
      type: "NODE_STARTED",
      ...this.addr(scope, nodeId),
      input: n.input ?? {},
      pool: this.node(nodeId).pool,
      workerId: this.ctx.workerId,
    } as AnyEvent);
    const input = (n.input ?? {}) as JsonObject;
    this.effects.push({
      type: "execute",
      scope,
      nodeId,
      nodeRunId: n.nodeRunId,
      input,
      config: {},
      resume,
    });
  }

  humanResponse(humanTaskId: string, response: HumanResponse, by: string) {
    const task = this.s.humanTasks[humanTaskId];
    if (!task || task.status !== "open") return;
    const n = nodeState(this.s, task.scope, task.nodeId);
    if (n.nodeRunId !== task.nodeRunId || n.status !== "waiting") return;
    const a = this.addr(task.scope, task.nodeId);
    this.emit({ type: "HUMAN_APPROVAL_RECEIVED", ...a, humanTaskId, response, by } as AnyEvent);
    if (response.action === "escalate") {
      this.emit({
        type: "HUMAN_TASK_ESCALATED",
        ...a,
        humanTaskId,
        to: response.to,
        reason: "reviewer",
      } as AnyEvent);
      return;
    }
    this.cancelTimersOf(task.nodeRunId);
    this.resumeIfWaiting("human", task.nodeRunId);
    const node = this.node(task.nodeId);
    if (node.kind !== "human") {
      this.reexecute(task.scope, task.nodeId, {
        kind: "human",
        state: n.waiting?.state ?? null,
        response,
        by,
        humanTaskId,
      });
      return;
    }
    const decision: HumanDecision = {
      action:
        response.action === "choose"
          ? "choose"
          : response.action === "submit"
            ? "submit"
            : response.action === "reject"
              ? "reject"
              : "approve",
      option: response.action === "choose" ? response.option : null,
      by,
      at: this.ctx.now,
      comment:
        "comment" in response && typeof response.comment === "string" ? response.comment : null,
    };
    const mode = node.op.kind === "human" ? node.op.mode : null;
    let port: PortName;
    let value: JsonValue = null;
    switch (response.action) {
      case "approve":
        port = "approved";
        value =
          response.value ??
          (mode?.type === "review" ? ((n.input as JsonObject | null)?.value ?? null) : null);
        break;
      case "reject":
        port = "rejected";
        break;
      case "choose":
        port = response.option;
        value = response.option;
        break;
      case "submit":
        port = "submitted";
        value = response.value;
        break;
    }
    this.complete(
      task.scope,
      task.nodeId,
      { decision: decision, value },
      node.controlOut.includes(port) ? [port] : [],
    );
  }

  event(eventName: string, payload: JsonValue) {
    for (const sc of Object.values(this.s.scopes)) {
      for (const [nodeId, n] of Object.entries(sc.nodes)) {
        if (
          n.status !== "waiting" ||
          n.waiting?.reason !== "event" ||
          n.waiting.ref !== eventName ||
          !n.nodeRunId
        )
          continue;
        const a = this.addr(sc.path, nodeId);
        this.emit({ type: "EVENT_RECEIVED", ...a, eventName, payload } as AnyEvent);
        this.cancelTimersOf(n.nodeRunId);
        this.resumeIfWaiting("event", n.nodeRunId);
        if (this.node(nodeId).kind === "wait")
          this.complete(sc.path, nodeId, { payload, fired_at: this.ctx.now }, ["done"]);
        else this.reexecute(sc.path, nodeId, { kind: "event", state: n.waiting.state, payload });
      }
    }
  }

  subflowCompleted(
    childRunId: string,
    status: RunStatus,
    output: JsonValue | null,
    error: ErrorInfo | null,
  ) {
    const sub = this.s.subruns[childRunId];
    if (!sub) return;
    const n = nodeState(this.s, sub.scope, sub.nodeId);
    const a = this.addr(sub.scope, sub.nodeId);
    this.emit({ type: "SUBFLOW_COMPLETED", ...a, childRunId, status, output, error } as AnyEvent);
    if (n.nodeRunId !== sub.nodeRunId || n.status !== "waiting") return;
    this.cancelTimersOf(sub.nodeRunId);
    this.resumeIfWaiting("subflow", sub.nodeRunId);
    if (status === "completed")
      this.complete(sub.scope, sub.nodeId, { output: output ?? null }, ["done"]);
    else
      this.fail(
        sub.scope,
        sub.nodeId,
        error ??
          new SubflowError(`Subflow run ${childRunId} ended ${status}`, false, childRunId).toInfo({
            runId: this.s.run.id,
            nodeId: sub.nodeId,
          }),
        0,
      );
  }

  cancel(by: string, reason: string | null) {
    if (this.terminal) return;
    this.emit({ type: "RUN_CANCEL_REQUESTED", by, reason } as AnyEvent);
    this.cancelActive([""], "run_cancelled");
    this.emit({
      type: "RUN_CANCELLED",
      by,
      usage: this.s.run.usage,
      costUsd: this.s.run.costUsd,
      durationMs: this.durationMs(),
    } as AnyEvent);
    for (const id of Object.keys(this.s.timers))
      this.effects.push({ type: "cancel_timer", timerId: id });
    this.effects.push({ type: "cancel_timer", timerId: deadlineTimerId(this.s.run.id) });
    this.effects.push({ type: "release_lease" });
  }

  timeOut() {
    this.cancelActive([""], "run_cancelled");
    this.finishRun("timed_out");
  }

  /** A worker died while these node runs executed (§5.6). */
  recovered(lost: readonly string[]) {
    for (const nodeRunId of lost) {
      const found = this.locate(nodeRunId);
      if (!found || found.n.status !== "running") continue;
      const { scope, nodeId, n } = found;
      const node = this.node(nodeId);
      const a = this.addr(scope, nodeId);
      if (node.idempotency === "safe" || node.idempotency === "keyed") {
        const error = new WorkerLostError(`The worker running ${nodeId} was lost`).toInfo({
          runId: this.s.run.id,
          nodeId,
          nodeRunId,
        });
        const timerId = this.ctx.ids.uuid();
        this.emit({
          type: "NODE_FAILED",
          ...a,
          error,
          firedPorts: [],
          latencyMs: 0,
          terminal: false,
        } as AnyEvent);
        this.emit({
          type: "NODE_RETRIED",
          ...a,
          error,
          nextAttempt: n.attempt + 1,
          delayMs: 0,
          timerId,
        } as AnyEvent);
        this.emit({
          type: "TIMER_SET",
          ...a,
          timerId,
          fireAt: this.ctx.now,
          purpose: "retry",
        } as AnyEvent);
        this.emit({ type: "TIMER_FIRED", ...a, timerId, purpose: "retry" } as AnyEvent);
      } else {
        this.fail(
          scope,
          nodeId,
          new NonIdempotentInterruptedError(
            `${nodeId} was interrupted and is not safe to repeat; retry it explicitly`,
          ).toInfo({ runId: this.s.run.id, nodeId, nodeRunId }),
          0,
          false,
        );
      }
    }
  }

  /* ─── starting nodes ─── */

  runningCount(): number {
    let n = 0;
    for (const sc of Object.values(this.s.scopes))
      for (const node of Object.values(sc.nodes))
        if (node.status === "running" || node.status === "pending") n += 1;
    return n;
  }

  /** Resolves a task's inputs and rendered config. */
  taskIo(scope: ScopePath, node: PlanNode): { input: JsonObject; config: JsonObject } {
    if (node.op.kind !== "task") return { input: {}, config: {} };
    const es = this.scopeOf(scope);
    const input = evaluateRecord(node.op.inputs, es);
    let config: JsonObject = node.op.config;
    for (const [pointer, b] of Object.entries(node.op.configBindings)) {
      const v = evaluateBinding(b, es);
      if (v !== undefined) config = setPointer(config, pointer, v);
    }
    for (const [pointer, tpl] of Object.entries(node.op.configTemplates)) {
      config = setPointer(
        config,
        pointer,
        evaluateBinding({ kind: "template", template: tpl, schema: {} }, es) ?? "",
      );
    }
    return { input, config };
  }

  startNode(scope: ScopePath, nodeId: NodeId) {
    const node = this.node(nodeId);
    if (this.s.run.nodeRunCount >= this.plan.execution.maxNodeRuns) {
      this.failRun(
        new BoundsExceededError(
          "maxNodeRuns",
          this.plan.execution.maxNodeRuns,
          this.s.run.nodeRunCount + 1,
        ).toInfo({ runId: this.s.run.id }),
      );
      return;
    }
    const op = node.op;
    const guarded = (fn: () => void) => {
      try {
        fn();
      } catch (error) {
        if (
          !nodeState(this.s, scope, nodeId).nodeRunId ||
          nodeState(this.s, scope, nodeId).status === "idle"
        )
          this.schedule(scope, nodeId);
        this.fail(scope, nodeId, this.errorInfo(error, scope, nodeId), 0, false);
      }
    };
    switch (op.kind) {
      case "input":
        this.schedule(scope, nodeId, { inputHash: inputHashOf(this.s.run.input, {}, "input") });
        this.started(scope, nodeId, this.s.run.input);
        this.complete(
          scope,
          nodeId,
          this.s.run.input !== null &&
            typeof this.s.run.input === "object" &&
            !Array.isArray(this.s.run.input)
            ? this.s.run.input
            : {},
          ["done"],
        );
        return;
      case "output":
        guarded(() => {
          const value = evaluateBinding(op.value, this.scopeOf(scope)) ?? null;
          this.schedule(scope, nodeId, { inputHash: inputHashOf(value, {}, "output") });
          this.started(scope, nodeId, { value });
          const a = this.addr(scope, nodeId);
          this.emit({
            type: "RUN_OUTPUT",
            nodeRunId: a.nodeRunId,
            nodeId,
            output: value,
            outcome: op.outcome,
            earlyExit: op.earlyExit,
          } as AnyEvent);
          this.complete(scope, nodeId, { value }, []);
          if (op.earlyExit && scope === "") {
            this.cancelActive([""], "early_exit");
            this.finishRun("completed");
          }
        });
        return;
      case "branch":
        guarded(() => {
          const es = this.scopeOf(scope);
          const evaluations = op.cases.map((c) => ({
            port: c.port,
            result: evaluateExpression(c.when, es) === true,
          }));
          const hits = evaluations.filter((e) => e.result).map((e) => e.port);
          const taken =
            hits.length === 0 ? [op.defaultPort] : op.mode === "first" ? hits.slice(0, 1) : hits;
          this.schedule(scope, nodeId, {
            inputHash: inputHashOf(evaluations, {}, "branch"),
          });
          this.started(scope, nodeId, {});
          this.emit({
            type: "BRANCH_EVALUATED",
            ...this.addr(scope, nodeId),
            taken,
            evaluations,
          } as AnyEvent);
          this.complete(scope, nodeId, { taken }, taken);
        });
        return;
      case "join":
        this.completeJoin(scope, node);
        return;
      case "loop":
        this.schedule(scope, nodeId, { inputHash: inputHashOf(op.initialCarry, {}, "loop") });
        this.started(scope, nodeId, { carry: op.initialCarry });
        this.emit({
          type: "LOOP_ITERATION_STARTED",
          ...this.addr(scope, nodeId),
          iteration: 0,
          childScope: childScopePath(scope, nodeId, 0),
          carry: op.initialCarry,
        } as AnyEvent);
        return;
      case "foreach":
        guarded(() => {
          const items = evaluateBinding(op.items, this.scopeOf(scope));
          if (!Array.isArray(items))
            throw new SchemaValidationError(`foreach ${nodeId}: items is not an array`, [
              { path: "/items", message: "expected an array" },
            ]);
          this.schedule(scope, nodeId, { inputHash: inputHashOf(items, {}, "foreach") });
          this.started(scope, nodeId, { items });
          const itemCount = Math.min(items.length, op.bounds.maxIterations);
          this.emit({
            type: "FOREACH_STARTED",
            ...this.addr(scope, nodeId),
            itemCount,
            concurrency: op.concurrency,
          } as AnyEvent);
          if (itemCount === 0) this.completeForeach(scope, nodeId);
        });
        return;
      case "subflow":
        guarded(() => {
          const input = evaluateRecord(op.inputs, this.scopeOf(scope));
          const depth = (this.ctx.depth ?? 0) + 1;
          this.schedule(scope, nodeId, {
            inputHash: inputHashOf(input, {}, op.versionId ?? op.workflowId),
          });
          this.started(scope, nodeId, input);
          if (depth > this.plan.execution.maxSubflowDepth)
            throw new BoundsExceededError(
              "maxSubflowDepth",
              this.plan.execution.maxSubflowDepth,
              depth,
            );
          const versionId = this.ctx.subflowVersion?.(op.workflowId, op.versionId) ?? op.versionId;
          if (!versionId)
            throw new SubflowError(`Workflow ${op.workflowId} has no deployed version`, false, "");
          const childRunId = this.ctx.ids.uuid();
          const a = this.addr(scope, nodeId);
          this.emit({
            type: "SUBFLOW_STARTED",
            ...a,
            childRunId,
            childVersionId: versionId,
            depth,
          } as AnyEvent);
          this.emit({
            type: "NODE_WAITING",
            ...a,
            reason: "subflow",
            ref: childRunId,
            state: null,
          } as AnyEvent);
          this.effects.push({
            type: "enqueue_child_run",
            childRunId,
            workflowId: op.workflowId,
            versionId,
            input,
            parentNodeRunId: a.nodeRunId,
            depth,
          });
          if (op.timeoutMs)
            this.setTimer(scope, nodeId, "node_timeout", addMs(this.ctx.now, op.timeoutMs));
        });
        return;
      case "wait":
        guarded(() => {
          this.schedule(scope, nodeId);
          if (op.until.type === "event") {
            this.started(scope, nodeId, { eventName: op.until.eventName });
            this.emit({
              type: "NODE_WAITING",
              ...this.addr(scope, nodeId),
              reason: "event",
              ref: op.until.eventName,
              state: null,
            } as AnyEvent);
            this.setTimer(scope, nodeId, "wait", addMs(this.ctx.now, op.until.timeoutMs));
            return;
          }
          const fireAt =
            op.until.type === "delay"
              ? addMs(this.ctx.now, op.until.ms)
              : timestampOf(evaluateBinding(op.until.at, this.scopeOf(scope)));
          this.started(scope, nodeId, { fireAt });
          const timerId = this.setTimer(scope, nodeId, "wait", fireAt);
          this.emit({
            type: "NODE_WAITING",
            ...this.addr(scope, nodeId),
            reason: "timer",
            ref: timerId,
            state: null,
          } as AnyEvent);
        });
        return;
      case "human":
        guarded(() => {
          const es = this.scopeOf(scope);
          const titleValue = evaluateBinding(op.title, es);
          const title = (
            typeof titleValue === "string"
              ? titleValue
              : titleValue === undefined || titleValue === null
                ? node.name
                : JSON.stringify(titleValue)
          ).slice(0, 200);
          const context = evaluateRecord(op.context, es);
          const mode: HumanRequest["mode"] =
            op.mode.type === "review"
              ? {
                  type: "review",
                  value: evaluateBinding(op.mode.value, es) ?? null,
                  schema: op.mode.schema,
                }
              : op.mode.type === "form"
                ? { type: "form", schema: op.mode.schema }
                : op.mode.type === "choice"
                  ? { type: "choice", options: op.mode.options }
                  : { type: "approval" };
          const request: HumanRequest = {
            title,
            context,
            mode,
            assignees: op.assignees,
            expiresAt: op.expiresInMs ? addMs(this.ctx.now, op.expiresInMs) : null,
            externalReview: op.externalReview,
            origin: "human_node",
          };
          const input: JsonObject = {
            title,
            context,
            ...(mode.type === "review" ? { value: mode.value } : {}),
          };
          this.schedule(scope, nodeId, { inputHash: inputHashOf(input, {}, "human") });
          this.started(scope, nodeId, input);
          const humanTaskId = this.ctx.ids.uuid();
          const a = this.addr(scope, nodeId);
          this.emit({ type: "HUMAN_APPROVAL_REQUESTED", ...a, humanTaskId, request } as AnyEvent);
          this.emit({
            type: "NODE_WAITING",
            ...a,
            reason: "human",
            ref: humanTaskId,
            state: null,
          } as AnyEvent);
          this.effects.push({
            type: "create_human_task",
            humanTaskId,
            nodeRunId: a.nodeRunId,
            request,
          });
          if (request.expiresAt) this.setTimer(scope, nodeId, "human_expiry", request.expiresAt);
          if (op.escalation)
            this.setTimer(
              scope,
              nodeId,
              "human_escalation",
              addMs(this.ctx.now, op.escalation.afterMs),
            );
        });
        return;
      case "task":
        this.startTask(scope, node);
        return;
    }
  }

  startTask(scope: ScopePath, node: PlanNode) {
    const nodeId = node.id;
    if (node.op.kind !== "task") return;
    let io: { input: JsonObject; config: JsonObject };
    try {
      io = this.taskIo(scope, node);
    } catch (error) {
      this.schedule(scope, nodeId);
      this.fail(scope, nodeId, this.errorInfo(error, scope, nodeId), 0, false);
      return;
    }
    const inputHash = inputHashOf(io.input, io.config, node.op.typeVersion);
    const recorded = this.ctx.neverReuse?.has(nodeId)
      ? undefined
      : this.ctx.recorded?.get(recordedKey(nodeId, scope, inputHash));
    if (recorded) {
      this.schedule(scope, nodeId, { inputHash, reusedFrom: recorded.nodeRunId });
      this.complete(scope, nodeId, (recorded.output ?? {}) as JsonObject, recorded.firedPorts, {
        reused: true,
      });
      return;
    }
    const idempotencyKey =
      node.idempotency === "keyed"
        ? idempotencyKeyOf(this.s.run.id, scope, nodeId, inputHash)
        : null;
    this.schedule(scope, nodeId, { inputHash, idempotencyKey });
    const a = this.addr(scope, nodeId);
    if (node.pool !== this.pool) {
      const jobId = `node:${a.nodeRunId}`;
      this.emit({
        type: "NODE_STARTED",
        ...a,
        input: io.input,
        pool: node.pool,
        workerId: this.ctx.workerId,
      } as AnyEvent);
      this.emit({ type: "NODE_DELEGATED", ...a, pool: node.pool, jobId } as AnyEvent);
      this.effects.push({ type: "delegate", pool: node.pool, nodeRunId: a.nodeRunId, jobId });
      return;
    }
    this.started(scope, nodeId, io.input);
    this.effects.push({
      type: "execute",
      scope,
      nodeId,
      nodeRunId: a.nodeRunId,
      input: io.input,
      config: io.config,
    });
  }

  /* ─── joins ─── */

  /** Records new arrivals of joins that are waiting (scheduling the join on its first one). */
  joinArrivals(): boolean {
    let progressed = false;
    for (const sc of Object.values(this.s.scopes)) {
      if (sc.closed) continue;
      for (const nodeId of this.plan.scopes[sc.planScope]?.order ?? []) {
        const node = this.plan.nodes[nodeId];
        if (!node || node.op.kind !== "join") continue;
        const status = nodeState(this.s, sc.path, nodeId).status;
        if (status !== "idle" && status !== "pending") continue;
        const recorded = this.s.joins[nodeKey(sc.path, nodeId)]?.arrivals ?? {};
        for (const dep of node.controlIn) {
          if (recorded[dep.edgeId]) continue;
          const p = nodeState(this.s, sc.path, dep.from.node);
          let st: "fired" | "pruned" | null = null;
          if (p.status === "completed" || p.status === "reused" || p.status === "failed")
            st = p.firedPorts.includes(dep.from.port) ? "fired" : "pruned";
          else if (p.status === "skipped" || p.status === "cancelled") st = "pruned";
          if (!st) continue;
          if (nodeState(this.s, sc.path, nodeId).status === "idle") {
            if (st === "pruned" && verdict(this.plan, this.s, sc.path, node) === "prune") continue; // let the prune happen
            this.schedule(sc.path, nodeId);
            if (node.op.timeoutMs)
              this.setTimer(
                sc.path,
                nodeId,
                "join_timeout",
                addMs(this.ctx.now, node.op.timeoutMs),
              );
          }
          const arrived =
            Object.keys(this.s.joins[nodeKey(sc.path, nodeId)]?.arrivals ?? {}).length + 1;
          this.emit({
            type: "JOIN_ARRIVED",
            ...this.addr(sc.path, nodeId),
            edgeId: dep.edgeId,
            from: dep.from.node,
            status: st,
            arrived,
            expected: node.controlIn.length,
          } as AnyEvent);
          progressed = true;
        }
      }
    }
    return progressed;
  }

  completeJoin(scope: ScopePath, node: PlanNode) {
    if (node.op.kind !== "join") return;
    const op = node.op;
    const nodeId = node.id;
    if (nodeState(this.s, scope, nodeId).status === "idle") this.schedule(scope, nodeId);
    const es = this.scopeOf(scope);
    const values: JsonObject = {};
    for (const [name, b] of Object.entries(op.inputs)) {
      let v: JsonValue | undefined;
      try {
        v = evaluateBinding({ ...b, ...(b.kind === "ref" ? { optional: true } : {}) }, es);
      } catch {
        v = undefined;
      }
      values[name] = v ?? null;
    }
    const arrivals = this.s.joins[nodeKey(scope, nodeId)]?.arrivals ?? {};
    const firedEdges = node.controlIn.filter(
      (d) =>
        arrivals[d.edgeId] === "fired" ||
        nodeState(this.s, scope, d.from.node).firedPorts.includes(d.from.port),
    );
    const winner = firedEdges[0];
    const first = winner
      ? (Object.entries(op.inputs).find(
          ([, b]) => b.kind === "ref" && b.ref.kind === "port" && b.ref.node === winner.from.node,
        )?.[0] ?? winner.from.node)
      : null;
    const timedOut = this.s.joins[nodeKey(scope, nodeId)]?.timedOut === true;
    this.started(scope, nodeId, values);
    const nodeRunId = nodeState(this.s, scope, nodeId).nodeRunId;
    if (nodeRunId) this.cancelTimersOf(nodeRunId);
    this.complete(
      scope,
      nodeId,
      { values, first },
      timedOut && node.controlOut.includes("timeout") ? ["timeout"] : ["done"],
    );
    if (op.mode.type === "race" && winner) {
      for (const dep of node.controlIn) {
        if (dep.edgeId === winner.edgeId) continue;
        for (const loser of op.privateSubgraphs[dep.edgeId] ?? []) {
          const st = nodeState(this.s, scope, loser).status;
          if (ACTIVE.has(st)) this.cancelNode(scope, loser, "race_lost");
          else if (st === "idle") this.skip(scope, loser, "race_lost");
        }
      }
    }
  }

  /* ─── containers ─── */

  containerDrained(path: ScopePath): void {
    const sc = this.s.scopes[path];
    if (!sc?.parent) return;
    const { path: parent, nodeId } = sc.parent;
    const node = this.node(nodeId);
    if (node.op.kind === "loop") this.loopIterationDone(parent, node, path);
    else if (node.op.kind === "foreach") this.foreachItemDone(parent, node, path);
  }

  loopIterationDone(scope: ScopePath, node: PlanNode, childScope: ScopePath) {
    if (node.op.kind !== "loop") return;
    const op = node.op;
    const loop = this.s.loops[nodeKey(scope, node.id)];
    if (!loop) return;
    const a = this.addr(scope, node.id);
    const failure = scopeFailure(this.plan, this.s, childScope);
    const exitFail = (error: ErrorInfo, reason: "body_failed") => {
      this.emit({ type: "LOOP_EXITED", ...a, iterations: loop.iteration + 1, reason } as AnyEvent);
      this.fail(scope, node.id, error, 0, false);
    };
    if (failure) {
      exitFail(
        failure.error ?? this.errorInfo(new Error("loop body failed"), scope, node.id),
        "body_failed",
      );
      return;
    }
    let carry: JsonObject;
    let result: JsonObject;
    let exit: boolean;
    try {
      const es = this.scopeOf(childScope);
      carry = { ...loop.carry, ...evaluateRecord(op.next, es) };
      result = evaluateRecord(op.result, es);
      exit = op.exitWhen ? evaluateExpression(op.exitWhen, es) === true : false;
    } catch (error) {
      exitFail(this.errorInfo(error, scope, node.id), "body_failed");
      return;
    }
    this.emit({
      type: "LOOP_ITERATION_COMPLETED",
      ...a,
      iteration: loop.iteration,
      childScope,
      carry,
      result,
      exit,
      usage: loop.usage,
      costUsd: loop.costUsd,
    } as AnyEvent);
    const iterations = loop.iteration + 1;
    const output: JsonObject = { result, carry, iterations };
    if (exit) {
      this.emit({ type: "LOOP_EXITED", ...a, iterations, reason: "exit_condition" } as AnyEvent);
      this.complete(scope, node.id, output, ["done"]);
      return;
    }
    const b = op.bounds;
    const current = this.s.loops[nodeKey(scope, node.id)] ?? loop;
    let bound: {
      reason: "max_iterations" | "timeout" | "max_cost" | "max_tokens";
      error: BoundsExceededError;
    } | null = null;
    if (iterations >= b.maxIterations)
      bound = {
        reason: "max_iterations",
        error: new BoundsExceededError("maxIterations", b.maxIterations, iterations),
      };
    else if (
      b.timeoutMs !== undefined &&
      Date.parse(this.ctx.now) - Date.parse(current.startedAt) >= b.timeoutMs
    )
      bound = {
        reason: "timeout",
        error: new BoundsExceededError(
          "timeoutMs",
          b.timeoutMs,
          Date.parse(this.ctx.now) - Date.parse(current.startedAt),
        ),
      };
    else if (b.maxCostUsd !== undefined && current.costUsd >= b.maxCostUsd)
      bound = {
        reason: "max_cost",
        error: new BoundsExceededError("maxCostUsd", b.maxCostUsd, current.costUsd),
      };
    else if (b.maxTokens !== undefined && totalTokens(current.usage) >= b.maxTokens)
      bound = {
        reason: "max_tokens",
        error: new BoundsExceededError("maxTokens", b.maxTokens, totalTokens(current.usage)),
      };
    if (bound) {
      this.emit({ type: "LOOP_EXITED", ...a, iterations, reason: bound.reason } as AnyEvent);
      if (op.onExhausted === "route" && node.controlOut.includes("exhausted"))
        this.complete(scope, node.id, output, ["exhausted"]);
      else
        this.fail(
          scope,
          node.id,
          bound.error.toInfo({ runId: this.s.run.id, nodeId: node.id }),
          0,
          false,
        );
      return;
    }
    this.emit({
      type: "LOOP_ITERATION_STARTED",
      ...a,
      iteration: iterations,
      childScope: childScopePath(scope, node.id, iterations),
      carry,
    } as AnyEvent);
  }

  foreachItemDone(scope: ScopePath, node: PlanNode, childScope: ScopePath) {
    if (node.op.kind !== "foreach") return;
    const op = node.op;
    const key = nodeKey(scope, node.id);
    const fe = this.s.foreach[key];
    if (!fe) return;
    const index = Number(childScope.slice(childScope.lastIndexOf("#") + 1));
    const a = this.addr(scope, node.id);
    const failure = scopeFailure(this.plan, this.s, childScope);
    if (failure) {
      const error = failure.error ?? this.errorInfo(new Error("item failed"), scope, node.id);
      const status = op.failurePolicy === "skip" ? "skipped" : "failed";
      this.emit({
        type: "FOREACH_ITEM_COMPLETED",
        ...a,
        index,
        childScope,
        status,
        result: null,
        error,
      } as AnyEvent);
      if (op.failurePolicy === "fail_fast") {
        const open = Object.values(this.s.scopes)
          .filter((s) => s.parent?.path === scope && s.parent.nodeId === node.id && !s.closed)
          .map((s) => s.path);
        this.cancelActive(open, "parent_failed");
        for (const p of open)
          this.emit({
            type: "FOREACH_ITEM_COMPLETED",
            ...a,
            index: Number(p.slice(p.lastIndexOf("#") + 1)),
            childScope: p,
            status: "skipped",
            result: null,
            error: null,
          } as AnyEvent);
        this.fail(scope, node.id, error, 0, false);
        return;
      }
    } else {
      let result: JsonValue | null = null;
      try {
        result = op.collect
          ? (evaluateBinding(op.collect, this.scopeOf(childScope)) ?? null)
          : null;
      } catch (error) {
        this.emit({
          type: "FOREACH_ITEM_COMPLETED",
          ...a,
          index,
          childScope,
          status: "failed",
          result: null,
          error: this.errorInfo(error, scope, node.id),
        } as AnyEvent);
        this.maybeCompleteForeach(scope, node.id);
        return;
      }
      this.emit({
        type: "FOREACH_ITEM_COMPLETED",
        ...a,
        index,
        childScope,
        status: "completed",
        result,
        error: null,
      } as AnyEvent);
    }
    this.maybeCompleteForeach(scope, node.id);
  }

  maybeCompleteForeach(scope: ScopePath, nodeId: NodeId): boolean {
    const fe = this.s.foreach[nodeKey(scope, nodeId)];
    if (!fe || fe.done < fe.total) return false;
    this.completeForeach(scope, nodeId);
    return true;
  }

  completeForeach(scope: ScopePath, nodeId: NodeId) {
    const node = this.node(nodeId);
    if (node.op.kind !== "foreach") return;
    const op = node.op;
    const fe = this.s.foreach[nodeKey(scope, nodeId)];
    const items = fe?.items ?? [];
    const results: (JsonValue | null)[] = items.map((_, i) => fe?.results[i] ?? null);
    const errors: (ErrorInfo | null)[] = items.map((_, i) =>
      i >= (fe?.total ?? 0)
        ? new BoundsExceededError("maxIterations", op.bounds.maxIterations, items.length).toInfo({
            runId: this.s.run.id,
            nodeId,
          })
        : (fe?.errors[i] ?? null),
    );
    let reduced: JsonValue | null = null;
    if (op.reduce) {
      try {
        let acc: JsonValue = op.reduce.initial;
        results.forEach((item, index) => {
          const reduceScope: EvalScope = {
            resolve: (ref) => {
              if (ref.kind === "scope") {
                // In `reduce`, $scope.carry is the accumulator, $scope.item the result, $scope.index its index.
                const base: JsonValue =
                  ref.field === "carry"
                    ? acc
                    : ref.field === "item"
                      ? (item ?? null)
                      : ref.field === "index"
                        ? index
                        : null;
                if (!ref.path) return base;
                const projected = projectValue(base, ref.path);
                return projected.ok ? projected.value : undefined;
              }
              return this.scopeOf(scope).resolve(ref);
            },
            now: () => this.ctx.now,
          };
          acc = evaluateExpression(
            op.reduce?.expr ?? { kind: "literal", value: null },
            reduceScope,
          );
        });
        reduced = acc;
      } catch (error) {
        this.fail(scope, nodeId, this.errorInfo(error, scope, nodeId), 0, false);
        return;
      }
    }
    this.complete(scope, nodeId, { results, errors: errors as unknown as JsonValue[], reduced }, [
      "done",
    ]);
  }

  /* ─── the loop ─── */

  checkRunBounds(): boolean {
    const ex = this.plan.execution;
    if (this.s.run.deadlineAt && Date.parse(this.ctx.now) >= Date.parse(this.s.run.deadlineAt)) {
      this.timeOut();
      return true;
    }
    if (ex.maxCostUsd !== undefined && this.s.run.costUsd > ex.maxCostUsd) {
      this.failRun(
        new BoundsExceededError("maxCostUsd", ex.maxCostUsd, this.s.run.costUsd).toInfo({
          runId: this.s.run.id,
        }),
      );
      return true;
    }
    if (ex.maxTokens !== undefined && totalTokens(this.s.run.usage) > ex.maxTokens) {
      this.failRun(
        new BoundsExceededError("maxTokens", ex.maxTokens, totalTokens(this.s.run.usage)).toInfo({
          runId: this.s.run.id,
        }),
      );
      return true;
    }
    return false;
  }

  process() {
    for (let guard = 0; guard < 100_000 && !this.terminal; guard += 1) {
      if (this.s.run.status === "queued") return;
      if (this.checkRunBounds()) return;
      // A failed scope stops its other work at once.
      for (const sc of Object.values(this.s.scopes)) {
        if (sc.closed || !scopeFailure(this.plan, this.s, sc.path)) continue;
        if (sc.path === "") {
          const f = scopeFailure(this.plan, this.s, "");
          this.failRun(
            f?.error ?? new NoOutputError("A node failed").toInfo({ runId: this.s.run.id }),
          );
          return;
        }
        this.cancelActive([sc.path], "parent_failed");
      }
      let progressed = this.joinArrivals();
      const limit = this.plan.execution.concurrency;
      for (const item of ready(this.plan, this.s)) {
        if (this.terminal) return;
        const node = this.plan.nodes[item.nodeId];
        const status = nodeState(this.s, item.scope, item.nodeId).status;
        if (!node || (status !== "idle" && !(node.kind === "join" && status === "pending")))
          continue;
        if (verdict(this.plan, this.s, item.scope, node) !== item.action) continue; // stale
        if (item.action === "prune") {
          const n = nodeState(this.s, item.scope, item.nodeId);
          if (n.nodeRunId && n.status === "pending") this.cancelTimersOf(n.nodeRunId);
          this.skip(item.scope, item.nodeId, "pruned");
          progressed = true;
          continue;
        }
        if (node.kind === "task" && this.runningCount() >= limit) continue;
        this.startNode(item.scope, item.nodeId);
        progressed = true;
      }
      for (const sc of Object.values(this.s.scopes)) {
        if (this.terminal) return;
        if (sc.closed || sc.path === "" || !scopeDrained(this.plan, this.s, sc.path)) continue;
        this.containerDrained(sc.path);
        progressed = true;
      }
      if (!progressed) break;
    }
    if (this.terminal) return;
    if (scopeDrained(this.plan, this.s, "")) {
      const failure = scopeFailure(this.plan, this.s, "");
      if (failure)
        this.failRun(
          failure.error ?? new NoOutputError("A node failed").toInfo({ runId: this.s.run.id }),
        );
      else if (this.s.run.outputs.length > 0) this.finishRun("completed");
      else
        this.finishRun(
          "failed",
          new NoOutputError("The workflow finished without reaching an output node").toInfo({
            runId: this.s.run.id,
          }),
        );
      return;
    }
    this.settleStatus();
  }

  /** Emits RUN_WAITING when nothing executes any more (§5.2). */
  settleStatus() {
    const active: { reason: WaitReason | "retry" | "running"; nodeRunId: string }[] = [];
    for (const sc of Object.values(this.s.scopes)) {
      for (const [nodeId, n] of Object.entries(sc.nodes)) {
        if (!n.nodeRunId) continue;
        // Containers and joins waiting for arrivals do nothing themselves; their inputs decide.
        const kind = this.plan.nodes[nodeId]?.kind;
        if (kind === "loop" || kind === "foreach" || (kind === "join" && n.status === "pending"))
          continue;
        if (n.status === "running" || n.status === "pending")
          active.push({ reason: "running", nodeRunId: n.nodeRunId });
        else if (n.status === "retry_wait")
          active.push({ reason: "retry", nodeRunId: n.nodeRunId });
        else if (n.status === "waiting" && n.waiting)
          active.push({ reason: n.waiting.reason, nodeRunId: n.nodeRunId });
      }
    }
    if (active.some((x) => x.reason === "running")) return;
    if (active.length === 0) return;
    if (this.s.run.status !== "running" && this.s.run.status !== "starting") return;
    const reasons = new Set(active.map((x) => x.reason));
    const reason: WaitReason =
      reasons.size === 1 && reasons.has("human")
        ? "human"
        : [...reasons].every((r) => r === "retry" || r === "timer")
          ? "timer"
          : ([...reasons].find((r) => r !== "retry" && r !== "running") ?? "timer");
    this.emit({
      type: "RUN_WAITING",
      reason,
      nodeRunIds: active.map((x) => x.nodeRunId),
    } as AnyEvent);
    this.effects.push({ type: "release_lease" });
  }
}

/** One scheduler step. Pure: the same inputs always give the same events and effects. */
export function step(
  plan: ExecutionPlan,
  state: SchedulerState,
  trigger: Trigger,
  ctx: StepContext,
): StepResult {
  const st = new Stepper(plan, state, ctx);
  if (!st.terminal) {
    switch (trigger.type) {
      case "start":
        st.start();
        break;
      case "resume":
        break;
      case "node_result":
      case "delegated_result":
        st.nodeResult(trigger.nodeRunId, trigger.result);
        break;
      case "batch_result":
        for (const [nodeRunId, result] of Object.entries(trigger.results))
          st.nodeResult(nodeRunId, result);
        break;
      case "timer":
        st.timer(trigger.timerId);
        break;
      case "human_response":
        st.humanResponse(trigger.humanTaskId, trigger.response, trigger.by);
        break;
      case "event":
        st.event(trigger.eventName, trigger.payload);
        break;
      case "subflow_completed":
        st.subflowCompleted(trigger.childRunId, trigger.status, trigger.output, trigger.error);
        break;
      case "cancel":
        st.cancel(trigger.by, trigger.reason);
        break;
      case "recovered":
        st.recovered(trigger.lostNodeRunIds);
        break;
    }
    st.process();
  }
  return { state: st.s, events: st.events, effects: st.effects };
}
