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
  PgEventBus,
  PgRunStore,
  RUN_EVENTS_CHANNEL,
  environments,
  runs,
  workspaces,
  workflowDeployments,
  workflowVersions,
  type Database,
} from "@flowaid/database";
import { McpSessionPool, connectSession, type StdioPolicy } from "@flowaid/mcp";
import type { NodePackage } from "@flowaid/node-sdk";
import type { PageIndexServiceClient } from "@flowaid/pageindex";
import { coreNodes } from "@flowaid/nodes-core";
import {
  DefaultModelCatalog,
  ProviderRegistry,
  recordingFactory,
  rerankFactories,
  type FixtureMode,
  type FixtureStore,
} from "@flowaid/providers";
import { anthropicFactory } from "@flowaid/provider-anthropic";
import { ollamaEmbeddingFactory, ollamaFactory } from "@flowaid/provider-ollama";
import { openaiFactories } from "@flowaid/provider-openai";
import { typesafeFactory } from "@flowaid/provider-typesafe";
import { uuidv7 } from "@flowaid/shared";
import { artifactStorage, LocalArtifactStore, type ArtifactStorage } from "@flowaid/storage";
import type {
  DecisionProvider,
  DurableRunEvent,
  EventBus,
  ExecutionPlan,
  Job,
  QueueDriver,
  QueueName,
  Run,
  RunEventOf,
  SafeFetch,
  SandboxExecutor,
  WorkerPool,
} from "@flowaid/workflow-core";
import {
  NodeRegistry,
  Orchestrator,
  createEventRedactor,
  downstreamOf,
  registryProviderAccess,
  type NodeServices,
  type Trigger,
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
import { runMcpProbeJob, type McpConnect } from "./jobs/mcp.js";
import {
  clearDelegatedResult,
  delegateNode,
  poolExecutor,
  readDelegatedResult,
} from "./delegation.js";
import { runTraceReviewJob, wantsReview } from "./jobs/traceReview.js";
import { recordRunMetrics, type AlertDispatcher, type Instruments } from "@flowaid/observability";
import { runIngestJob } from "./jobs/ingest.js";
import {
  isMaintenanceJob,
  runMaintenanceJob,
  scheduleRetentionSweep,
  type RetentionSweepReport,
} from "./jobs/maintenance.js";
import { knowledgeServiceFor, type KnowledgeDeps } from "./services/knowledge.js";
import { documentIndexAccessFor } from "./services/documents.js";
import {
  reconcilePageIndex,
  runCleanupJob,
  runIndexJob,
  type PageIndexJobDeps,
} from "./jobs/pageindex.js";

export interface WorkerLogger {
  info(data: Record<string, unknown>, msg: string): void;
  warn(data: Record<string, unknown>, msg: string): void;
  error(data: Record<string, unknown>, msg: string): void;
}

export interface WorkerDeps {
  db: Database;
  queue: QueueDriver;
  /** Ephemeral fan-out (generation deltas): Redis pub/sub in scale mode, else Postgres. */
  bus: EventBus;
  credentials: CredentialService;
  http: SafeFetch;
  artifactsDir: string;
  /** artifact storage (main.ts: S3 when configured); defaults to the local `artifactsDir` */
  storage?: ArtifactStorage;
  serverKeys?: ServerKeys;
  /** replaces the default provider registry (tests) */
  registry?: ProviderRegistry;
  nodes?: readonly NodePackage[];
  sandbox?: SandboxExecutor;
  stdioPolicy?: StdioPolicy;
  workerId?: string;
  concurrency?: number;
  /** FLOWAID_ALLOW_PRIVATE_NETWORK (with an `http` built to match: see network.ts) */
  allowPrivateNetwork?: boolean;
  log?: WorkerLogger;
  /** judge provider and timing for evaluation runs */
  evaluation?: { judge?: DecisionProvider; caseTimeoutMs?: number; pollMs?: number };
  maintenance?: { timerPollMs?: number; heartbeatMs?: number; reapMs?: number };
  /** delay before a run job is redelivered when another worker holds the run (default 1 s) */
  busyRetryMs?: number;
  /** how often the queue-depth and active-runs gauges are sampled (default 15 s) */
  metricsSampleMs?: number;
  /** RETENTION_SWEEP_CRON: enqueues `retention.sweep` on the maintenance queue; null disables */
  retentionCron?: string | null;
  /** code export (`export.package` on the `jobs` queue): FLOWAID_VENDOR_DIR for vendored mode */
  exports?: { vendorDir?: string | null };
  /**
   * Pools this worker serves besides orchestration on `general` (WORKER_POOLS; every pool by
   * default). Nodes of these pools run in-process; nodes of other pools are delegated to the
   * workers that serve them (ARCHITECTURE.md §10.7).
   */
  pools?: readonly WorkerPool[];
  /** observability (P6-04): metric instruments, alerts to notification channels, the review judge */
  instruments?: Instruments;
  alerts?: AlertDispatcher;
  /** public web URL for links in alerts */
  webUrl?: string;
  traceReview?: { judge?: DecisionProvider };
  /**
   * RFC-0022: the PageIndex service (FLOWAID_PAGEINDEX_URL/TOKEN). Without it, document nodes
   * fail with BAD_REQUEST and PageIndex jobs wait on the queue until it is configured.
   */
  pageindex?: {
    client: PageIndexServiceClient;
    /** job timing (tests shorten it) */
    pollMs?: number;
    retryDelayMs?: number;
    timeoutMs?: number;
  };
}

export const ALL_POOLS: readonly WorkerPool[] = [
  "general",
  "code",
  "browser",
  "gpu",
  "retrieval",
  "high_memory",
];

/** Both built-in queue drivers count the jobs waiting on a queue (the queue-depth gauge). */
type CountingQueue = QueueDriver & { depth(queue: QueueName): Promise<number> };
const countsJobs = (queue: QueueDriver): queue is CountingQueue =>
  "depth" in queue && typeof queue.depth === "function";

const TERMINAL = new Set(["RUN_COMPLETED", "RUN_FAILED", "RUN_CANCELLED", "RUN_TIMED_OUT"]);
const silent: WorkerLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * The built-in providers. With `fixtures` (FLOWAID_PROVIDER_FIXTURES=record|replay) every call is
 * recorded to, or replayed from, the fixture store instead of only reaching the vendor.
 */
export function defaultProviderRegistry(
  options: {
    fixtures?: { mode: FixtureMode; store: FixtureStore };
    /** OLLAMA_HOST: where Ollama models run when a workflow names no host */
    ollamaHost?: string | undefined;
  } = {},
): ProviderRegistry {
  const registry = new ProviderRegistry({ catalog: new DefaultModelCatalog() });
  const { fixtures } = options;
  const register: ProviderRegistry["register"] = (factory) =>
    registry.register(
      fixtures ? recordingFactory(factory, fixtures.mode, fixtures.store) : factory,
    );
  register(typesafeFactory());
  for (const f of openaiFactories()) register(f);
  register(anthropicFactory());
  register(ollamaFactory({ host: options.ollamaHost }));
  register(ollamaEmbeddingFactory({ host: options.ollamaHost }));
  for (const f of rerankFactories()) register(f);
  return registry;
}

export interface Worker {
  readonly id: string;
  readonly orchestrator: Orchestrator;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** jobs handled so far (diagnostics, tests) */
  readonly handled: number;
  /** the last `retention.sweep` this worker ran (the heartbeat file carries it) */
  readonly lastRetentionSweep: RetentionSweepReport | null;
}

export function createWorker(deps: WorkerDeps): Worker {
  const log = deps.log ?? silent;
  const workerId = deps.workerId ?? `worker-${uuidv7().slice(-12)}`;
  const store = new PgRunStore(deps.db);
  const repo = new PgCredentialRepository(deps.db);
  const cache = new RunCredentialCache(deps.credentials);
  const providers = deps.registry ?? defaultProviderRegistry();
  const connectMcp: McpConnect = (server, credential, o) =>
    connectSession(server, credential, {
      fetch: deps.http,
      ...(deps.stdioPolicy ? { stdioPolicy: deps.stdioPolicy } : {}),
      signal: o.signal,
      stdio: { onSpawn: o.onSpawn },
      timeoutMs: 30_000,
    });
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
  const pools = new Set<WorkerPool>(deps.pools ?? ALL_POOLS);
  const localPools = new Set([...pools].filter((p) => p !== "general"));
  const storage = deps.storage ?? artifactStorage(new LocalArtifactStore(deps.artifactsDir));
  const knowledge: KnowledgeDeps = {
    db: deps.db,
    credentials: deps.credentials,
    registry: providers,
    http: deps.http,
    serverKeys,
  };

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
    artifacts: (call) => artifactAccessFor(deps.db, storage, call),
    http: () => deps.http,
    ...(deps.sandbox ? { sandbox: deps.sandbox } : {}),
    knowledge: (call) =>
      knowledgeServiceFor(knowledge, call.workspaceId, {
        signal: call.signal,
        runId: call.runId,
        nodeRunId: call.nodeRunId,
      }),
    documents: (call) =>
      documentIndexAccessFor(
        { db: deps.db, queue: deps.queue, client: deps.pageindex?.client ?? null },
        { workspaceId: call.workspaceId, signal: call.signal },
      ),
  };
  // PageIndex builds poll the service for minutes: stopping the worker aborts them (they resume)
  const stopping = new AbortController();
  const pageindexJobs: PageIndexJobDeps | null = deps.pageindex
    ? {
        db: deps.db,
        queue: deps.queue,
        client: deps.pageindex.client,
        credentials: deps.credentials,
        storage,
        serverKeys,
        log,
        signal: stopping.signal,
        ...(deps.pageindex.pollMs !== undefined ? { pollMs: deps.pageindex.pollMs } : {}),
        ...(deps.pageindex.retryDelayMs !== undefined
          ? { retryDelayMs: deps.pageindex.retryDelayMs }
          : {}),
        ...(deps.pageindex.timeoutMs !== undefined ? { timeoutMs: deps.pageindex.timeoutMs } : {}),
      }
    : null;

  // ── observability: metrics, alerts and trace reviews of finished runs ──
  const labels = new Map<string, { env: string; slug: string }>();
  const labelsOf = async (run: Run) => {
    const key = `${run.workspaceId}|${run.environmentId}`;
    const cached = labels.get(key);
    if (cached) return cached;
    const [row] = await deps.db.system((tx) =>
      tx
        .select({ env: environments.name, slug: workspaces.slug })
        .from(environments)
        .innerJoin(workspaces, eq(workspaces.id, environments.workspaceId))
        .where(eq(environments.id, run.environmentId)),
    );
    const value = { env: row?.env ?? "unknown", slug: row?.slug ?? "" };
    if (labels.size > 1000) labels.clear();
    labels.set(key, value);
    return value;
  };
  const link = (slug: string, path: string) =>
    deps.webUrl ? `${deps.webUrl.replace(/\/$/, "")}/${slug}/${path}` : undefined;
  const finalize = async (runId: string) => {
    const run = await store.getRun(runId);
    if (!run) return;
    const { env, slug } = await labelsOf(run);
    if (deps.instruments) {
      const [events, nodeRuns] = await Promise.all([
        store.listEvents(runId, 0, 100_000),
        store.listNodeRuns(runId),
      ]);
      recordRunMetrics(
        deps.instruments,
        { run, events, nodeRuns },
        { workflow: run.workflowId, env },
      );
    }
    // evaluation runs stay quiet: an evaluation of many failing cases must not page anyone
    if (
      deps.alerts &&
      run.origin !== "evaluation" &&
      (run.status === "failed" || run.status === "timed_out")
    ) {
      const url = link(slug, `runs/${runId}`);
      await deps.alerts.dispatch(run.workspaceId, `run.failed:${runId}`, {
        event: "run.failed",
        severity: env === "prod" || env === "production" ? "critical" : "warning",
        title: `Run ${run.status === "timed_out" ? "timed out" : "failed"} in ${env}`,
        text: run.error ? `${run.error.code}: ${run.error.message}` : `The run ${run.status}.`,
        ...(url ? { url } : {}),
        data: {
          runId,
          workflowId: run.workflowId,
          environment: env,
          code: run.error?.code ?? null,
          nodeId: run.error?.nodeId ?? null,
        },
      });
    }
    if (await wantsReview(deps.db, run))
      await deps.queue.enqueue(
        "trace_review",
        { type: "trace_review.run", runId },
        { jobId: `trace_review:${runId}` },
      );
  };
  const onEvents = (run: Run, events: readonly DurableRunEvent[]) => {
    for (const e of events) {
      if (e.type === "HUMAN_APPROVAL_REQUESTED" && deps.alerts && run.origin !== "evaluation") {
        const alerts = deps.alerts;
        void labelsOf(run)
          .then(({ slug, env }) => {
            const url = link(slug, `human-tasks/${e.humanTaskId}`);
            return alerts.dispatch(run.workspaceId, `human_task.created:${e.humanTaskId}`, {
              event: "human_task.created",
              severity: "info",
              title: `Review needed: ${e.request.title.slice(0, 120)}`,
              text: `A run in ${env} is waiting for a person (${e.request.mode.type}).`,
              ...(url ? { url } : {}),
              data: { runId: run.id, humanTaskId: e.humanTaskId, nodeId: e.nodeId },
            });
          })
          .catch((error: unknown) => log.error({ err: String(error) }, "alert failed"));
      }
      if (TERMINAL.has(e.type))
        void finalize(run.id).catch((error: unknown) =>
          log.error({ err: String(error), runId: run.id }, "finalizing a run failed"),
        );
    }
  };

  const orchestrator = new Orchestrator({
    store,
    queue: deps.queue,
    registry,
    services,
    workerId,
    pool: "general",
    localPools,
    delegate: delegateNode(deps.db, deps.queue),
    loadPlan: planOf,
    onEvents,
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
  /** The trigger a run job carries (null: nothing to hand the run, or not a run job). */
  const triggerOf = async (job: Job): Promise<{ runId: string; trigger: Trigger } | null> => {
    switch (job.type) {
      case "run.start":
        return { runId: job.runId, trigger: { type: "start" } };
      case "run.resume":
        // Retry-node (§5.9): the API reopened the failed run; retry its failed nodes.
        return {
          runId: job.runId,
          trigger:
            job.reason === "manual_retry"
              ? { type: "manual_retry", by: "api" }
              : { type: "resume" },
        };
      case "run.control":
        return { runId: job.runId, trigger: { type: "cancel", by: job.by, reason: job.reason } };
      case "timer.fire":
        return { runId: job.runId, trigger: { type: "timer", timerId: job.timerId } };
      case "run.signal":
        switch (job.signal.type) {
          case "event":
            return {
              runId: job.runId,
              trigger: {
                type: "event",
                eventName: job.signal.eventName,
                payload: job.signal.payload,
                ...(job.signal.correlationKey !== undefined
                  ? { correlationKey: job.signal.correlationKey }
                  : {}),
              },
            };
          case "subflow_completed": {
            // A finished child run reports back to its parent's subflow node.
            const child = await store.getRun(job.signal.childRunId);
            if (!child?.parentRunId) return null;
            return {
              runId: child.parentRunId,
              trigger: {
                type: "subflow_completed",
                childRunId: child.id,
                status: child.status,
                output: child.output,
                error: child.error,
              },
            };
          }
          case "delegated_result": {
            const result = await readDelegatedResult(deps.db, job.signal.nodeRunId);
            if (!result) return null;
            return {
              runId: job.runId,
              trigger: { type: "delegated_result", nodeRunId: job.signal.nodeRunId, result },
            };
          }
        }
        return null;
      case "node.exec":
      case "schedule.tick":
      case "ingest.source":
      case "pageindex.index":
      case "pageindex.cleanup":
      case "evaluation.run":
      case "trace_review.run":
      case "export.package":
      case "mcp.probe":
      case "retention.sweep":
      case "partition.ensure":
      case "draft_versions.gc":
        log.warn({ type: job.type }, "job type not handled by this worker");
        return null;
    }
  };
  /**
   * The handler of a run queue. When another worker holds the run (`busy`) or took it over
   * mid-trigger (`lost`), the job goes back on its queue after `busyRetryMs`: completing it would
   * drop the trigger. A lease always lapses or is released, so the retries end.
   */
  const runJobs =
    (queue: QueueName) =>
    async (job: Job): Promise<void> => {
      handled++;
      const target = await triggerOf(job);
      if (!target) return;
      const result = await orchestrator.handle(target.runId, target.trigger);
      if (result === "busy" || result === "lost") {
        await deps.queue.enqueue(queue, job, { delayMs: deps.busyRetryMs ?? 1_000 });
        return;
      }
      // the outcome is in the run's log now (or the run no longer needs it)
      if (target.trigger.type === "delegated_result")
        await clearDelegatedResult(deps.db, target.trigger.nodeRunId);
    };

  let lastRetentionSweep: RetentionSweepReport | null = null;
  const stops: (() => Promise<void>)[] = [];
  return {
    id: workerId,
    orchestrator,
    get handled() {
      return handled;
    },
    get lastRetentionSweep() {
      return lastRetentionSweep;
    },
    async start() {
      const concurrency = deps.concurrency ?? 8;
      const general = await deps.queue.consume("run:general", runJobs("run:general"), {
        concurrency,
      });
      const control = await deps.queue.consume("run:control", runJobs("run:control"), {
        concurrency: 2,
      });
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
                storage,
                vendorDir: deps.exports?.vendorDir ?? null,
              },
              job,
            );
          if (job.type === "mcp.probe")
            await runMcpProbeJob(
              { db: deps.db, credentials: deps.credentials, connect: connectMcp },
              job,
            );
        },
        { concurrency: 1 },
      );
      const reviews = await deps.queue.consume(
        "trace_review",
        async (job) => {
          if (job.type === "trace_review.run") {
            const out = await runTraceReviewJob(
              {
                db: deps.db,
                store,
                registry: providers,
                credentials: deps.credentials,
                http: deps.http,
                serverKeys,
                alerts: deps.alerts,
                webUrl: deps.webUrl,
                judge: deps.traceReview?.judge,
              },
              job.runId,
            );
            if (out.status === "skipped")
              log.info({ runId: job.runId, reason: out.reason }, "trace review skipped");
          }
        },
        { concurrency: 2 },
      );
      const ingest = await deps.queue.consume(
        "ingest",
        async (job) => {
          if (job.type === "pageindex.index" || job.type === "pageindex.cleanup") {
            if (!pageindexJobs) {
              // re-queued by reconciliation once the service is configured
              log.warn({ type: job.type }, "PageIndex is not configured; job skipped");
              return;
            }
            if (job.type === "pageindex.index") await runIndexJob(pageindexJobs, job);
            else await runCleanupJob(pageindexJobs, job);
            return;
          }
          if (job.type !== "ingest.source") return;
          const r = await runIngestJob(knowledge, job.sourceId);
          if (r)
            log.info(
              { sourceId: job.sourceId, ...r, failed: r.failed.length },
              "knowledge source synced",
            );
        },
        // index builds hold a slot while they poll the service
        { concurrency: deps.pageindex ? 4 : 2 },
      );
      const maintenance = await deps.queue.consume(
        "maintenance",
        async (job) => {
          if (!isMaintenanceJob(job)) return;
          const report = await runMaintenanceJob({ db: deps.db, storage, log }, job);
          if (report) lastRetentionSweep = report;
        },
        { concurrency: 1 },
      );
      if (deps.retentionCron) {
        const stopCron = scheduleRetentionSweep({
          queue: deps.queue,
          cron: deps.retentionCron,
          onError: (error) =>
            log.error({ err: String(error) }, "scheduling the retention sweep failed"),
        });
        stops.push(() => Promise.resolve(stopCron()));
      }
      stops.push(
        () => maintenance.stop(),
        () => ingest.stop(),
        () => Promise.resolve(stopping.abort(new Error("the worker is stopping"))),
        () => general.stop(),
        () => control.stop(),
        () => evaluation.stop(),
        () => background.stop(),
        () => reviews.stop(),
      );
      // Delegated nodes of the pools this worker serves (sent by workers that do not).
      const executor = poolExecutor({
        db: deps.db,
        queue: deps.queue,
        registry,
        services,
        workerId,
        log,
      });
      for (const p of localPools) {
        const consumer = await deps.queue.consume(`run:${p}`, executor.handle, {
          concurrency: Math.max(1, Math.floor(concurrency / 2)),
        });
        stops.push(() => consumer.stop());
      }
      stops.push(() => Promise.resolve(executor.abortAll()));
      // Terminal runs: release their credentials and complete subflows into their parents.
      // Commit notices are `pg_notify`s sent inside the append transaction, so they are read
      // from Postgres whichever bus carries the ephemeral traffic.
      const commits = new PgEventBus(deps.db.sql);
      const unsub = await commits.subscribe(RUN_EVENTS_CHANNEL, (m) => {
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
      // Gauges: jobs waiting per queue this worker consumes, runs this worker holds.
      const instruments = deps.instruments;
      if (instruments) {
        const queues: QueueName[] = [
          "run:general",
          "run:control",
          "evaluation",
          "jobs",
          "trace_review",
          "ingest",
          "maintenance",
          ...[...localPools].map((p): QueueName => `run:${p}`),
        ];
        const queue = deps.queue;
        const sample = async () => {
          instruments.workerActiveRuns.record(orchestrator.activeRuns, { pool: "general" });
          if (!countsJobs(queue)) return;
          for (const name of queues)
            instruments.queueDepth.record(await queue.depth(name), { queue: name });
        };
        let sampling = false;
        const timer = setInterval(() => {
          if (sampling) return;
          sampling = true;
          void sample()
            .catch((error: unknown) =>
              log.warn({ err: String(error) }, "sampling queue metrics failed"),
            )
            .finally(() => {
              sampling = false;
            });
        }, deps.metricsSampleMs ?? 15_000);
        timer.unref();
        stops.push(() => Promise.resolve(clearInterval(timer)));
      }
      orchestrator.startMaintenance({
        timerPollMs: 1_000,
        heartbeatMs: 10_000,
        reapMs: 15_000,
        ...deps.maintenance,
      });
      // builds and cleanups a crash or a lost enqueue left behind
      if (pageindexJobs)
        await reconcilePageIndex({ db: deps.db, queue: deps.queue })
          .then((r) => {
            if (r.indexes || r.cleanups) log.info(r, "PageIndex work re-queued");
          })
          .catch((error: unknown) =>
            log.error({ err: String(error) }, "PageIndex reconciliation failed"),
          );
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
