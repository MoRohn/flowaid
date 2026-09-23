/**
 * A deterministic in-memory driver for the scheduler: `step()` plus fake executors, a fake clock
 * and in-memory timers, human tasks and child runs. No store, queue or worker — the tool for
 * golden traces of every construct and for node packages testing flows end to end.
 */
import type {
  DurableRunEvent,
  ExecutionPlan,
  HumanRequest,
  HumanResponse,
  JsonObject,
  JsonValue,
  NodeId,
  RunEventOf,
  RunStatus,
  ScopePath,
} from "@flowaid/workflow-core";
import { initialState, type SchedulerState } from "../state.js";
import {
  step,
  type Effect,
  type ExecutorOutcome,
  type RecordedOutput,
  type ResumeInfo,
  type StepContext,
  type TimerSpec,
  type Trigger,
} from "../step.js";
import { seededIds } from "./ids.js";

export interface FakeCall {
  nodeId: NodeId;
  nodeType: string;
  nodeRunId: string;
  scope: ScopePath;
  attempt: number;
  input: JsonObject;
  config: JsonObject;
  resume?: ResumeInfo;
  now: string;
}
export type FakeExecutor = (call: FakeCall) => ExecutorOutcome | Promise<ExecutorOutcome>;

export interface SimulationOptions {
  plan: ExecutionPlan;
  input: JsonValue;
  /** Executors keyed by node id (checked first) or node type id. */
  executors?: Record<string, FakeExecutor>;
  runId?: string;
  seed?: number;
  /** Start of the fake clock (default 2026-09-23T10:00:00Z). */
  start?: string;
  /** Hold executions until `runPending()` (tests of concurrency, races and crashes). */
  manual?: boolean;
  context?: Partial<Omit<StepContext, "ids" | "now" | "workerId">>;
}

/** An ok result with the given output. */
export const okResult = (
  output: JsonObject,
  extra: Partial<Extract<ExecutorOutcome, { kind: "ok" }>> = {},
): ExecutorOutcome => ({
  kind: "ok",
  output,
  latencyMs: 5,
  ...extra,
});

export class Simulation {
  state: SchedulerState;
  readonly events: DurableRunEvent[] = [];
  readonly effects: Effect[] = [];
  readonly timers = new Map<string, TimerSpec>();
  readonly humanTasks = new Map<string, { nodeRunId: string; request: HumanRequest }>();
  readonly childRuns: Extract<Effect, { type: "enqueue_child_run" }>[] = [];
  readonly aborted = new Set<string>();
  readonly calls: FakeCall[] = [];
  readonly pending: Extract<Effect, { type: "execute" }>[] = [];
  clock: number;
  private readonly ids;
  private readonly runId: string;

  constructor(private readonly options: SimulationOptions) {
    this.runId = options.runId ?? "00000000-0000-4000-8000-00000000abcd";
    this.ids = seededIds(options.seed ?? 1);
    this.clock = Date.parse(options.start ?? "2026-09-23T10:00:00.000Z");
    this.state = initialState(options.plan, this.runId, options.input);
    const created = {
      type: "RUN_CREATED",
      runId: this.runId,
      seq: 1,
      at: this.now(),
      workflowVersionId: "00000000-0000-4000-8000-0000000000f1",
      environmentId: "00000000-0000-4000-8000-0000000000e1",
      origin: "api",
      mode: "async",
      input: options.input,
      planHash: options.plan.planHash,
      idempotencyKey: null,
      sourceRunId: null,
    } as RunEventOf<"RUN_CREATED">;
    this.events.push(created);
    this.state = { ...this.state, run: { ...this.state.run, lastSeq: 1 } };
  }

  now(): string {
    return new Date(this.clock).toISOString();
  }

  get status(): RunStatus {
    return this.state.run.status;
  }

  /** Events of one type. */
  of<T extends DurableRunEvent["type"]>(type: T): RunEventOf<T>[] {
    return this.events.filter((e): e is RunEventOf<T> => e.type === type);
  }

  types(): string[] {
    return this.events.map((e) => e.type);
  }

  async start(): Promise<this> {
    await this.trigger({ type: "start" });
    return this;
  }

  async trigger(trigger: Trigger): Promise<void> {
    const ctx: StepContext = {
      ids: this.ids,
      now: this.now(),
      workerId: "sim-worker",
      ...this.options.context,
    };
    const result = step(this.options.plan, this.state, trigger, ctx);
    this.state = result.state;
    this.events.push(...result.events);
    this.effects.push(...result.effects);
    for (const effect of result.effects) await this.perform(effect);
  }

  private executorFor(nodeId: NodeId): FakeExecutor | undefined {
    const node = this.options.plan.nodes[nodeId];
    const type = node?.op.kind === "task" ? node.op.type : "";
    return this.options.executors?.[nodeId] ?? this.options.executors?.[type];
  }

  private async perform(effect: Effect): Promise<void> {
    switch (effect.type) {
      case "execute":
        if (this.options.manual) this.pending.push(effect);
        else await this.execute(effect);
        return;
      case "execute_batch":
        return;
      case "delegate": {
        const at = this.state.nodeRuns[effect.nodeRunId];
        if (!at) return;
        const result = await this.run({
          type: "execute",
          scope: at.scope,
          nodeId: at.nodeId,
          nodeRunId: effect.nodeRunId,
          input: {},
          config: {},
        });
        await this.trigger({ type: "delegated_result", nodeRunId: effect.nodeRunId, result });
        return;
      }
      case "set_timer":
        this.timers.set(effect.timer.id, effect.timer);
        return;
      case "cancel_timer":
        this.timers.delete(effect.timerId);
        return;
      case "create_human_task":
        this.humanTasks.set(effect.humanTaskId, {
          nodeRunId: effect.nodeRunId,
          request: effect.request,
        });
        return;
      case "enqueue_child_run":
        this.childRuns.push(effect);
        return;
      case "cancel_child_run":
        return;
      case "abort_node":
        this.aborted.add(effect.nodeRunId);
        return;
      case "release_lease":
        return;
    }
  }

  private async run(effect: Extract<Effect, { type: "execute" }>): Promise<ExecutorOutcome> {
    const node = this.options.plan.nodes[effect.nodeId];
    const call: FakeCall = {
      nodeId: effect.nodeId,
      nodeType: node?.op.kind === "task" ? node.op.type : (node?.kind ?? ""),
      nodeRunId: effect.nodeRunId,
      scope: effect.scope,
      attempt: this.state.scopes[effect.scope]?.nodes[effect.nodeId]?.attempt ?? 1,
      input: effect.input,
      config: effect.config,
      ...(effect.resume ? { resume: effect.resume } : {}),
      now: this.now(),
    };
    this.calls.push(call);
    const executor = this.executorFor(effect.nodeId);
    if (executor) return executor(call);
    // flowaid.data.transform: the runtime already evaluated `config.expr`; the node returns it.
    if (call.nodeType === "flowaid.data.transform")
      return { kind: "ok", output: { result: effect.config.expr ?? null }, latencyMs: 1 };
    return { kind: "ok", output: {}, latencyMs: 1 };
  }

  private async execute(effect: Extract<Effect, { type: "execute" }>): Promise<void> {
    const result = await this.run(effect);
    await this.trigger({ type: "node_result", nodeRunId: effect.nodeRunId, result });
  }

  /** Runs held executions (manual mode), optionally only those matching. */
  async runPending(
    filter: (e: Extract<Effect, { type: "execute" }>) => boolean = () => true,
  ): Promise<void> {
    const chosen = this.pending.filter(filter);
    for (const e of chosen) this.pending.splice(this.pending.indexOf(e), 1);
    for (const e of chosen) if (!this.aborted.has(e.nodeRunId)) await this.execute(e);
  }

  /** Advances the clock, firing due timers in time order. */
  async advance(ms: number): Promise<void> {
    const until = this.clock + ms;
    for (;;) {
      const due = [...this.timers.values()]
        .filter((t) => Date.parse(t.fireAt) <= until)
        .sort((a, b) => Date.parse(a.fireAt) - Date.parse(b.fireAt) || (a.id < b.id ? -1 : 1))[0];
      if (!due) break;
      this.clock = Math.max(this.clock, Date.parse(due.fireAt));
      this.timers.delete(due.id);
      await this.trigger({ type: "timer", timerId: due.id });
    }
    this.clock = until;
  }

  /** Responds to the open human task of a node. */
  async respond(nodeId: NodeId, response: HumanResponse, by = "user:tester"): Promise<void> {
    const entry = [...this.humanTasks.entries()].find(
      ([, t]) => this.state.nodeRuns[t.nodeRunId]?.nodeId === nodeId,
    );
    if (!entry) throw new Error(`no human task for ${nodeId}`);
    await this.trigger({ type: "human_response", humanTaskId: entry[0], response, by });
  }

  async sendEvent(eventName: string, payload: JsonValue): Promise<void> {
    await this.trigger({ type: "event", eventName, payload });
  }

  async finishChild(
    childRunId: string,
    status: RunStatus,
    output: JsonValue | null = null,
  ): Promise<void> {
    await this.trigger({
      type: "subflow_completed",
      childRunId,
      status,
      output,
      error:
        status === "completed"
          ? null
          : { code: "SUBFLOW_ERROR", message: `child ${status}`, retryable: false },
    });
  }

  async cancel(by = "user:tester", reason: string | null = null): Promise<void> {
    await this.trigger({ type: "cancel", by, reason });
  }

  /** Output events of every node, keyed `scope|nodeId` → status (for compact assertions). */
  statuses(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const sc of Object.values(this.state.scopes))
      for (const [nodeId, n] of Object.entries(sc.nodes))
        out[sc.path ? `${sc.path}/${nodeId}` : nodeId] = n.status;
    return out;
  }
}

export async function simulate(options: SimulationOptions): Promise<Simulation> {
  return new Simulation(options).start();
}

export type { RecordedOutput };
