/**
 * Applies `migrations/` as the schema owner (`DATABASE_ADMIN_URL`, falling back to
 * `DATABASE_URL`). Run by `flowaid db migrate` and the api entrypoint before it listens, never at
 * request time. A session advisory lock serialises concurrent starts of several api replicas;
 * the migrations themselves run in one transaction, so a failure leaves the schema untouched.
 */
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";
import type { Env } from "@flowaid/env";

/** The migrations shipped with this package. */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

const LOCK_KEY = 0x666c6f77; // "flow"

export interface MigrateOptions {
  /** Owner connection. */
  adminUrl: string;
  /** Convert run_events to monthly partitions (`RUN_EVENTS_PARTITIONED`, first migration only). */
  partitionRunEvents?: boolean;
  migrationsFolder?: string;
}

export async function migrate(options: MigrateOptions): Promise<void> {
  const client = postgres(options.adminUrl, {
    max: 1,
    onnotice: () => undefined,
    connection: {
      application_name: "flowaid-migrate",
      "flowaid.run_events_partitioned": options.partitionRunEvents ? "true" : "false",
    },
  });
  try {
    await client`select pg_advisory_lock(${LOCK_KEY})`;
    try {
      await drizzleMigrate(drizzle(client), {
        migrationsFolder: options.migrationsFolder ?? MIGRATIONS_DIR,
      });
    } finally {
      await client`select pg_advisory_unlock(${LOCK_KEY})`;
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

/** `migrate()` from the loaded environment. */
export function migrateFromEnv(
  env: Pick<Env, "DATABASE_URL" | "DATABASE_ADMIN_URL" | "RUN_EVENTS_PARTITIONED">,
): Promise<void> {
  return migrate({
    adminUrl: String(env.DATABASE_ADMIN_URL ?? env.DATABASE_URL),
    partitionRunEvents: env.RUN_EVENTS_PARTITIONED,
  });
}
