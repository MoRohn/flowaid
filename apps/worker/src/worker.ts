/**
 * The worker (ARCHITECTURE.md §5, §8): consumes `run:general` (start, resume, signals) and
 * `run:control` (cancel), drives the Orchestrator over Postgres with the core nodes, providers,
 * tools, state, artifacts and the sandbox, completes subflows back into their parents, fans
 * generation deltas out on `run_deltas`, and runs maintenance (timers, leases, cancels) and the
 * scheduler.
 */
import { and, eq } from "drizzle-orm";
import type { CredentialService } from "@flowaid/credentials";
import {
  PgCredentialRepository,
  PgRunStore,
  RUN_EVENTS_CHANNEL,
  environments,
  runs,
  workflowDeployments,
  workflowVersions,
  type Database,
} from "@flowaid/database";
import { McpSessionPool, connectSession, type StdioPolicy } from "@flowaid/mcp";
import type { NodePackage } from "@flowaid/node-sdk";
import { coreNodes } from "@flowaid/nodes-core";
import { DefaultModelCatalog, ProviderRegistry, rerankFactories } from "@flowaid/providers";
import { anthropicFactory } from "@flowaid/provider-anthropic";
import { ollamaEmbeddingFactory, ollamaFactory } from "@flowaid/provider-ollama";
import { openaiFactories } from "@flowaid/provider-openai";
import { typesafeFactory } from "@flowaid/provider-typesafe";
import { uuidv7 } from "@flowaid/shared";
import type {
  DecisionProvider,
  EventBus,
  ExecutionPlan,
  Job,
  QueueDriver,
  Run,
  RunEventOf,
  SafeFetch,
  SandboxExecutor,
} from "@flowaid/workflow-core";
import {
  NodeRegistry,
  Orchestrator,
  createEventRedactor,
  downstreamOf,
  registryProviderAccess,
  type NodeServices,
} from "@flowaid/workflow-runtime";
import { artifactAccessFor } from "./services/artifacts.js";
import {
  RunCredentialCache,
  credentialAccessFor,
  providerCredential,
  type ServerKeys,
} from "./services/credentials.js";
import { stateAccessFor } from "./services/state.js";
import { toolAccessFor } from "./services/tools.js";
import { runEvaluationJob } from "./jobs/evaluation.js";
import { runExportJob } from "./jobs/export.js";

export interface WorkerLogger {
  info(data: Record<string, unknown>, msg: string): void;
  warn(data: Record<string, unknown>, msg: string): void;
  error(data: Record<string, unknown>, msg: string): void;
}

export interface WorkerDeps {
  db: Database;
  queue: QueueDriver;
  bus: EventBus;
  credentials: CredentialService;
  http: SafeFetch;
  artifactsDir: string;
  serverKeys?: ServerKeys;
  /** replaces the default provider registry (tests) */
  registry?: ProviderRegistry;
  nodes?: readonly NodePackage[];
  sandbox?: SandboxExecutor;
  stdioPolicy?: StdioPolicy;
  workerId?: string;
  concurrency?: number;
  allowPrivateNetwork?: boolean;
  log?: WorkerLogger;
  /** judge provider and timing for evaluation runs */
  evaluation?: { judge?: DecisionProvider; caseTimeoutMs?: number; pollMs?: number };
  maintenance?: { timerPollMs?: number; heartbeatMs?: number; reapMs?: number };
  /** code export (`export.package` on the `jobs` queue): FLOWAID_VENDOR_DIR for vendored mode */
  exports?: { vendorDir?: string | null };
}

const TERMINAL = new Set(["RUN_COMPLETED", "RUN_FAILED", "RUN_CANCELLED", "RUN_TIMED_OUT"]);
const silent: WorkerLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function defaultProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry({ catalog: new DefaultModelCatalog() });
  registry.register(typesafeFactory());
  for (const f of openaiFactories()) registry.register(f);
  registry.register(anthropicFactory());
  registry.register(ollamaFactory());
  registry.register(ollamaEmbeddingFactory());
  for (const f of rerankFactories()) registry.register(f);
  return registry;
}

export interface Worker {
  readonly id: string;
  readonly orchestrator: Orchestrator;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** jobs handled so far (diagnostics, tests) */
  readonly handled: number;
}

export function createWorker(deps: WorkerDeps): Worker {
  const log = deps.log ?? silent;
  const workerId = deps.workerId ?? `worker-${uuidv7().slice(-12)}`;
  const store = new PgRunStore(deps.db);
  const repo = new PgCredentialRepository(deps.db);
  const cache = new RunCredentialCache(deps.credentials);
  const providers = deps.registry ?? defaultProviderRegistry();
  const pool = new McpSessionPool({
    connect: (server, credential, signal) =>
      connectSession(server, credential, {
        fetch: deps.http,
        ...(deps.stdioPolicy ? { stdioPolicy: deps.stdioPolicy } : {}),
        ...(signal ? { signal } : {}),
        timeoutMs: 30_000,
      }),
  });
  const plans = new Map<string, ExecutionPlan>();
  const registry = new NodeRegistry([...(deps.nodes ?? [coreNodes])]);
  const serverKeys = deps.serverKeys ?? {};

  const planOf = async (run: Run): Promise<ExecutionPlan> => {
    const cached = plans.get(run.workflowVersionId);
    if (cached) return cached;
    const [v] = await deps.db.system((tx) =>
      tx
        .select({ plan: workflowVersions.plan })
        .from(workflowVersions)
        .where(eq(workflowVersions.id, run.workflowVersionId)),
    );
    if (!v) throw new Error(`version ${run.workflowVersionId} of run ${run.id} not found`);
    if (plans.size > 500) plans.clear();
    plans.set(run.workflowVersionId, v.plan);
    return v.plan;
  };

  const services: NodeServices = {
    credentials: (call) => credentialAccessFor(call, repo, cache),
    providers: (call) =>
      registryProviderAccess(providers, call, {
        http: deps.http,
        credential: providerCredential(
          call,
          plans.get(call.workflowVersionId),
          repo,
          cache,
          serverKeys,
        ),
      }),
    tools: (call) =>
      toolAccessFor(
        {
          db: deps.db,
          pool,
          http: deps.http,
          repo,
          cache,
          workflows: { queue: deps.queue },
          ...(deps.allowPrivateNetwork ? { allowPrivateNetwork: true } : {}),
        },
        call,
      ),
    state: (call) => stateAccessFor(deps.db, call),
    artifacts: (call) => artifactAccessFor(deps.db, deps.artifactsDir, call),
    http: () => deps.http,
    ...(deps.sandbox ? { sandbox: deps.sandbox } : {}),
  };

  const orchestrator = new Orchestrator({
    store,
    queue: deps.queue,
    bus: deps.bus,
    registry,
    services,
    workerId,
    pool: "general",
    loadPlan: planOf,
    redact: createEventRedactor(deps.credentials.redactor),
    context: async (run) => {
      const { env, deployments, variables, source } = await deps.db.system(async (tx) => {
        const [e] = await tx
          .select()
          .from(environments)
          .where(eq(environments.id, run.environmentId));
        const d = await tx
          .select()
          .from(workflowDeployments)
          .where(
            and(
              eq(workflowDeployments.environmentId, run.environmentId),
              eq(workflowDeployments.active, true),
            ),
          );
        const [r] = await tx
          .select({ variables: runs.variables, replay: runs.replay, sourceRunId: runs.sourceRunId })
          .from(runs)
          .where(eq(runs.id, run.id));
        return { env: e, deployments: d, variables: r?.variables ?? {}, source: r };
      });
      const own = deployments.find((d) => d.workflowId === run.workflowId);
      const deployedVersion = new Map(deployments.map((d) => [d.workflowId, d.versionId]));
      // Recorded replay, restart-from-node and fork (§5.9): reuse the source run's node results.
      const replay = source?.replay;
      const recorded =
        replay && source.sourceRunId ? await store.recordedOutputs(source.sourceRunId) : null;
      const neverReuse = replay?.fromNodeId
        ? downstreamOf(await planOf(run), replay.fromNodeId)
        : null;
      return {
        ...(recorded ? { recorded } : {}),
        ...(neverReuse ? { neverReuse } : {}),
        ...(replay?.inputOverrides.length ? { inputOverrides: replay.inputOverrides } : {}),
        vars: {
          ...(env?.variables ?? {}),
          ...(own?.variableOverrides ?? {}),
          ...variables,
        },
        run: { environment: env?.name ?? "unknown" },
        subflowVersion: (workflowId, versionId) =>
          versionId ?? deployedVersion.get(workflowId) ?? null,
      };
    },
    onChildRun: async (effect, parent) => {
      const versionId = effect.versionId;
      if (!versionId)
        throw new Error(`subflow ${effect.workflowId} has no deployed version in this environment`);
      const [v] = await deps.db.system((tx) =>
        tx.select().from(workflowVersions).where(eq(workflowVersions.id, versionId)),
      );
      if (!v) throw new Error(`subflow version ${versionId} not found`);
      const now = new Date().toISOString();
      const child: Run = {
        id: effect.childRunId,
        workspaceId: parent.workspaceId,
        workflowId: effect.workflowId,
        workflowVersionId: versionId,
        environmentId: parent.environmentId,
        status: "queued",
        origin: "subflow",
        mode: "async",
        input: effect.input,
        output: null,
        outcome: null,
        error: null,
        parentRunId: parent.id,
        parentNodeRunId: effect.parentNodeRunId,
        sourceRunId: null,
        sessionId: parent.sessionId,
        idempotencyKey: null,
        labels: {},
        lastSeq: 1,
        usage: { inputTokens: 0, outputTokens: 0 },
        costUsd: 0,
        nodeRunCount: 0,
        createdAt: now,
        startedAt: null,
        endedAt: null,
      };
      const created = {
        type: "RUN_CREATED",
        runId: child.id,
        seq: 1,
        at: now,
        workflowVersionId: versionId,
        environmentId: parent.environmentId,
        origin: "subflow",
        mode: "async",
        input: effect.input,
        planHash: v.planHash,
        idempotencyKey: null,
        sourceRunId: null,
      } as RunEventOf<"RUN_CREATED">;
      await store.createRun(child, created);
      await deps.queue.enqueue(
        "run:general",
        { type: "run.start", runId: child.id },
        { jobId: `run.start:${child.id}` },
      );
    },
    onCancelChild: async (childRunId) => {
      await store.requestCancel(childRunId, `parent`, "parent cancelled");
      await deps.queue.enqueue("run:control", {
        type: "run.control",
        runId: childRunId,
        action: "cancel",
        by: "parent",
        reason: "parent cancelled",
      });
    },
    onDelta: (runId, nodeRunId, channel, delta) => {
      void deps.bus
        .publish("run_deltas", {
          runId,
          event: {
            type: "GENERATION_DELTA",
            runId,
            nodeRunId,
            channel,
            delta,
            seq: 0,
            at: new Date().toISOString(),
            ephemeral: true,
          },
        })
        .catch(() => undefined);
    },
    onError: (error, context) =>
      log.error(
        { err: error instanceof Error ? error.message : String(error), ...context },
        "orchestrator error",
      ),
  });

  let handled = 0;
  const handle = async (job: Job): Promise<void> => {
    handled++;
    switch (job.type) {
      case "run.start":
        await orchestrator.handle(job.runId, { type: "start" });
        return;
      case "run.resume":
        // Retry-node (§5.9): the API reopened the failed run; retry its failed nodes.
        await orchestrator.handle(
          job.runId,
          job.reason === "manual_retry" ? { type: "manual_retry", by: "api" } : { type: "resume" },
        );
        return;
      case "run.control":
        await orchestrator.handle(job.runId, { type: "cancel", by: job.by, reason: job.reason });
        return;
      case "run.signal":
        if (job.signal.type === "event")
          await orchestrator.handle(job.runId, {
            type: "event",
            eventName: job.signal.eventName,
            payload: job.signal.payload,
          });
        else if (job.signal.type === "subflow_completed")
          await completeChild(job.signal.childRunId);
        return;
      case "timer.fire":
        await orchestrator.handle(job.runId, { type: "timer", timerId: job.timerId });
        return;
      case "node.exec":
      case "schedule.tick":
      case "ingest.source":
      case "evaluation.run":
      case "trace_review.run":
      case "export.package":
      case "retention.sweep":
      case "partition.ensure":
      case "draft_versions.gc":
        log.warn({ type: job.type }, "job type not handled by this worker");
        return;
    }
  };

  /** A finished child run reports back to its parent's subflow node. */
  const completeChild = async (childRunId: string) => {
    const child = await store.getRun(childRunId);
    if (!child?.parentRunId) return;
    await orchestrator.handle(child.parentRunId, {
      type: "subflow_completed",
      childRunId,
      status: child.status,
      output: child.output,
      error: child.error,
    });
  };

  const stops: (() => Promise<void>)[] = [];
  return {
    id: workerId,
    orchestrator,
    get handled() {
      return handled;
    },
    async start() {
      const concurrency = deps.concurrency ?? 8;
      const general = await deps.queue.consume("run:general", handle, { concurrency });
      const control = await deps.queue.consume("run:control", handle, { concurrency: 2 });
      const evaluation = await deps.queue.consume(
        "evaluation",
        async (job) => {
          if (job.type === "evaluation.run")
            await runEvaluationJob(
              { db: deps.db, queue: deps.queue, ...(deps.evaluation ?? {}) },
              job.evaluationRunId,
            );
        },
        { concurrency: 2 },
      );
      const background = await deps.queue.consume(
        "jobs",
        async (job) => {
          if (job.type === "export.package")
            await runExportJob(
              {
                db: deps.db,
                artifactsDir: deps.artifactsDir,
                vendorDir: deps.exports?.vendorDir ?? null,
              },
              job,
            );
        },
        { concurrency: 1 },
      );
      stops.push(
        () => general.stop(),
        () => control.stop(),
        () => evaluation.stop(),
        () => background.stop(),
      );
      // Terminal runs: release their credentials and complete subflows into their parents.
      const unsub = await deps.bus.subscribe(RUN_EVENTS_CHANNEL, (m) => {
        const msg = m as { runId?: string; fromSeq?: number; toSeq?: number };
        if (typeof msg.runId !== "string") return;
        const runId = msg.runId;
        void store
          .listEvents(runId, (msg.fromSeq ?? 1) - 1, (msg.toSeq ?? 0) - (msg.fromSeq ?? 0) + 1)
          .then(async (events) => {
            if (!events.some((e) => TERMINAL.has(e.type))) return;
            cache.release(runId);
            const run = await store.getRun(runId);
            if (run?.parentRunId)
              await deps.queue.enqueue(
                "run:general",
                {
                  type: "run.signal",
                  runId: run.parentRunId,
                  signal: { type: "subflow_completed", childRunId: runId },
                },
                { jobId: `subflow:${runId}` },
              );
          })
          .catch((error: unknown) =>
            log.error({ err: String(error), runId }, "terminal bookkeeping failed"),
          );
      });
      stops.push(unsub);
      orchestrator.startMaintenance({
        timerPollMs: 1_000,
        heartbeatMs: 10_000,
        reapMs: 15_000,
        ...deps.maintenance,
      });
      log.info({ workerId, concurrency }, "worker started");
    },
    async stop() {
      for (const s of stops.splice(0).reverse()) await s().catch(() => undefined);
      await orchestrator.close();
      await pool.closeAll();
      log.info({ workerId }, "worker stopped");
    },
  };
}
