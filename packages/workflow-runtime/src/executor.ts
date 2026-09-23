/**
 * Task execution (ARCHITECTURE.md §3.1–§3.2, §5.8): the runtime — never the node — validates
 * config and input before `execute()` and the output after it, builds the capability-scoped
 * `ctx`, and bounds the call with the run's abort signal and the node timeout. Everything the
 * node reports (logs, metrics, provider and tool calls) comes back as events on the outcome;
 * executors never see scheduler state.
 */
import type { z } from "zod";
import { scopeContext } from "@flowaid/node-sdk";
import type {
  AnyNodeDefinition,
  ArtifactAccess,
  CredentialAccess,
  ExecutionContext,
  NodeLogger,
  NodePackage,
  ProviderAccess,
  StateAccess,
  ToolAccess,
} from "@flowaid/node-sdk";
import {
  CredentialError,
  NotFoundError,
  OutputSchemaMismatchError,
  SchemaValidationError,
  TimeoutError,
  toFlowaidError,
  type ExecutionPlan,
  type JsonObject,
  type JsonValue,
  type PlanNode,
  type ProviderHop,
  type RunOrigin,
  type SafeFetch,
  type ScopePath,
} from "@flowaid/workflow-core";
import type { ExecutorOutcome, NodeEmitted, ResumeInfo } from "./step.js";

/** Node definitions by `(type, version)`, from node packages. Immutable after construction. */
export class NodeRegistry {
  private readonly byKey = new Map<string, AnyNodeDefinition>();

  constructor(
    packages: readonly Pick<NodePackage, "nodes">[] = [],
    nodes: readonly AnyNodeDefinition[] = [],
  ) {
    for (const def of [...packages.flatMap((p) => p.nodes), ...nodes]) {
      const key = `${def.id}@${def.version}`;
      if (this.byKey.has(key)) throw new Error(`Node ${key} is registered twice`);
      this.byKey.set(key, def);
    }
  }

  get(type: string, version: string): AnyNodeDefinition | undefined {
    return this.byKey.get(`${type}@${version}`);
  }

  has(type: string, version: string): boolean {
    return this.byKey.has(`${type}@${version}`);
  }

  list(): AnyNodeDefinition[] {
    return [...this.byKey.values()];
  }
}

/** What an execution is about (handed to service factories). */
export interface ExecutionCall {
  runId: string;
  workspaceId: string;
  workflowId: string;
  workflowVersionId: string;
  environmentId: string;
  environment: string;
  origin: RunOrigin;
  startedAt: string;
  sessionId: string | null;
  nodeRunId: string;
  node: PlanNode;
  scope: ScopePath;
  attempt: number;
  idempotencyKey: string | null;
  vars: Readonly<Record<string, JsonValue>>;
  iteration: ExecutionContext["scope"];
  signal: AbortSignal;
  /** Sink for provider and tool events (DECISION_COMPLETED, TOOL_CALLED, …). */
  emit: (event: NodeEmitted) => void;
  /** GENERATION_DELTA fan-out (ephemeral, not persisted). */
  onDelta?: (channel: "text" | "thinking" | "tool_args", delta: string) => void;
  budget: {
    remainingCostUsd: number | null;
    remainingTokens: number | null;
    deadlineAt: string | null;
  };
  /** The workflow's decision chain ([primary, ...failover]); used when a node passes an empty chain. */
  decisions?: readonly ProviderHop[];
}

/** Services the host (worker, CLI, tests) supplies. Missing services behave as undeclared. */
export interface NodeServices {
  credentials?: (call: ExecutionCall) => CredentialAccess;
  providers?: (call: ExecutionCall) => ProviderAccess;
  tools?: (call: ExecutionCall) => ToolAccess;
  state?: (call: ExecutionCall) => StateAccess;
  artifacts?: (call: ExecutionCall) => ArtifactAccess;
  http?: (call: ExecutionCall) => SafeFetch;
  clock?: () => Date;
}

const unavailable = (what: string) => () =>
  Promise.reject(new CredentialError(`${what} is not available in this runtime`));

function issuesOf(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((i) => ({
    path: `/${i.path.map(String).join("/")}`,
    message: i.message,
  }));
}

export interface ExecuteRequest {
  call: ExecutionCall;
  input: JsonObject;
  config: JsonObject;
  resume?: ResumeInfo;
}

/** Runs one task node. Never throws: every failure is an `error` outcome. */
export async function executeTask(
  plan: ExecutionPlan,
  registry: NodeRegistry,
  services: NodeServices,
  request: ExecuteRequest,
): Promise<ExecutorOutcome> {
  const { call } = request;
  const clock = services.clock ?? (() => new Date());
  const started = clock().getTime();
  const events: NodeEmitted[] = [];
  const latency = () => Math.max(0, clock().getTime() - started);
  const fail = (error: unknown): ExecutorOutcome => ({
    kind: "error",
    error: toFlowaidError(error).toInfo({
      runId: call.runId,
      nodeId: call.node.id,
      nodeRunId: call.nodeRunId,
    }),
    latencyMs: latency(),
    events,
  });
  const op = call.node.op;
  if (op.kind !== "task") return fail(new Error(`${call.node.id} is not a task node`));
  const def = registry.get(op.type, op.typeVersion);
  if (!def)
    return fail(
      new NotFoundError(
        `No executor for ${op.type}@${op.typeVersion}; install the node package that provides it`,
      ),
    );

  const config = def.configSchema.safeParse(request.config);
  if (!config.success)
    return fail(
      new SchemaValidationError(
        `${call.node.id}: config does not match ${op.type}`,
        issuesOf(config.error),
      ),
    );
  const input = def.inputSchema.safeParse(request.input);
  if (!input.success)
    return fail(
      new SchemaValidationError(
        `${call.node.id}: input does not match ${op.type}`,
        issuesOf(input.error),
      ),
    );

  const timeout = AbortSignal.timeout(call.node.policy.timeoutMs);
  const signal = AbortSignal.any([call.signal, timeout]);
  const emit = (e: NodeEmitted) => {
    events.push(e);
  };
  const logAt =
    (level: "debug" | "info" | "warn" | "error") =>
    (message: string, data?: JsonValue): void => {
      emit({
        type: "LOG",
        level,
        message: message.slice(0, 4000),
        data: data ?? null,
      });
    };
  const logger: NodeLogger = {
    debug: logAt("debug"),
    info: logAt("info"),
    warn: logAt("warn"),
    error: logAt("error"),
  };
  const scopedCall: ExecutionCall = { ...call, signal, emit };
  const deadline = call.budget.deadlineAt
    ? Date.parse(call.budget.deadlineAt) - clock().getTime()
    : call.node.policy.timeoutMs;
  const ctx: ExecutionContext = {
    run: {
      id: call.runId,
      workflowId: call.workflowId,
      workflowVersionId: call.workflowVersionId,
      environmentId: call.environmentId,
      environment: call.environment,
      workspaceId: call.workspaceId,
      origin: call.origin,
      startedAt: call.startedAt,
      sessionId: call.sessionId,
    },
    node: {
      id: call.node.id,
      name: call.node.name,
      type: op.type,
      scope: call.scope,
      attempt: call.attempt,
      nodeRunId: call.nodeRunId,
      idempotencyKey: call.idempotencyKey,
      idempotency: call.node.idempotency,
    },
    config: config.data as JsonObject,
    vars: call.vars,
    scope: call.iteration,
    signal,
    logger,
    credentials: services.credentials?.(scopedCall) ?? {
      get: unavailable("Credentials"),
      has: () => false,
    },
    providers: services.providers?.(scopedCall) ?? {
      decision: () => {
        throw new CredentialError("No decision providers are configured");
      },
      generation: () => {
        throw new CredentialError("No generation providers are configured");
      },
      embedding: () => {
        throw new CredentialError("No embedding providers are configured");
      },
    },
    tools: services.tools?.(scopedCall) ?? {
      list: () => Promise.resolve([]),
      call: unavailable("Tools"),
    },
    state: services.state?.(scopedCall) ?? {
      get: unavailable("State"),
      set: unavailable("State"),
      cas: unavailable("State"),
    },
    artifacts: services.artifacts?.(scopedCall) ?? {
      put: unavailable("Artifacts"),
      get: unavailable("Artifacts"),
      url: unavailable("Artifacts"),
    },
    events: {
      emit: (e) =>
        emit({ ...e, ...(e.type === "METRIC" ? { labels: e.labels ?? {} } : {}) } as NodeEmitted),
      stream: (channel, delta) => call.onDelta?.(channel, delta),
    },
    budget: {
      remainingCostUsd: call.budget.remainingCostUsd,
      remainingTokens: call.budget.remainingTokens,
      remainingMs: Math.max(0, Math.min(deadline, call.node.policy.timeoutMs)),
    },
    http:
      services.http?.(scopedCall) ??
      (() => Promise.reject(new CredentialError("Network access is not configured"))),
    clock: { now: clock },
    ...(request.resume ? { resume: request.resume } : {}),
  };

  try {
    const result = await Promise.race([
      def.execute(scopeContext(ctx, def.capabilities), input.data),
      new Promise<never>((_, reject) => {
        const onAbort = () =>
          reject(
            timeout.aborted
              ? new TimeoutError(
                  `${call.node.id} exceeded its ${call.node.policy.timeoutMs} ms timeout`,
                )
              : toFlowaidError(signal.reason ?? new Error("aborted")),
          );
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
    switch (result.kind) {
      case "error":
        return fail(result.error);
      case "suspend": {
        // Decision nodes may suspend without the capability: that is the human hop of their chain.
        const failover =
          def.decision !== undefined &&
          result.wait.kind === "human" &&
          !def.capabilities.includes("suspend");
        if (!failover && !def.capabilities.includes("suspend"))
          return fail(
            new SchemaValidationError(
              `${call.node.id} suspended without the 'suspend' capability`,
              [{ path: "/capabilities", message: "missing suspend" }],
            ),
          );
        return {
          kind: "suspend",
          wait: result.wait,
          state: result.state,
          ...(failover ? { failover: true } : {}),
          latencyMs: latency(),
          events,
        };
      }
      case "ok": {
        const output = def.outputSchema.safeParse(result.output);
        if (!output.success)
          return fail(
            new OutputSchemaMismatchError(`${call.node.id}: output does not match ${op.type}`, {
              issues: issuesOf(output.error),
            }),
          );
        if (result.decision && !events.some((e) => e.type === "DECISION_COMPLETED")) {
          emit({
            type: "DECISION_COMPLETED",
            batchId: call.nodeRunId,
            question: call.node.name,
            decision: result.decision,
            priceSnapshot: null,
          });
        }
        return {
          kind: "ok",
          output: output.data as JsonObject,
          ...(result.route ? { route: result.route } : {}),
          ...(result.usage ? { usage: result.usage } : {}),
          ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
          ...(result.decision ? { decision: result.decision } : {}),
          latencyMs: latency(),
          events,
        };
      }
    }
  } catch (error) {
    if (timeout.aborted && !call.signal.aborted)
      return fail(
        new TimeoutError(`${call.node.id} exceeded its ${call.node.policy.timeoutMs} ms timeout`),
      );
    return fail(error);
  }
}
