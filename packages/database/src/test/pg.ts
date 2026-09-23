/**
 * Test-only harness for the Postgres integration suites. Each suite gets its own database on the
 * server named by `FLOWAID_TEST_DATABASE_URL` (a superuser connection), owned by the
 * non-superuser role `flowaid_owner`, migrated as that owner, and dropped afterwards. Suites skip
 * when the variable is unset.
 */
import { randomBytes } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { describe } from "vitest";
import { testDatabaseUrl } from "@flowaid/env/testing";
import { createDatabase, type Database } from "../db.js";
import { migrate } from "../migrate.js";

export const TEST_DATABASE_URL = testDatabaseUrl();
/** `describe` when a test server is configured, `describe.skip` otherwise. */
export const describeDb: ReturnType<typeof describe.runIf> = describe.runIf(
  Boolean(TEST_DATABASE_URL),
);

const PASSWORDS = { flowaid_owner: "owner-pw", flowaid_app: "app-pw", flowaid_code: "code-pw" };

function withCredentials(url: string, user: string, password: string, database?: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  if (database) u.pathname = `/${database}`;
  return u.toString();
}

async function ensureRoles(admin: Sql): Promise<void> {
  // Roles are cluster-wide; suites run in parallel, so serialise on an advisory lock.
  await admin.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(7201)`;
    for (const [role, password] of Object.entries(PASSWORDS)) {
      const exists = await tx`select 1 from pg_roles where rolname = ${role}`;
      const verb = exists.length ? "ALTER" : "CREATE";
      await tx.unsafe(
        `${verb} ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${password}'`,
      );
    }
  });
}

export interface TestDatabase {
  name: string;
  ownerUrl: string;
  appUrl: string;
  codeUrl: string;
  /** Superuser connection to the test database. */
  admin: Sql;
  /** Application pool (flowaid_app, RLS on). */
  app: Database;
  /** Owner pool (the migration role; RLS forced on it too). */
  owner: Database;
  drop(): Promise<void>;
}

export async function createTestDatabase(
  options: { partitionRunEvents?: boolean } = {},
): Promise<TestDatabase> {
  const serverUrl = TEST_DATABASE_URL;
  if (!serverUrl) throw new Error("FLOWAID_TEST_DATABASE_URL is not set");
  const name = `flowaid_t_${randomBytes(6).toString("hex")}`;
  const server = postgres(serverUrl, { max: 1, onnotice: () => undefined });
  await ensureRoles(server);
  await server.unsafe(`CREATE DATABASE ${name} OWNER flowaid_owner`);
  await server.end();

  const adminUrl = new URL(serverUrl);
  adminUrl.pathname = `/${name}`;
  const admin = postgres(adminUrl.toString(), { max: 2, onnotice: () => undefined });
  // pgvector is not a trusted extension: the superuser creates it; 0000_init skips it then.
  await admin`CREATE EXTENSION IF NOT EXISTS vector`;
  await admin.unsafe(`GRANT CONNECT ON DATABASE ${name} TO flowaid_app, flowaid_code`);

  const ownerUrl = withCredentials(serverUrl, "flowaid_owner", PASSWORDS.flowaid_owner, name);
  await migrate({ adminUrl: ownerUrl, partitionRunEvents: options.partitionRunEvents ?? false });

  const appUrl = withCredentials(serverUrl, "flowaid_app", PASSWORDS.flowaid_app, name);
  const codeUrl = withCredentials(serverUrl, "flowaid_code", PASSWORDS.flowaid_code, name);
  const app = createDatabase({ url: appUrl, max: 12, applicationName: "flowaid-test-app" });
  const owner = createDatabase({ url: ownerUrl, max: 4, applicationName: "flowaid-test-owner" });
  return {
    name,
    ownerUrl,
    appUrl,
    codeUrl,
    admin,
    app,
    owner,
    drop: async () => {
      await Promise.all([app.close(), owner.close()]);
      await admin.end();
      const s = postgres(serverUrl, { max: 1, onnotice: () => undefined });
      await s.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await s.end();
    },
  };
}
