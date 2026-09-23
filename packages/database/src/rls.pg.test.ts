import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@flowaid/shared";
import { PgRunStore } from "./stores/PgRunStore.js";
import { createTestDatabase, describeDb, type TestDatabase } from "./test/pg.js";
import { newRun, seedTenant, supportTriageLog, type Tenant } from "./test/golden.js";

/** drizzle wraps the driver error; the policy violation is its cause. */
const violatesRls = (error: unknown): boolean => {
  const e = error as { message?: string; cause?: { message?: string } };
  return /row-level security/.test(`${e.message ?? ""} ${e.cause?.message ?? ""}`);
};

describeDb("row-level security", () => {
  let t: TestDatabase;
  let a: Tenant;
  let b: Tenant;
  let tenantTables: string[];

  beforeAll(async () => {
    t = await createTestDatabase();
    a = await seedTenant(t.app, "tenant-a");
    b = await seedTenant(t.app, "tenant-b");
    // A full run per tenant fills runs, run_events, node_runs, human_tasks and run_timers.
    for (const tenant of [a, b]) {
      const store = new PgRunStore(t.app);
      const { run, created } = newRun(tenant);
      await store.createRun(run, created);
      await store.acquireLease(run.id, "w1", 30_000);
      let seq = 1;
      for (const batch of supportTriageLog().batches) {
        seq = (await store.appendEvents(run.id, batch, { leaseOwner: "w1", expectedSeq: seq }))
          .lastSeq;
      }
      await store.saveCheckpoint(run.id, seq, { done: true });
    }
    await t.admin`insert into templates (id, workspace_id, slug, name, description, category, definition)
      values (${uuidv7()}, null, 'global', 'Global', 'built-in', 'demo', '{}'),
             (${uuidv7()}, ${a.workspaceId}, 'mine', 'Mine', 'a', 'demo', '{}'),
             (${uuidv7()}, ${b.workspaceId}, 'theirs', 'Theirs', 'b', 'demo', '{}')`;
    await t.admin`insert into audit_events (id, workspace_id, actor_type, actor_id, action, resource_type, resource_id)
      values (${uuidv7()}, ${a.workspaceId}, 'user', 'u', 'x', 'r', '1'),
             (${uuidv7()}, ${b.workspaceId}, 'user', 'u', 'x', 'r', '2'),
             (${uuidv7()}, null, 'system', 's', 'auth.login', 'user', '3')`;
    tenantTables = (
      await t.admin<{ table_name: string }[]>`
        select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'workspace_id' order by table_name`
    ).map((r) => r.table_name);
  });
  afterAll(async () => {
    await t?.drop();
  });

  it("enables and forces RLS with a policy on every tenant and run-scoped table", async () => {
    const rows = await t.admin<
      { relname: string; rls: boolean; force: boolean; policies: number }[]
    >`
      select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as force,
             (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')`;
    const secured = new Map(rows.map((r) => [r.relname, r]));
    const expected = [
      ...tenantTables,
      "workspaces",
      "run_events",
      "run_checkpoints",
      "run_timers",
      "evaluation_results",
    ];
    expect(tenantTables).toHaveLength(34);
    for (const table of expected)
      expect(secured.get(table), table).toMatchObject({ rls: true, force: true, policies: 1 });
    for (const table of [
      "users",
      "identities",
      "refresh_tokens",
      "user_tokens",
      "encryption_keys",
      "queue_jobs",
    ])
      expect(secured.get(table)?.rls, table).toBe(false);
  });

  it("shows workspace A no row of workspace B on any tenant table", async () => {
    await t.app.tenant(a.workspaceId, async (tx) => {
      for (const table of tenantTables) {
        const leaked = await tx.execute<{ n: number }>(
          `select count(*)::int as n from "${table}" where workspace_id = '${b.workspaceId}'` as never,
        );
        expect(leaked[0]?.n, table).toBe(0);
      }
    });
  });

  it("scopes run-scoped tables through their run", async () => {
    const [ownA, ownB, all] = await Promise.all([
      t.app.tenant(a.workspaceId, (tx) => tx.execute(`select count(*)::int as n from run_events`)),
      t.app.tenant(b.workspaceId, (tx) => tx.execute(`select count(*)::int as n from run_events`)),
      t.app.system((tx) => tx.execute(`select count(*)::int as n from run_events`)),
    ]);
    const n = (r: unknown) => (r as { n: number }[])[0]?.n ?? -1;
    expect(n(ownA)).toBeGreaterThan(0);
    expect(n(ownA) + n(ownB)).toBe(n(all));
    for (const table of ["run_checkpoints", "run_timers"]) {
      const rows = await t.app.tenant(a.workspaceId, (tx) =>
        tx.execute(
          `select count(*)::int as n from ${table} x join runs r on r.id = x.run_id where r.workspace_id <> '${a.workspaceId}'` as never,
        ),
      );
      expect(n(rows), table).toBe(0);
    }
  });

  it("returns zero rows when no workspace is set, for the app and the owner", async () => {
    for (const pool of [t.app.sql, t.owner.sql]) {
      for (const table of [
        "runs",
        "workflows",
        "node_runs",
        "run_events",
        "workspaces",
        "templates",
      ]) {
        const rows = await pool.unsafe(`select count(*)::int as n from ${table}`);
        const n = (rows[0] as { n: number } | undefined)?.n;
        expect(n, `${table} without app.workspace_id`).toBe(table === "templates" ? 1 : 0);
      }
    }
  });

  it("lets every workspace read global rows but not write them, and hides unowned audit rows", async () => {
    const templates = await t.app.tenant(a.workspaceId, (tx) =>
      tx.execute(`select slug from templates order by slug`),
    );
    expect((templates as unknown as { slug: string }[]).map((r) => r.slug)).toEqual([
      "global",
      "mine",
    ]);
    await expect(
      t.app.tenant(a.workspaceId, (tx) =>
        tx.execute(
          `insert into templates (id, workspace_id, slug, name, description, category, definition) values ('${uuidv7()}', null, 'x', 'x', 'x', 'x', '{}')` as never,
        ),
      ),
    ).rejects.toSatisfy(violatesRls);
    const audit = await t.app.tenant(a.workspaceId, (tx) =>
      tx.execute(`select count(*)::int as n from audit_events`),
    );
    expect((audit as unknown as { n: number }[])[0]?.n).toBe(1);
  });

  it("rejects writes into another workspace", async () => {
    await expect(
      t.app.tenant(a.workspaceId, (tx) =>
        tx.execute(
          `insert into environments (id, workspace_id, name) values ('${uuidv7()}', '${b.workspaceId}', 'sneaky')` as never,
        ),
      ),
    ).rejects.toSatisfy(violatesRls);
    const moved = await t.app.tenant(a.workspaceId, (tx) =>
      tx.execute(
        `update workflows set name = 'x' where workspace_id = '${b.workspaceId}' returning id` as never,
      ),
    );
    expect(moved).toHaveLength(0);
  });

  it("rejects a malformed workspace id before it reaches SQL", async () => {
    await expect(t.app.tenant("' or 1=1 --", () => Promise.resolve(1))).rejects.toThrow(
      /not a workspace id/,
    );
  });

  describe("flowaid_code (the sandbox host)", () => {
    it("may insert events for its workspace's runs but read nothing else", async () => {
      const code = postgres(t.codeUrl, { max: 1, onnotice: () => undefined });
      try {
        const [run] = await t.admin<{ id: string; last_seq: number }[]>`
          select id, last_seq from runs where workspace_id = ${a.workspaceId} limit 1`;
        const runId = run?.id ?? "";
        await code.begin(async (tx) => {
          await tx`select set_config('app.workspace_id', ${a.workspaceId}, true)`;
          await tx`insert into run_events (run_id, seq, type, payload, at) values (${runId}, 9999, 'LOG', '{}', now())`;
        });
        await expect(
          code.begin(async (tx) => {
            await tx`select set_config('app.workspace_id', ${b.workspaceId}, true)`;
            await tx`insert into run_events (run_id, seq, type, payload, at) values (${runId}, 9998, 'LOG', '{}', now())`;
          }),
        ).rejects.toThrow(/row-level security/);
        await expect(code`select * from runs limit 1`).rejects.toThrow(/permission denied/);
        await expect(code`select * from credentials limit 1`).rejects.toThrow(/permission denied/);
        await expect(code`select * from run_events limit 1`).rejects.toThrow(/permission denied/);
      } finally {
        await code.end();
      }
    });
  });

  it("DB_RLS=false turns the policies off for the whole connection", async () => {
    const { createDatabase } = await import("./db.js");
    const open = createDatabase({ url: t.appUrl, rls: false, max: 1 });
    try {
      const rows = await open.sql`select count(distinct workspace_id)::int as n from runs`;
      expect((rows[0] as { n: number } | undefined)?.n).toBe(2);
    } finally {
      await open.close();
    }
  });
});
