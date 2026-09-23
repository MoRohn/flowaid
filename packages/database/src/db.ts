/**
 * Connections and transaction scopes. Every query runs inside a scope that sets the row-level
 * security GUCs for that transaction only (`set_config(…, true)`), so a pooled connection never
 * carries one tenant's setting into the next transaction:
 *
 * - `tenant(workspaceId, fn)` — `app.workspace_id`; the policies show that workspace's rows
 *   (and global plugins/templates). The API opens one per request.
 * - `system(fn)` — `app.bypass_rls = on`, for trusted cross-tenant work: the worker's run store,
 *   the retention sweep, reprojection, principal resolution.
 *
 * With `rls: false` (`DB_RLS=false`) every connection starts with the bypass on, which turns the
 * policies off without a second migration path.
 */
import postgres, { type Sql } from "postgres";
import { sql as dsql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Env } from "@flowaid/env";
import { BadRequestError } from "@flowaid/workflow-core";
import * as schema from "./schema.js";

export type Schema = typeof schema;
export type Db = PostgresJsDatabase<Schema>;
/** A transaction handle (the `tx` inside `db.transaction`). */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything queries can run on. */
export type Queryable = Db | Tx;

export interface DatabaseOptions {
  url: string;
  /** Row-level security policies apply (default true). */
  rls?: boolean;
  /** Pool size (default 10). */
  max?: number;
  applicationName?: string;
  /** Seconds before an idle connection is closed (default 30). */
  idleTimeout?: number;
}

export interface Database {
  readonly db: Db;
  readonly sql: Sql;
  readonly rls: boolean;
  /** Runs `fn` in a transaction scoped to one workspace. */
  tenant<T>(workspaceId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Runs `fn` in a transaction that bypasses row-level security. */
  system<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sets the tenant GUC for the current transaction. */
export async function setWorkspace(tx: Queryable, workspaceId: string): Promise<void> {
  if (!UUID.test(workspaceId)) throw new BadRequestError(`'${workspaceId}' is not a workspace id`);
  await tx.execute(dsql`select set_config('app.workspace_id', ${workspaceId}, true)`);
}

/** Turns row-level security off for the current transaction. */
export async function setBypass(tx: Queryable): Promise<void> {
  await tx.execute(dsql`select set_config('app.bypass_rls', 'on', true)`);
}

export function createDatabase(options: DatabaseOptions): Database {
  const rls = options.rls ?? true;
  const client = postgres(options.url, {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeout ?? 30,
    onnotice: () => undefined,
    connection: {
      application_name: options.applicationName ?? "flowaid",
      ...(rls ? {} : { "app.bypass_rls": "on" }),
    },
  });
  const db = drizzle(client, { schema });
  return {
    db,
    sql: client,
    rls,
    tenant: (workspaceId, fn) =>
      db.transaction(async (tx) => {
        await setWorkspace(tx, workspaceId);
        return fn(tx);
      }),
    system: (fn) =>
      db.transaction(async (tx) => {
        await setBypass(tx);
        return fn(tx);
      }),
    close: () => client.end({ timeout: 5 }),
  };
}

/** The application connection from the loaded environment (`DATABASE_URL`, `DB_RLS`). */
export function createDatabaseFromEnv(
  env: Pick<Env, "DATABASE_URL" | "DB_RLS">,
  options: Omit<DatabaseOptions, "url" | "rls"> = {},
): Database {
  return createDatabase({ ...options, url: String(env.DATABASE_URL), rls: env.DB_RLS });
}
