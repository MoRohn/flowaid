/**
 * The worker entrypoint: environment → database, queue and bus (Redis when configured, else
 * Postgres) → credentials (master key verified) → SafeFetch → sandbox → worker, scheduler and
 * heartbeat. SIGTERM/SIGINT stop consuming, let running node executions finish (bounded), release
 * leases and exit.
 *
 * `WORKER_POOLS` without `general` starts a pool-only worker instead (the `code` pool's sandbox
 * host): no master key, no credentials, no plugins, no scheduler — only the delegated nodes of
 * its pools.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  CredentialService,
  ExternalResolver,
  KeyRing,
  envMasterKey,
  externalResolverOptionsFromEnv,
  fileMasterKey,
  masterKeyProviderFromEnv,
  type KeyServiceDeps,
} from "@flowaid/credentials";
import {
  PgCredentialRepository,
  PgEventBus,
  PgKekStore,
  PgQueueDriver,
  createDatabaseFromEnv,
} from "@flowaid/database";
import { loadEnv, pickEnv } from "@flowaid/env";
import { PageIndexServiceClient } from "@flowaid/pageindex";
import { RegistryClient } from "@flowaid/plugins";
import { FileFixtureStore } from "@flowaid/providers/recording-fs";
import { createSandbox } from "@flowaid/sandbox";
import { artifactStorageFrom } from "@flowaid/storage";
import { BullMqQueueDriver, RedisEventBus } from "@flowaid/workflow-runtime";
import { coreNodes } from "@flowaid/nodes-core";
import { heartbeatPath, startHeartbeat } from "./heartbeat.js";
import { workerNetworkFromEnv } from "./network.js";
import { createPoolWorker } from "./poolWorker.js";
import { startScheduler } from "./jobs/scheduler.js";
import { loadBundledPlugins, registerPluginProviders } from "./plugins/bundled.js";
import { PluginHost, hostedPackage } from "./plugins/host.js";
import { loadInstalledPlugins } from "./plugins/installed.js";
import { createWorker, defaultProviderRegistry, type WorkerLogger } from "./worker.js";
import { eq } from "drizzle-orm";
import { schedules, workspaces } from "@flowaid/database";
import { setupTelemetry, startMetricsListener } from "@flowaid/observability";
import { createAlertDispatcher, smtpFromEnv } from "./services/alerts.js";

const log: WorkerLogger = {
  info: (data, msg) =>
    process.stdout.write(
      `${JSON.stringify({ level: "info", msg, ...data, time: new Date().toISOString() })}\n`,
    ),
  warn: (data, msg) =>
    process.stdout.write(
      `${JSON.stringify({ level: "warn", msg, ...data, time: new Date().toISOString() })}\n`,
    ),
  error: (data, msg) =>
    process.stderr.write(
      `${JSON.stringify({ level: "error", msg, ...data, time: new Date().toISOString() })}\n`,
    ),
};

async function main(): Promise<void> {
  const env = loadEnv();
  // OpenTelemetry export when OTEL_EXPORTER_OTLP_ENDPOINT is set; Prometheus on PROMETHEUS_PORT.
  const telemetry = setupTelemetry({
    serviceName: "flowaid-worker",
    ...(env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? { otlpEndpoint: String(env.OTEL_EXPORTER_OTLP_ENDPOINT) }
      : {}),
    prometheus: env.PROMETHEUS_PORT !== undefined,
  });
  const metricsListener =
    env.PROMETHEUS_PORT !== undefined && telemetry.prometheusHandler
      ? await startMetricsListener({
          port: Number(env.PROMETHEUS_PORT),
          handler: telemetry.prometheusHandler,
        })
      : null;
  const db = createDatabaseFromEnv(env, { applicationName: "flowaid-worker" });
  const redisUrl = env.REDIS_URL ? String(env.REDIS_URL) : null;
  const queue = redisUrl
    ? new BullMqQueueDriver({ connection: { url: redisUrl } })
    : new PgQueueDriver(db.sql, {
        onError: (error, job) =>
          log.error(
            {
              err: error instanceof Error ? error.message : String(error),
              job: job.type,
              ...("runId" in job && job.runId ? { runId: job.runId } : {}),
            },
            "queue job failed",
          ),
      });
  // FLOWAID_ALLOW_PRIVATE_NETWORK: whether workflows may reach loopback and private addresses
  const network = workerNetworkFromEnv(env);
  const sandboxMode =
    String(env.SANDBOX_MODE ?? "isolated-vm") === "container" ? "container" : "isolated-vm";

  if (!env.WORKER_POOLS.includes("general")) {
    const pools = env.WORKER_POOLS;
    const poolWorker = createPoolWorker({
      db,
      queue,
      pools,
      http: network.http,
      ...(pools.includes("code") ? { sandbox: createSandbox(sandboxMode) } : {}),
      concurrency: Number(env.WORKER_CONCURRENCY ?? 4),
      log,
    });
    await poolWorker.start();
    const stopBeat = startHeartbeat(heartbeatPath(env));
    const stopPool = async (signal: string) => {
      log.info({ signal }, "shutting down");
      stopBeat();
      const hard = setTimeout(() => process.exit(1), 30_000);
      hard.unref();
      await poolWorker.stop();
      await queue.close();
      await db.close();
      process.exit(0);
    };
    process.once("SIGTERM", () => void stopPool("SIGTERM"));
    process.once("SIGINT", () => void stopPool("SIGINT"));
    return;
  }

  const bus = redisUrl ? new RedisEventBus(redisUrl) : new PgEventBus(db.sql);
  // key services are platform configuration: plain fetch, and the key file from disk
  const keyDeps: KeyServiceDeps = {
    http: (url, init) => fetch(url, init),
    readFile: (path) => readFileSync(path, "utf8"),
  };
  const master = await masterKeyProviderFromEnv(env, keyDeps, async () =>
    env.FLOWAID_MASTER_KEY
      ? envMasterKey(String(env.FLOWAID_MASTER_KEY))
      : fileMasterKey({ path: String(env.FLOWAID_MASTER_KEY_FILE), autogenerate: false }),
  );
  const keyring = new KeyRing(master, new PgKekStore(db));
  await keyring.verifyMaster();
  const credentials = new CredentialService({
    repository: new PgCredentialRepository(db),
    keyring,
    external: new ExternalResolver(externalResolverOptionsFromEnv(env, keyDeps)),
  });
  const http = network.http;
  const dataDir = dirname(String(env.FLOWAID_MASTER_KEY_FILE ?? "/data/master.key"));

  // Bundled plugins (e.g. @flowaid/nodes-langchain) load unless features.langchain is disabled.
  const bundled = env.FLOWAID_FEATURES_DISABLED?.includes("langchain")
    ? { packages: [], skipped: [] }
    : await loadBundledPlugins(env.FLOWAID_BUNDLED_PLUGINS, { db, log });
  const fixtureMode = env.FLOWAID_PROVIDER_FIXTURES;
  const registry = defaultProviderRegistry(
    fixtureMode === "off"
      ? {}
      : {
          fixtures: {
            mode: fixtureMode,
            store: new FileFixtureStore(resolve(String(env.FLOWAID_PROVIDER_FIXTURES_DIR))),
          },
        },
  );
  if (fixtureMode !== "off")
    log.warn(
      { mode: fixtureMode, dir: String(env.FLOWAID_PROVIDER_FIXTURES_DIR) },
      "provider calls are recorded/replayed from fixtures",
    );
  registerPluginProviders(registry, bundled.packages);
  // Plugin node code runs in a host process per package, never in this one (ARCHITECTURE.md D21).
  const hosts = bundled.packages.map(
    (pkg) =>
      new PluginHost({
        packageName: pkg.name,
        version: pkg.version,
        log,
        env: {
          NODE_ENV: env.flags.isProduction ? "production" : "development",
          LOG_LEVEL: String(env.LOG_LEVEL ?? "info"),
        },
      }),
  );
  for (const host of hosts)
    await host
      .start()
      .catch((error: unknown) =>
        log.error({ err: String(error) }, "plugin host failed to start; it retries on first use"),
      );
  // Installed (npm/local) plugins: verified, extracted and run in their own host processes.
  const installed = env.FLOWAID_FEATURES_DISABLED?.includes("integrations_plugins")
    ? { packages: [], hosts: [] }
    : await loadInstalledPlugins({
        db,
        registry: new RegistryClient({
          registry: String(env.FLOWAID_PLUGIN_REGISTRY),
          fetch: http,
        }),
        pluginDir: String(env.FLOWAID_PLUGIN_DIR),
        log,
        env: {
          NODE_ENV: env.flags.isProduction ? "production" : "development",
          LOG_LEVEL: String(env.LOG_LEVEL ?? "info"),
        },
      });
  hosts.push(...installed.hosts);

  const alerts = createAlertDispatcher({
    db,
    credentials,
    fetch: http,
    smtp: smtpFromEnv(env),
    onError: (error, context) =>
      log.error({ err: String(error), ...context }, "alert delivery failed"),
  });
  const webUrl = String(env.FLOWAID_WEB_URL ?? env.FLOWAID_BASE_URL ?? "");
  const worker = createWorker({
    instruments: telemetry.instruments,
    alerts,
    ...(webUrl ? { webUrl } : {}),
    db,
    queue,
    bus,
    credentials,
    http,
    registry,
    nodes: [
      coreNodes,
      ...bundled.packages.map((pkg, i) => hostedPackage(pkg, hosts[i] as PluginHost)),
      ...installed.packages,
    ],
    artifactsDir: join(dataDir, "artifacts"),
    storage: artifactStorageFrom(env, join(dataDir, "artifacts")),
    serverKeys: {
      ...(env.TYPESAFE_API_KEY ? { typesafe: String(env.TYPESAFE_API_KEY) } : {}),
      ...(env.OPENAI_API_KEY ? { openai: String(env.OPENAI_API_KEY) } : {}),
      ...(env.ANTHROPIC_API_KEY ? { anthropic: String(env.ANTHROPIC_API_KEY) } : {}),
      ...(env.OLLAMA_HOST ? { ollamaHost: String(env.OLLAMA_HOST) } : {}),
    },
    sandbox: createSandbox(sandboxMode),
    allowPrivateNetwork: network.allowPrivateNetwork,
    ...(env.flags.mcpStdioEnabled
      ? {
          stdioPolicy: {
            enabled: true,
            allowedCommands: env.FLOWAID_MCP_STDIO_ALLOWED_COMMANDS,
            envAllowlist: env.FLOWAID_MCP_STDIO_ENV_ALLOWLIST,
            parentEnv: pickEnv(env.FLOWAID_MCP_STDIO_ENV_ALLOWLIST),
          },
        }
      : {}),
    exports: { vendorDir: String(env.FLOWAID_VENDOR_DIR ?? "/opt/flowaid/vendor") },
    // the PageIndex service is operator configuration on a private network: its client uses
    // plain fetch, not the workflow egress guard
    ...(env.flags.hasPageIndex
      ? {
          pageindex: {
            client: new PageIndexServiceClient({
              baseUrl: String(env.FLOWAID_PAGEINDEX_URL),
              token: String(env.FLOWAID_PAGEINDEX_TOKEN),
              // a submission uploads the PDF (up to 50 MiB)
              timeoutMs: 120_000,
            }),
          },
        }
      : {}),
    concurrency: Number(env.WORKER_CONCURRENCY ?? 8),
    pools: env.WORKER_POOLS,
    retentionCron: String(env.RETENTION_SWEEP_CRON),
    log,
  });
  await worker.start();
  const stopScheduler = startScheduler({
    db,
    queue,
    onError: (error, id) => {
      log.error({ scheduleId: id, err: String(error) }, "schedule fire failed");
      void db
        .system((tx) =>
          tx
            .select({
              workspaceId: schedules.workspaceId,
              workflowId: schedules.workflowId,
              slug: workspaces.slug,
            })
            .from(schedules)
            .innerJoin(workspaces, eq(workspaces.id, schedules.workspaceId))
            .where(eq(schedules.id, id)),
        )
        .then(([row]) => {
          if (!row) return;
          const hour = new Date().toISOString().slice(0, 13);
          return alerts.dispatch(row.workspaceId, `schedule.failed:${id}:${hour}`, {
            event: "schedule.failed",
            severity: "warning",
            title: "A schedule failed to start its run",
            text: error instanceof Error ? error.message : String(error),
            ...(webUrl
              ? {
                  url: `${webUrl.replace(/\/$/, "")}/${row.slug}/triggers?tab=schedules`,
                }
              : {}),
            data: { scheduleId: id, workflowId: row.workflowId },
          });
        })
        .catch(() => undefined);
    },
  });
  const stopHeartbeat = startHeartbeat(heartbeatPath(env), 10_000, () => ({
    retentionSweep: worker.lastRetentionSweep,
  }));

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    stopScheduler();
    stopHeartbeat();
    const hard = setTimeout(() => process.exit(1), 30_000);
    hard.unref();
    await worker.stop();
    await Promise.all(hosts.map((h) => h.stop()));
    await queue.close();
    await db.close();
    await metricsListener?.close();
    await telemetry.shutdown().catch(() => undefined);
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
