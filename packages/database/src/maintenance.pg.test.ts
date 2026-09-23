import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7 } from "@flowaid/shared";
import { ConflictError, type WorkflowDefinition } from "@flowaid/workflow-core";
import { sweepRetention } from "./retention.js";
import { credentials, runs, secretReferences, templates } from "./schema.js";
import { seedTemplates } from "./seeds.js";
import { PgArtifactIndex } from "./stores/PgArtifactIndex.js";
import { PgCredentialRepository, PgKekStore } from "./stores/PgCredentialRepository.js";
import { PgRunStore } from "./stores/PgRunStore.js";
import { createTestDatabase, describeDb, type TestDatabase } from "./test/pg.js";
import { newRun, seedTenant, supportTriageLog, type Tenant } from "./test/golden.js";

describeDb("credentials, artifacts, retention and seeds", () => {
  let t: TestDatabase;
  let tenant: Tenant;
  beforeAll(async () => {
    t = await createTestDatabase();
    tenant = await seedTenant(t.app);
  });
  afterAll(async () => {
    await t?.drop();
  });

  describe("PgCredentialRepository", () => {
    const dbCred = uuidv7();
    const extCred = uuidv7();
    const pinned = uuidv7();
    beforeAll(async () => {
      const other = uuidv7();
      await t.app.tenant(tenant.workspaceId, async (tx) => {
        await tx.insert(credentials).values([
          {
            id: dbCred,
            workspaceId: tenant.workspaceId,
            name: "ts",
            type: "typesafe.api_key",
            ciphertext: "c",
            wrappedDataKey: "w",
            keyVersion: 1,
            scopes: ["decide"],
          },
          {
            id: extCred,
            workspaceId: tenant.workspaceId,
            name: "gh",
            type: "github.token",
            storage: "external",
            externalRef: "env:FLOWAID_SECRET_GH",
          },
          {
            id: pinned,
            workspaceId: tenant.workspaceId,
            name: "only-other",
            type: "http.bearer",
            ciphertext: "c",
            wrappedDataKey: "w",
            keyVersion: 1,
            allowedWorkflowIds: [other],
          },
        ]);
        await tx.insert(secretReferences).values([
          {
            workspaceId: tenant.workspaceId,
            workflowId: tenant.workflowId,
            environmentId: tenant.environmentId,
            secretName: "TYPESAFE",
            credentialId: dbCred,
          },
          {
            workspaceId: tenant.workspaceId,
            workflowId: tenant.workflowId,
            environmentId: tenant.environmentId,
            secretName: "PINNED",
            credentialId: pinned,
          },
        ]);
      });
    });

    it("maps storage onto provider (RFC-0010) and resolves bindings", async () => {
      const repo = new PgCredentialRepository(t.app);
      expect(await repo.getCiphertext(dbCred)).toMatchObject({
        provider: "db",
        ciphertext: "c",
        keyVersion: 1,
        scopes: ["decide"],
        workspaceId: tenant.workspaceId,
      });
      expect(await repo.getCiphertext(extCred)).toMatchObject({
        provider: "external",
        externalRef: "env:FLOWAID_SECRET_GH",
      });
      expect(await repo.getCiphertext(uuidv7())).toBeNull();
      expect(await repo.resolveBinding(tenant.workflowId, tenant.environmentId, "TYPESAFE")).toBe(
        dbCred,
      );
      expect(
        await repo.resolveBinding(tenant.workflowId, tenant.environmentId, "PINNED"),
      ).toBeNull();
      expect(
        await repo.resolveBinding(tenant.workflowId, tenant.environmentId, "MISSING"),
      ).toBeNull();
      await repo.touch(dbCred, new Date("2026-09-23T12:00:00.000Z"));
      const [row] = await t.app.system((tx) =>
        tx.select().from(credentials).where(eq(credentials.id, dbCred)),
      );
      expect(row?.lastUsedAt?.toISOString()).toBe("2026-09-23T12:00:00.000Z");
      expect(await repo.staleKeyVersion(2, 10)).toEqual(expect.arrayContaining([dbCred, pinned]));
      await repo.saveSealed(dbCred, {
        ciphertext: "c2",
        wrappedDataKey: "w2",
        keyVersion: 2,
        publicFields: {},
      });
      expect(await repo.staleKeyVersion(2, 10)).not.toContain(dbCred);
    });

    it("is invisible to another workspace", async () => {
      const other = await seedTenant(t.app);
      const scoped = new PgCredentialRepository(t.app, { workspaceId: other.workspaceId });
      expect(await scoped.getCiphertext(dbCred)).toBeNull();
    });
  });

  it("PgKekStore keeps exactly one active KEK and rewraps atomically", async () => {
    const keks = new PgKekStore(t.app);
    await keks.insert({
      version: 1,
      wrappedKek: "k1",
      masterProvider: "env",
      masterKcv: "kcv",
      active: true,
    });
    await keks.insert({
      version: 2,
      wrappedKek: "k2",
      masterProvider: "env",
      masterKcv: "kcv",
      active: true,
    });
    expect((await keks.list()).map((k) => [k.version, k.active])).toEqual([
      [1, false],
      [2, true],
    ]);
    await keks.activate(1);
    expect((await keks.list()).map((k) => k.active)).toEqual([true, false]);
    await expect(keks.activate(9)).rejects.toThrow(/does not exist/);
    await expect(
      keks.rewrap([
        { version: 1, wrappedKek: "x", masterProvider: "file", masterKcv: "n" },
        { version: 9, wrappedKek: "x", masterProvider: "file", masterKcv: "n" },
      ]),
    ).rejects.toThrow();
    expect((await keks.list())[0]?.wrappedKek).toBe("k1");
    await keks.rewrap([
      { version: 1, wrappedKek: "k1b", masterProvider: "file", masterKcv: "new" },
    ]);
    expect((await keks.list())[0]).toMatchObject({
      wrappedKek: "k1b",
      masterProvider: "file",
      masterKcv: "new",
    });
  });

  it("PgArtifactIndex generates storage keys and completes uploads once", async () => {
    const index = new PgArtifactIndex(t.app);
    const upload = await index.create({
      workspaceId: tenant.workspaceId,
      name: "../../etc/passwd",
      mimeType: "text/plain",
      kind: "upload",
      storage: "s3",
    });
    expect(upload).toMatchObject({
      status: "pending",
      storageKey: `ws/${tenant.workspaceId}/${upload.id}`,
    });
    expect(
      await index.markReady(tenant.workspaceId, upload.id, { bytes: 12, sha256: "ab" }),
    ).toMatchObject({ status: "ready", bytes: 12 });
    await expect(
      index.markReady(tenant.workspaceId, upload.id, { bytes: 1, sha256: "x" }),
    ).rejects.toBeInstanceOf(ConflictError);
    const written = await index.create({
      workspaceId: tenant.workspaceId,
      name: "out.json",
      mimeType: "application/json",
      kind: "output_overflow",
      storage: "local",
      bytes: 70_000,
      sha256: "cd",
      expiresAt: new Date(Date.now() - 1),
    });
    expect(written.status).toBe("ready");
    expect((await index.expired(new Date(), 10)).map((a) => a.id)).toEqual([written.id]);
    expect((await index.get(tenant.workspaceId, written.id))?.name).toBe("out.json");
    expect((await index.delete(tenant.workspaceId, written.id))?.id).toBe(written.id);
    expect(await index.get(tenant.workspaceId, written.id)).toBeNull();
  });

  it("sweeps expired runs but keeps their metrics row", async () => {
    const store = new PgRunStore(t.app);
    const { run, created } = newRun(tenant, {
      idempotencyKey: "old-key",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await store.createRun(run, created);
    await store.acquireLease(run.id, "w1", 30_000);
    let seq = 1;
    for (const batch of supportTriageLog().batches)
      seq = (await store.appendEvents(run.id, batch, { leaseOwner: "w1", expectedSeq: seq }))
        .lastSeq;
    await store.saveCheckpoint(run.id, 3, {});
    await store.saveCheckpoint(run.id, seq, {});
    await t.admin`update runs set expires_at = now() - interval '1 minute' where id = ${run.id}`;
    const result = await sweepRetention(t.app);
    expect(result).toMatchObject({ expiredRuns: 1, idempotencyKeys: 1 });
    const [row] = await t.app.system((tx) => tx.select().from(runs).where(eq(runs.id, run.id)));
    expect(row).toMatchObject({
      status: "completed",
      input: null,
      output: null,
      costUsd: "0.000870",
      idempotencyKey: null,
      expiresAt: null,
    });
    expect(await store.listEvents(run.id, 0, 10)).toEqual([]);
    expect(await store.listNodeRuns(run.id)).toEqual([]);
    expect(await sweepRetention(t.app)).toMatchObject({ expiredRuns: 0, idempotencyKeys: 0 });
  });

  it("keeps the last checkpoint of finished runs and two of active ones", async () => {
    const store = new PgRunStore(t.app);
    const { run, created } = newRun(tenant);
    await store.createRun(run, created);
    for (const seq of [1, 2, 3, 4]) await store.saveCheckpoint(run.id, seq, {});
    expect((await sweepRetention(t.app)).checkpoints).toBeGreaterThanOrEqual(2);
    expect(await store.latestCheckpoint(run.id, 2)).toBeNull();
    expect((await store.latestCheckpoint(run.id, 99))?.seq).toBe(4);
  });

  it("upserts built-in templates by slug", async () => {
    const definition = {
      name: "Support triage",
      description: "Route tickets",
      secrets: [{ name: "TYPESAFE" }],
      nodes: [],
      edges: [],
    } as unknown as WorkflowDefinition;
    await t.app.system((tx) =>
      seedTemplates(tx, [{ slug: "support-triage", category: "support", definition }]),
    );
    await t.app.system((tx) =>
      seedTemplates(tx, [
        {
          slug: "support-triage",
          category: "support",
          definition: { ...definition, description: "v2" },
          requiredResources: {
            mcpServers: [],
            knowledgeSources: [{ key: "kb", description: "Help center" }],
          },
        },
      ]),
    );
    const rows = await t.app.system((tx) => tx.select().from(templates));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspaceId: null,
      name: "Support triage",
      description: "v2",
      requiredSecrets: [{ name: "TYPESAFE" }],
    });
    expect(rows[0]?.requiredResources.knowledgeSources).toHaveLength(1);
  });
});

describeDb("partitioned run_events (RUN_EVENTS_PARTITIONED=true)", () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await createTestDatabase({ partitionRunEvents: true });
  });
  afterAll(async () => {
    await t?.drop();
  });

  it("creates monthly partitions three months ahead and keeps RLS and the run store working", async () => {
    const parts = await t.admin<{ relname: string }[]>`
      select c.relname from pg_inherits i join pg_class c on c.oid = i.inhrelid
      where i.inhparent = 'public.run_events'::regclass order by c.relname`;
    expect(parts.map((p) => p.relname)).toContain("run_events_default");
    expect(parts.filter((p) => /^run_events_\d{4}_\d{2}$/.test(p.relname))).toHaveLength(4);
    const [secured] =
      await t.admin`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'run_events'`;
    expect(secured).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

    const tenant = await seedTenant(t.app);
    const store = new PgRunStore(t.app);
    const { run, created } = newRun(tenant);
    await store.createRun(run, created);
    await store.acquireLease(run.id, "w1", 30_000);
    let seq = 1;
    for (const batch of supportTriageLog().batches)
      seq = (await store.appendEvents(run.id, batch, { leaseOwner: "w1", expectedSeq: seq }))
        .lastSeq;
    expect(await store.listEvents(run.id, 0, 1000)).toHaveLength(seq);
    expect((await store.getRun(run.id))?.status).toBe("completed");
    const [ensured] = await t.admin`select flowaid_ensure_run_events_partitions(3) as n`;
    expect(ensured).toEqual({ n: 0 });
  });
});
