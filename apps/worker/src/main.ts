/**
 * The worker entrypoint: environment → database, queue and bus (Redis when configured, else
 * Postgres) → credentials (master key verified) → SafeFetch → sandbox → worker, scheduler and
 * heartbeat. SIGTERM/SIGINT stop consuming, let running node executions finish (bounded), release
 * leases and exit.
 */
import { dirname, join } from "node:path";
import { CredentialService, KeyRing, envMasterKey, fileMasterKey } from "@flowaid/credentials";
import {
  PgCredentialRepository,
  PgEventBus,
  PgKekStore,
  PgQueueDriver,
  createDatabaseFromEnv,
  workspaces,
} from "@flowaid/database";
import { eq } from "drizzle-orm";
import { loadEnv, pickEnv } from "@flowaid/env";
import { createSafeFetch } from "@flowaid/providers";
import { createSandbox } from "@flowaid/sandbox";
import { BullMqQueueDriver, RedisEventBus } from "@flowaid/workflow-runtime";
import { coreNodes } from "@flowaid/nodes-core";
import { startHeartbeat } from "./heartbeat.js";
import { startScheduler } from "./jobs/scheduler.js";
import { loadBundledPlugins, registerPluginProviders } from "./plugins/bundled.js";
import { createWorker, defaultProviderRegistry, type WorkerLogger } from "./worker.js";
import { workspaceNotifier } from "./services/notify.js";

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
  const sandboxMode =
    String(env.SANDBOX_MODE ?? "isolated-vm") === "container" ? "container" : "isolated-vm";

  // Bundled plugins (e.g. @flowaid/nodes-langchain) load unless features.langchain is disabled.
  const bundled = env.FLOWAID_FEATURES_DISABLED?.includes("langchain")
    ? { packages: [], skipped: [] }
    : await loadBundledPlugins(env.FLOWAID_BUNDLED_PLUGINS, { db, log });
  const registry = defaultProviderRegistry();
  const webUrl = env.FLOWAID_WEB_URL ? String(env.FLOWAID_WEB_URL) : null;
  const notifier = workspaceNotifier({
    db,
    credentials,
    http,
    ...(env.SMTP_URL
      ? {
          smtp: {
            url: String(env.SMTP_URL),
            from: String(env.SMTP_FROM ?? "FlowAId <noreply@localhost>"),
          },
        }
      : {}),
    onError: (error, channel, event) =>
      log.warn({ channel, event, err: String(error) }, "notification not delivered"),
  });
  registerPluginProviders(registry, bundled.packages);

  const worker = createWorker({
    db,
    queue,
    bus,
    credentials,
    http,
    registry,
    nodes: [coreNodes, ...bundled.packages],
    artifactsDir: join(dataDir, "artifacts"),
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
    notify: { notifier, webUrl },
    log,
  });
  await worker.start();
  const stopScheduler = startScheduler({
    db,
    queue,
    onError: (error, id) =>
      log.error({ scheduleId: id, err: String(error) }, "schedule fire failed"),
    onFailed: (f) =>
      void (async () => {
        const [ws] = await db.system((tx) =>
          tx
            .select({ slug: workspaces.slug })
            .from(workspaces)
            .where(eq(workspaces.id, f.workspaceId)),
        );
        await notifier.notify({
          event: "schedule.failed",
          workspaceId: f.workspaceId,
          title: "A schedule could not start its run",
          text: f.error,
          ...(webUrl && ws
            ? { url: `${webUrl.replace(/\/$/, "")}/${ws.slug}/triggers?tab=schedules` }
            : {}),
          details: { scheduleId: f.scheduleId, workflowId: f.workflowId },
          at: new Date().toISOString(),
        });
      })().catch((error: unknown) =>
        log.warn({ err: String(error) }, "schedule.failed notification not sent"),
      ),
  });
  const stopHeartbeat = startHeartbeat(join(dataDir, "worker.heartbeat"));

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    stopScheduler();
    stopHeartbeat();
    const hard = setTimeout(() => process.exit(1), 30_000);
    hard.unref();
    await worker.stop();
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
