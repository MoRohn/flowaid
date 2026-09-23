import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { ConflictError, NotFoundError, type WorkflowDefinition } from "@flowaid/workflow-core";
import { PgRunStore } from "../stores/PgRunStore.js";
import { createTestDatabase, describeDb, type TestDatabase } from "../test/pg.js";
import { newRun } from "../test/golden.js";
import {
  activeDeployment,
  bindSecret,
  bumpTokenVersion,
  consumeUserToken,
  createApiKey,
  createUser,
  createUserToken,
  createWorkflow,
  createWorkspace,
  credentialUsage,
  deploy,
  deploymentHistory,
  draftVersion,
  findActiveApiKey,
  findRunByIdempotencyKey,
  findUserByEmail,
  getMembership,
  issueRefreshToken,
  listAudit,
  listHumanTasks,
  listRuns,
  listSecretBindings,
  listUserWorkspaces,
  listVersions,
  publishVersion,
  recordAudit,
  revokeAllSessions,
  revokeApiKey,
  rollback,
  rotateApiKey,
  rotateRefreshToken,
  saveDraft,
  setMembership,
  touchApiKey,
  unbindSecret,
} from "./index.js";
import { credentials } from "../schema.js";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const definition = { schemaVersion: 1, nodes: [], edges: [] } as unknown as WorkflowDefinition;
const content = (hash: string) => ({
  definition,
  definitionHash: `d-${hash}`,
  plan: {} as never,
  planHash: hash,
  compilerVersion: "0.1.0",
  catalogSnapshot: {},
});

describeDb("repositories", () => {
  let t: TestDatabase;
  let userId: string;
  let workspaceId: string;
  let envs: Record<string, string>;
  beforeAll(async () => {
    t = await createTestDatabase();
    const created = await t.app.system(async (tx) => {
      const user = await createUser(tx, {
        email: "Owner@Example.com",
        name: "Owner",
        status: "active",
      });
      return {
        user,
        ...(await createWorkspace(tx, { slug: "acme", name: "Acme", ownerUserId: user.id })),
      };
    });
    userId = created.user.id;
    workspaceId = created.workspace.id;
    envs = Object.fromEntries(created.environments.map((e) => [e.name, e.id]));
  });
  afterAll(async () => {
    await t?.drop();
  });

  describe("workspaces and identity", () => {
    it("creates a workspace with its owner and the three environments", async () => {
      const [ws] = await t.app.system((tx) => listUserWorkspaces(tx, userId));
      expect(ws).toMatchObject({ role: "owner", workspace: { slug: "acme" } });
      expect(Object.keys(envs).sort()).toEqual(["dev", "prod", "staging"]);
      const prod = await t.app.tenant(workspaceId, (tx) =>
        tx.query.environments.findFirst({ where: (e, { eq }) => eq(e.name, "prod") }),
      );
      expect(prod?.protected).toBe(true);
      await t.app.system((tx) => setMembership(tx, workspaceId, userId, "admin"));
      expect(await t.app.system((tx) => getMembership(tx, workspaceId, userId))).toBe("admin");
    });

    it("finds users case-insensitively and bumps the token version", async () => {
      const found = await t.app.system((tx) => findUserByEmail(tx, "  owner@EXAMPLE.com "));
      expect(found?.id).toBe(userId);
      expect(await t.app.system((tx) => bumpTokenVersion(tx, userId))).toBe(1);
      await expect(
        t.app.system((tx) => createUser(tx, { email: "OWNER@example.com", name: "Dup" })),
      ).rejects.toThrow();
    });

    it("rotates refresh tokens and revokes the family on reuse", async () => {
      const soon = new Date(Date.now() + 3_600_000);
      const first = await t.app.system((tx) =>
        issueRefreshToken(tx, { userId, tokenHash: sha("r1"), expiresAt: soon }),
      );
      const second = await t.app.system((tx) =>
        rotateRefreshToken(tx, sha("r1"), { tokenHash: sha("r2"), expiresAt: soon }),
      );
      expect(second).toMatchObject({ status: "rotated", userId });
      // The stolen first token is presented again: the family dies, including r2.
      const reused = await t.app.system((tx) =>
        rotateRefreshToken(tx, sha("r1"), { tokenHash: sha("r3"), expiresAt: soon }),
      );
      expect(reused).toEqual({ status: "reused", userId, familyId: first.familyId });
      expect(
        await t.app.system((tx) =>
          rotateRefreshToken(tx, sha("r2"), { tokenHash: sha("r4"), expiresAt: soon }),
        ),
      ).toEqual({ status: "invalid" });
      expect(
        await t.app.system((tx) =>
          rotateRefreshToken(tx, sha("nope"), { tokenHash: sha("r5"), expiresAt: soon }),
        ),
      ).toEqual({ status: "invalid" });
      await t.app.system((tx) =>
        issueRefreshToken(tx, { userId, tokenHash: sha("r6"), expiresAt: soon }),
      );
      await t.app.system((tx) => revokeAllSessions(tx, userId));
      expect(
        await t.app.system((tx) =>
          rotateRefreshToken(tx, sha("r6"), { tokenHash: sha("r7"), expiresAt: soon }),
        ),
      ).toEqual({ status: "invalid" });
    });

    it("consumes single-use tokens once and never after expiry", async () => {
      await t.app.system(async (tx) => {
        await createUserToken(tx, {
          userId,
          kind: "password_reset",
          tokenHash: sha("reset"),
          expiresAt: new Date(Date.now() + 60_000),
        });
        await createUserToken(tx, {
          userId,
          kind: "invite",
          tokenHash: sha("old"),
          expiresAt: new Date(Date.now() - 1),
        });
      });
      const results = await Promise.all(
        [1, 2, 3].map(() =>
          t.app.system((tx) => consumeUserToken(tx, "password_reset", sha("reset"))),
        ),
      );
      expect(results.filter(Boolean)).toEqual([{ userId }]);
      expect(await t.app.system((tx) => consumeUserToken(tx, "invite", sha("old")))).toBeNull();
      expect(await t.app.system((tx) => consumeUserToken(tx, "invite", sha("reset")))).toBeNull();
    });
  });

  describe("api keys", () => {
    it("finds live keys by hash, rotates with a grace period and revokes", async () => {
      const key = await t.app.tenant(workspaceId, (tx) =>
        createApiKey(tx, {
          workspaceId,
          name: "ci",
          prefix: "fa_live_abcd1234",
          keyHash: sha("k1"),
          scopes: ["runs:create"],
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      );
      expect((await t.app.system((tx) => findActiveApiKey(tx, sha("k1"))))?.id).toBe(key.id);
      await t.app.system((tx) => touchApiKey(tx, key.id));
      const next = await t.app.tenant(workspaceId, (tx) =>
        rotateApiKey(tx, key.id, {
          prefix: "fa_live_efgh5678",
          keyHash: sha("k2"),
          expiresAt: new Date(Date.now() + 86_400_000),
          graceMs: 0,
        }),
      );
      expect(next?.scopes).toEqual(["runs:create"]);
      expect(await t.app.system((tx) => findActiveApiKey(tx, sha("k1")))).toBeNull();
      expect((await t.app.system((tx) => findActiveApiKey(tx, sha("k2"))))?.id).toBe(next?.id);
      expect(await t.app.tenant(workspaceId, (tx) => revokeApiKey(tx, next?.id ?? ""))).toBe(true);
      expect(await t.app.tenant(workspaceId, (tx) => revokeApiKey(tx, next?.id ?? ""))).toBe(false);
      expect(await t.app.system((tx) => findActiveApiKey(tx, sha("k2")))).toBeNull();
    });
  });

  describe("workflows, versions and deployments", () => {
    let workflowId: string;
    beforeAll(async () => {
      workflowId = (
        await t.app.tenant(workspaceId, (tx) =>
          createWorkflow(tx, { workspaceId, name: "Triage", slug: "triage", draft: definition }),
        )
      ).id;
    });

    it("saves drafts with optimistic concurrency", async () => {
      expect(
        await t.app.tenant(workspaceId, (tx) => saveDraft(tx, workflowId, 1, definition, [])),
      ).toBe(2);
      const stale = await t.app
        .tenant(workspaceId, (tx) => saveDraft(tx, workflowId, 1, definition, []))
        .catch((e: unknown) => e);
      expect(stale).toBeInstanceOf(ConflictError);
      expect((stale as ConflictError).details).toEqual({ currentRevision: 2 });
      await expect(
        t.app.tenant(workspaceId, (tx) => saveDraft(tx, workspaceId, 1, definition, [])),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("numbers published versions densely, even when publishing concurrently", async () => {
      const published = await Promise.all(
        ["a", "b", "c", "d"].map((h) =>
          t.app.tenant(workspaceId, (tx) => publishVersion(tx, { workflowId, ...content(h) })),
        ),
      );
      expect(published.map((v) => v.version).sort()).toEqual([1, 2, 3, 4]);
      expect(
        (await t.app.tenant(workspaceId, (tx) => listVersions(tx, workflowId))).map(
          (v) => v.version,
        ),
      ).toEqual([4, 3, 2, 1]);
      const d1 = await t.app.tenant(workspaceId, (tx) =>
        draftVersion(tx, { workspaceId, workflowId, revision: 2, ...content("draft-x") }),
      );
      const d2 = await t.app.tenant(workspaceId, (tx) =>
        draftVersion(tx, { workspaceId, workflowId, revision: 3, ...content("draft-x") }),
      );
      expect(d2.id).toBe(d1.id);
      expect(d1).toMatchObject({ kind: "draft", version: null, label: "draft@rev2" });
    });

    it("deploys atomically and rolls back one step", async () => {
      const versions = await t.app.tenant(workspaceId, (tx) => listVersions(tx, workflowId));
      const [v4, v3] = versions;
      const env = envs.prod ?? "";
      await t.app.tenant(workspaceId, (tx) =>
        deploy(tx, {
          workflowId,
          environmentId: env,
          versionId: v3?.id ?? "",
          variableOverrides: { tone: "formal" },
        }),
      );
      const second = await t.app.tenant(workspaceId, (tx) =>
        deploy(tx, { workflowId, environmentId: env, versionId: v4?.id ?? "" }),
      );
      expect(second).toMatchObject({
        previousVersionId: v3?.id,
        variableOverrides: { tone: "formal" },
      });
      const back = await t.app.tenant(workspaceId, (tx) => rollback(tx, workflowId, env));
      expect(back.versionId).toBe(v3?.id);
      expect(
        (await t.app.tenant(workspaceId, (tx) => activeDeployment(tx, workflowId, env)))?.id,
      ).toBe(back.id);
      expect(
        (await t.app.tenant(workspaceId, (tx) => deploymentHistory(tx, workflowId))).filter(
          (d) => d.active,
        ),
      ).toHaveLength(1);
      await expect(
        t.app.tenant(workspaceId, (tx) => rollback(tx, workflowId, envs.dev ?? "")),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(
        t.app.tenant(workspaceId, (tx) =>
          deploy(tx, { workflowId, environmentId: env, versionId: workspaceId }),
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("binds secrets per environment and reports where a credential is used", async () => {
      const credentialId = "0192f0a1-5b3c-7d4e-8f60-00000000cc01";
      await t.app.tenant(workspaceId, async (tx) => {
        await tx.insert(credentials).values({
          id: credentialId,
          workspaceId,
          name: "ts",
          type: "typesafe.api_key",
          ciphertext: "x",
          wrappedDataKey: "y",
          keyVersion: 1,
        });
        await bindSecret(tx, {
          workspaceId,
          workflowId,
          environmentId: envs.dev ?? "",
          secretName: "TYPESAFE",
          credentialId,
        });
        await bindSecret(tx, {
          workspaceId,
          workflowId,
          environmentId: envs.dev ?? "",
          secretName: "TYPESAFE",
          credentialId,
        });
      });
      expect(
        await t.app.tenant(workspaceId, (tx) => listSecretBindings(tx, workflowId)),
      ).toHaveLength(1);
      expect(
        await t.app.tenant(workspaceId, (tx) => credentialUsage(tx, credentialId)),
      ).toHaveLength(1);
      await t.app.tenant(workspaceId, (tx) =>
        unbindSecret(tx, workflowId, envs.dev ?? "", "TYPESAFE"),
      );
      expect(
        await t.app.tenant(workspaceId, (tx) => listSecretBindings(tx, workflowId)),
      ).toHaveLength(0);
    });

    it("lists runs with keyset pagination and finds them by idempotency key", async () => {
      const [version] = await t.app.tenant(workspaceId, (tx) => listVersions(tx, workflowId));
      const tenant = {
        workspaceId,
        environmentId: envs.dev ?? "",
        workflowId,
        versionId: version?.id ?? "",
      };
      const store = new PgRunStore(t.app, { workspaceId });
      for (let i = 0; i < 5; i += 1) {
        const { run, created } = newRun(tenant, {
          createdAt: new Date(Date.UTC(2026, 8, 23, 10, i)).toISOString(),
          idempotencyKey: i === 2 ? "idem-2" : null,
        });
        await store.createRun(run, created);
      }
      const page1 = await t.app.tenant(workspaceId, (tx) =>
        listRuns(tx, { workspaceId, limit: 2 }),
      );
      const page2 = await t.app.tenant(workspaceId, (tx) =>
        listRuns(tx, { workspaceId, limit: 2, cursor: page1.nextCursor }),
      );
      const page3 = await t.app.tenant(workspaceId, (tx) =>
        listRuns(tx, { workspaceId, limit: 2, cursor: page2.nextCursor }),
      );
      const all = [...page1.items, ...page2.items, ...page3.items].map((r) => r.createdAt);
      expect(all).toEqual([...all].sort().reverse());
      expect(new Set(all).size).toBe(5);
      expect(page3.nextCursor).toBeNull();
      expect(
        (
          await t.app.tenant(workspaceId, (tx) =>
            findRunByIdempotencyKey(tx, workspaceId, "idem-2"),
          )
        )?.createdAt,
      ).toBe("2026-09-23T10:02:00.000Z");
      expect(
        await t.app.tenant(workspaceId, (tx) =>
          listRuns(tx, { workspaceId, status: ["completed"] }),
        ),
      ).toMatchObject({ items: [] });
      expect(
        await t.app.tenant(workspaceId, (tx) =>
          listHumanTasks(tx, { workspaceId, status: ["open"] }),
        ),
      ).toEqual([]);
    });

    it("records audit events", async () => {
      await t.app.tenant(workspaceId, (tx) =>
        recordAudit(tx, {
          workspaceId,
          actorType: "user",
          actorId: userId,
          action: "workflow.publish",
          resourceType: "workflow",
          resourceId: workflowId,
          details: { version: 4 },
        }),
      );
      const [event] = await t.app.tenant(workspaceId, (tx) => listAudit(tx, workspaceId));
      expect(event).toMatchObject({ action: "workflow.publish", details: { version: 4 } });
    });
  });
});
