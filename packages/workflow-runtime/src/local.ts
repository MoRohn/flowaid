/**
 * `runLocally(definitionOrPlan, opts)` (CODE_EXPORT.md §2): the whole runtime in one process —
 * the same Orchestrator, reducer, events and accounting as a server run, over the memory stores,
 * with real in-process timers. It is what an exported workflow package and `flowaid workflow run
 * --local` call. There are no defaults for `nodes` and `providers`: the caller wires them in, so
 * this package never imports node or provider implementations.
 */
import { uuidv7 } from "@flowaid/shared";
import { toManifest } from "@flowaid/node-sdk";
import type { NodePackage } from "@flowaid/node-sdk";
import type { ProviderRegistry } from "@flowaid/providers";
import { buildTimeline, type TraceSpan } from "@flowaid/observability";
import { compile, COMPILER_VERSION } from "@flowaid/workflow-compiler";
import {
  ExecutionPlanSchema,
  type DurableRunEvent,
  type ErrorInfo,
  type ExecutionPlan,
  type HumanRequest,
  type HumanResponse,
  type JsonValue,
  type NodeCatalog,
  type NodeRun,
  type Run,
  type RunEventOf,
  type RunStatus,
  type SafeFetch,
  type TokenUsage,
  type WorkflowDefinition,
} from "@flowaid/workflow-core";
import { NodeRegistry, type NodeServices } from "./executor.js";
import { Orchestrator } from "./orchestrator.js";
import { registryProviderAccess } from "./providers.js";
import type { RecordedOutput } from "./step.js";
import { MemoryEventBus, MemoryQueueDriver, MemoryRunStore } from "./testing/memory.js";

export interface LocalRunOptions {
  input: JsonValue;
  /** REQUIRED: node packages, e.g. `[corePackage]` from @flowaid/nodes-core. */
  nodes: readonly NodePackage[];
  /** REQUIRED: built by the caller from provider-* factories. */
  providers: ProviderRegistry;
  /** Secret values keyed by the workflow's secret names. */
  secrets?: Readonly<Record<string, string>>;
  variables?: Readonly<Record<string, JsonValue>>;
  /** Live stream: the durable events, as the API streams them over SSE. */
  onEvent?: (event: DurableRunEvent) => void;
  /** Answers human tasks; without it the run stops at `waiting_for_human`. */
  human?: (request: HumanRequest) => Promise<HumanResponse>;
  /** Recorded replay. */
  recorded?: ReadonlyMap<string, RecordedOutput>;
  signal?: AbortSignal;
  /** Network access for nodes and providers (default: the global fetch). */
  http?: SafeFetch;
  /** Other services (state, artifacts, tools). */
  services?: Omit<NodeServices, "providers" | "credentials" | "http">;
  /** Plans of subflows by workflow id (and version id when pinned). */
  subflows?: (
    workflowId: string,
    versionId: string | null,
  ) => ExecutionPlan | WorkflowDefinition | undefined;
}

export interface LocalRunResult {
  runId: string;
  status: RunStatus;
  output: JsonValue | null;
  outcome: string | null;
  error: ErrorInfo | null;
  events: DurableRunEvent[];
  nodeRuns: NodeRun[];
  trace: TraceSpan[];
  usage: TokenUsage;
  costUsd: number;
}

const WORKSPACE = "00000000-0000-4000-8000-00000000f10a";
const ENVIRONMENT = "00000000-0000-4000-8000-00000000f10e";

/** A catalog over the manifests of node packages (for compiling definitions locally). */
export function catalogOfPackages(packages: readonly Pick<NodePackage, "nodes">[]): NodeCatalog {
  const manifests = packages.flatMap((p) => p.nodes.map((n) => toManifest(n)));
  return {
    get: (id, version) =>
      version
        ? manifests.find((m) => m.id === id && m.version === version)
        : manifests.filter((m) => m.id === id).sort((a, b) => (a.version < b.version ? 1 : -1))[0],
    list: () => [...manifests],
  };
}

function toPlan(source: ExecutionPlan | WorkflowDefinition, catalog: NodeCatalog): ExecutionPlan {
  if ("planHash" in source) return ExecutionPlanSchema.parse(source);
  const result = compile(source, {
    catalog,
    level: "publish",
    compilerVersion: COMPILER_VERSION,
  } as never);
  if (!result.ok) {
    const errors = result.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => `${d.code}: ${d.message}`);
    throw new Error(`The workflow does not compile:\n${errors.join("\n")}`);
  }
  return result.plan;
}

/** A credential value from a plain secret: every common field name carries it. */
function secretValue(value: string): Record<string, string> {
  return { apiKey: value, token: value, key: value, value, password: value, dsn: value };
}

export async function runLocally(
  source: WorkflowDefinition | ExecutionPlan,
  opts: LocalRunOptions,
): Promise<LocalRunResult> {
  const catalog = catalogOfPackages(opts.nodes);
  const plan = toPlan(source, catalog);
  const registry = new NodeRegistry(opts.nodes);
  const store = new MemoryRunStore();
  const queue = new MemoryQueueDriver();
  const bus = new MemoryEventBus();
  const secrets = opts.secrets ?? {};
  const http: SafeFetch = opts.http ?? ((url, init) => fetch(url, init));
  const plans = new Map<string, ExecutionPlan>();
  const parentOf = new Map<string, { runId: string; nodeRunId: string }>();

  const secretFor = (
    credentialType: string | undefined,
    candidates: ExecutionPlan,
  ): Record<string, string> | undefined => {
    const decl = candidates.secrets.find(
      (s) => !credentialType || s.credentialType === credentialType,
    );
    const value = decl ? secrets[decl.name] : undefined;
    return value === undefined ? undefined : secretValue(value);
  };

  const services: NodeServices = {
    ...opts.services,
    http: () => http,
    credentials: (call) => {
      const op = call.node.op;
      const slots = op.kind === "task" ? op.credentials : {};
      return {
        has: (slot) => slot in slots && secrets[slots[slot] ?? ""] !== undefined,
        get: (slot) => {
          const name = slots[slot];
          const value = name ? secrets[name] : undefined;
          return value === undefined
            ? Promise.reject(
                new Error(
                  `No secret is bound to credential slot '${slot}' (set secrets.${name ?? slot})`,
                ),
              )
            : Promise.resolve(secretValue(value));
        },
      };
    },
    providers: (call) =>
      registryProviderAccess(opts.providers, call, {
        http,
        credential: (providerId, credentialType) => {
          const value = secretFor(credentialType, plans.get(call.runId) ?? plan);
          return Promise.resolve(value ? { id: `secret:${providerId}`, value } : undefined);
        },
      }),
  };

  const orchestrator = new Orchestrator({
    store,
    queue,
    bus,
    registry,
    services,
    workerId: "local",
    loadPlan: (run) => {
      const p = plans.get(run.id);
      return p ? Promise.resolve(p) : Promise.reject(new Error(`No plan for run ${run.id}`));
    },
    context: () =>
      Promise.resolve({
        vars: opts.variables ?? {},
        ...(opts.recorded ? { recorded: opts.recorded } : {}),
        subflowVersion: (workflowId, versionId) =>
          opts.subflows?.(workflowId, versionId) ? (versionId ?? uuidv7()) : null,
        run: { environment: "local" },
      }),
    onChildRun: async (effect, parent) => {
      const childSource = opts.subflows?.(effect.workflowId, effect.versionId);
      if (!childSource) throw new Error(`No subflow ${effect.workflowId}`);
      const childPlan = toPlan(childSource, catalog);
      parentOf.set(effect.childRunId, { runId: parent.id, nodeRunId: effect.parentNodeRunId });
      await createRun(effect.childRunId, childPlan, effect.input, {
        parentRunId: parent.id,
        parentNodeRunId: effect.parentNodeRunId,
        origin: "subflow",
      });
      await orchestrator.handle(effect.childRunId, { type: "start" });
    },
  });

  async function createRun(
    id: string,
    p: ExecutionPlan,
    input: JsonValue,
    extra: Partial<Run> = {},
  ): Promise<void> {
    plans.set(id, p);
    const now = new Date().toISOString();
    const run: Run = {
      id,
      workspaceId: WORKSPACE,
      workflowId: p.workflowId,
      workflowVersionId: ENVIRONMENT,
      environmentId: ENVIRONMENT,
      status: "queued",
      origin: "api",
      mode: "async",
      input,
      output: null,
      outcome: null,
      error: null,
      parentRunId: null,
      parentNodeRunId: null,
      sourceRunId: null,
      sessionId: null,
      idempotencyKey: null,
      labels: {},
      lastSeq: 1,
      usage: { inputTokens: 0, outputTokens: 0 },
      costUsd: 0,
      nodeRunCount: 0,
      createdAt: now,
      startedAt: null,
      endedAt: null,
      ...extra,
    };
    const created = {
      type: "RUN_CREATED",
      runId: id,
      seq: 1,
      at: now,
      workflowVersionId: run.workflowVersionId,
      environmentId: run.environmentId,
      origin: run.origin,
      mode: run.mode,
      input,
      planHash: p.planHash,
      idempotencyKey: null,
      sourceRunId: null,
    } as RunEventOf<"RUN_CREATED">;
    await store.createRun(run, created);
  }

  const runId = uuidv7();
  let settle: (() => void) | null = null;
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  let pendingHuman = Promise.resolve();

  store.onCommit.add(({ runId: id, fromSeq, toSeq }) => {
    void store.listEvents(id, fromSeq - 1, toSeq - fromSeq + 1).then((events) => {
      for (const e of events) {
        if (id === runId) opts.onEvent?.(e);
        const terminal =
          e.type === "RUN_COMPLETED" ||
          e.type === "RUN_FAILED" ||
          e.type === "RUN_CANCELLED" ||
          e.type === "RUN_TIMED_OUT";
        if (terminal && id === runId) settle?.();
        const parent = parentOf.get(id);
        if (terminal && parent) {
          void store.getRun(id).then((child) =>
            orchestrator.handle(parent.runId, {
              type: "subflow_completed",
              childRunId: id,
              status: child?.status ?? "failed",
              output: child?.output ?? null,
              error: child?.error ?? null,
            }),
          );
        }
        if (e.type === "RUN_WAITING" && e.reason === "human") {
          if (!opts.human) {
            if (id === runId) settle?.();
            continue;
          }
          const human = opts.human;
          pendingHuman = pendingHuman.then(async () => {
            for (const task of store.humanTasksOf(id).filter((t) => t.status === "open")) {
              const response = await human(task.request);
              if (await store.respondHumanTask(task.id, response, "local"))
                await orchestrator.handle(id, { type: "resume" });
            }
          });
        }
      }
    });
  });

  const onAbort = () =>
    void orchestrator.handle(runId, { type: "cancel", by: "local", reason: "aborted" });
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  orchestrator.startMaintenance({ timerPollMs: 20, heartbeatMs: 5_000, reapMs: 60_000 });
  try {
    await createRun(runId, plan, opts.input);
    await orchestrator.handle(runId, { type: "start" });
    await settled;
    await orchestrator.whenIdle(runId);
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    await orchestrator.close();
    await queue.close();
  }
  const run = await store.getRun(runId);
  const events = await store.listEvents(runId, 0, 1_000_000);
  const nodeRuns = await store.listNodeRuns(runId);
  return {
    runId,
    status: run?.status ?? "failed",
    output: run?.output ?? null,
    outcome: run?.outcome ?? null,
    error: run?.error ?? null,
    events,
    nodeRuns,
    trace: run ? buildTimeline(run, nodeRuns, events) : [],
    usage: run?.usage ?? { inputTokens: 0, outputTokens: 0 },
    costUsd: run?.costUsd ?? 0,
  };
}
