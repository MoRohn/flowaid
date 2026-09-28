/**
 * The api entrypoint: environment → migrations (as the owner role) → first boot → server. Prints the
 * generated owner password once, and shuts down gracefully on SIGTERM/SIGINT.
 */
import { PgEventBus, PgQueueDriver, createDatabaseFromEnv, migrate } from "@flowaid/database";
import { BullMqQueueDriver, RedisEventBus } from "@flowaid/workflow-runtime";
import { RunEventHub } from "./services/hub.js";
import {
  createCredentialService,
  externalFromEnv,
  masterKeyFromEnv,
} from "./services/credentials.js";
import { createSafeFetch } from "@flowaid/providers";
import { loadEnv } from "@flowaid/env";
import { AuthService } from "./auth/service.js";
import { JwtKeys } from "./auth/jwt.js";
import { firstBoot } from "./bootstrap/firstBoot.js";
import { configFromEnv, type ApiContext } from "./context.js";
import { buildServer } from "./server.js";
import { setupTelemetry, startMetricsListener } from "@flowaid/observability";
import { createAlertDispatcher, smtpFromEnv } from "./services/alerts.js";

async function main(): Promise<void> {
  const env = loadEnv();
  // OpenTelemetry export when OTEL_EXPORTER_OTLP_ENDPOINT is set; Prometheus on PROMETHEUS_PORT.
  const telemetry = setupTelemetry({
    serviceName: "flowaid-api",
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
  await migrate({
    adminUrl: String(env.DATABASE_ADMIN_URL ?? env.DATABASE_URL),
    partitionRunEvents: Boolean(env.RUN_EVENTS_PARTITIONED),
  });
  const db = createDatabaseFromEnv(env, { applicationName: "flowaid-api" });
  const keys = await JwtKeys.load({
    ...(env.FLOWAID_JWT_PRIVATE_KEY ? { privatePem: String(env.FLOWAID_JWT_PRIVATE_KEY) } : {}),
    ...(env.FLOWAID_JWT_PUBLIC_KEY ? { publicPem: String(env.FLOWAID_JWT_PUBLIC_KEY) } : {}),
    ...(env.FLOWAID_JWT_KEYS_DIR ? { dir: String(env.FLOWAID_JWT_KEYS_DIR) } : {}),
    production: env.flags.isProduction,
  });
  const clock = { now: () => Date.now() };
  // Redis when configured (BullMQ + pub/sub), else Postgres (queue_jobs + LISTEN/NOTIFY).
  const redisUrl = env.REDIS_URL ? String(env.REDIS_URL) : null;
  const queue = redisUrl
    ? new BullMqQueueDriver({ connection: { url: redisUrl } })
    : new PgQueueDriver(db.sql);
  const bus = redisUrl ? new RedisEventBus(redisUrl) : new PgEventBus(db.sql);
  const hub = new RunEventHub(bus);
  const credentials = await createCredentialService(
    db,
    await masterKeyFromEnv(env, db, (path) =>
      process.stderr.write(
        `WARNING: generated a new master key at ${path}; back it up — losing it loses every credential\n`,
      ),
    ),
    externalFromEnv(env),
  );
  const http = createSafeFetch({
    maxBytes: 25 * 1024 * 1024,
    timeoutMs: 30_000,
    userAgent: "FlowAId-API/1",
  });
  // email channels need both SMTP_URL and SMTP_FROM (alerts and test sends use the same settings)
  const smtp = smtpFromEnv(env) ?? undefined;
  const ctx: ApiContext = {
    config: configFromEnv(env),
    db,
    keys,
    auth: new AuthService(db, keys, clock.now),
    clock,
    queue,
    hub,
    credentials,
    http,
    env,
    alerts: createAlertDispatcher({
      db,
      credentials,
      fetch: http,
      smtp: smtp ?? null,
      onError: (error, context) =>
        process.stderr.write(
          `${JSON.stringify({ level: 50, msg: "alert delivery failed", err: String(error), ...context })}\n`,
        ),
    }),
    ...(smtp ? { smtp } : {}),
  };
  const boot = await firstBoot(db, {
    ...(env.FLOWAID_ADMIN_EMAIL ? { adminEmail: String(env.FLOWAID_ADMIN_EMAIL) } : {}),
    ...(env.FLOWAID_ADMIN_PASSWORD ? { adminPassword: String(env.FLOWAID_ADMIN_PASSWORD) } : {}),
  });
  const app = await buildServer(ctx, {
    logger: {
      level: String(env.LOG_LEVEL ?? "info"),
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
  });
  if (boot.created) {
    app.log.info(
      { owner: boot.ownerEmail, workspace: "default" },
      "first boot: created the owner and the default workspace",
    );
    if (boot.generatedPassword)
      // Printed once, to stdout, so it never lands in structured logs.
      process.stdout.write(
        `\n  FlowAId first boot — owner ${boot.ownerEmail}, password ${boot.generatedPassword} (change it on first sign-in)\n\n`,
      );
  }
  await app.listen({ host: String(env.HOST ?? "0.0.0.0"), port: Number(env.PORT ?? 3001) });
  const stop = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await hub.close();
    await queue.close();
    await db.close();
    await metricsListener?.close();
    await telemetry.shutdown().catch(() => undefined);
    process.exit(0);
  };
  process.once("SIGTERM", () => void stop("SIGTERM"));
  process.once("SIGINT", () => void stop("SIGINT"));
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
