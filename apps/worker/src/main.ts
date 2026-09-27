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
import { dirname, join } from "node:path";
import { CredentialService, KeyRing, envMasterKey, fileMasterKey } from "@flowaid/credentials";
import {
  PgCredentialRepository,
  PgEventBus,
  PgKekStore,
  PgQueueDriver,
  createDatabaseFromEnv,
} from "@flowaid/database";
import { loadEnv, pickEnv } from "@flowaid/env";
import { createSafeFetch } from "@flowaid/providers";
import { createSandbox } from "@flowaid/sandbox";
import { artifactStorageFrom } from "@flowaid/storage";
import { BullMqQueueDriver, RedisEventBus } from "@flowaid/workflow-runtime";
import { coreNodes } from "@flowaid/nodes-core";
import { heartbeatPath, startHeartbeat } from "./heartbeat.js";
import { createPoolWorker } from "./poolWorker.js";
import { startScheduler } from "./jobs/scheduler.js";
import { loadBundledPlugins, registerPluginProviders } from "./plugins/bundled.js";
import { PluginHost, hostedPackage } from "./plugins/host.js";
import { createWorker, defaultProviderRegistry, type WorkerLogger } from "./worker.js";

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
  const db = createDatabaseFromEnv(env, { applicationName: "flowaid-worker" });
  const redisUrl = env.REDIS_URL ? String(env.REDIS_URL) : null;
  const queue = redisUrl
    ? new BullMqQueueDriver({ connection: { url: redisUrl } })
    : new PgQueueDriver(db.sql);
  const sandboxMode =
    String(env.SANDBOX_MODE ?? "isolated-vm") === "container" ? "container" : "isolated-vm";

  if (!env.WORKER_POOLS.includes("general")) {
    const pools = env.WORKER_POOLS;
    const poolWorker = createPoolWorker({
      db,
      queue,
      pools,
      http: createSafeFetch({ timeoutMs: 120_000, userAgent: "FlowAId-Worker/1" }),
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
  const master = env.FLOWAID_MASTER_KEY
    ? envMasterKey(String(env.FLOWAID_MASTER_KEY))
    : await fileMasterKey({ path: String(env.FLOWAID_MASTER_KEY_FILE), autogenerate: false });
  const keyring = new KeyRing(master, new PgKekStore(db));
  await keyring.verifyMaster();
  const credentials = new CredentialService({
    repository: new PgCredentialRepository(db),
    keyring,
  });
  const http = createSafeFetch({ timeoutMs: 120_000, userAgent: "FlowAId-Worker/1" });
  const dataDir = dirname(String(env.FLOWAID_MASTER_KEY_FILE ?? "/data/master.key"));

  // Bundled plugins (e.g. @flowaid/nodes-langchain) load unless features.langchain is disabled.
  const bundled = env.FLOWAID_FEATURES_DISABLED?.includes("langchain")
    ? { packages: [], skipped: [] }
    : await loadBundledPlugins(env.FLOWAID_BUNDLED_PLUGINS, { db, log });
  const registry = defaultProviderRegistry();
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

  const worker = createWorker({
    db,
    queue,
    bus,
    credentials,
    http,
    registry,
    nodes: [
      coreNodes,
      ...bundled.packages.map((pkg, i) => hostedPackage(pkg, hosts[i] as PluginHost)),
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
    concurrency: Number(env.WORKER_CONCURRENCY ?? 8),
    pools: env.WORKER_POOLS,
    log,
  });
  await worker.start();
  const stopScheduler = startScheduler({
    db,
    queue,
    onError: (error, id) =>
      log.error({ scheduleId: id, err: String(error) }, "schedule fire failed"),
  });
  const stopHeartbeat = startHeartbeat(heartbeatPath(env));

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
