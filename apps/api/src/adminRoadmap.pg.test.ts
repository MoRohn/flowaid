/**
 * Triggers, integrations, credentials and settings fixes from the 2026-10 product roadmap
 * (docs/project/PRODUCT_ROADMAP_2026-10.md, A-14 and track E).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { FakeWorker } from "./test/fakeWorker.js";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

describeDb("admin roadmap (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  let worker: FakeWorker;
  let envs: Record<string, string>;
  beforeAll(async () => {
    t = await createTestApp();
    jar = await login(t.app);
    envs = Object.fromEntries(
      (
        (await call(t.app, jar, "GET", "/v1/environments")).json() as { id: string; name: string }[]
      ).map((e) => [e.name, e.id]),
    );
    worker = new FakeWorker(t.db.app, () => "complete");
    await worker.start();
  });
  afterAll(async () => {
    await worker.stop();
    await t.close();
  });

  const create = async (name: string, triggers: unknown[] = []) => {
    const w = (await call(t.app, jar, "POST", "/v1/workflows", { name })).json();
    const saved = await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id as string}/draft`,
      { definition: { ...w.draft, triggers } },
      { "if-match": String(w.draftRevision) },
    );
    expect(saved.statusCode).toBe(200);
    return { id: w.id as string };
  };
  const publish = async (id: string) => {
    const v = await call(t.app, jar, "POST", `/v1/workflows/${id}/publish`, {});
    expect(v.statusCode).toBe(201);
    return v.json().id as string;
  };
  const deploy = (id: string, versionId: string, env = "dev") =>
    call(t.app, jar, "PUT", `/v1/workflows/${id}/deployments/${envs[env] as string}`, {
      versionId,
    });
  const hook = (path: string, body: string) =>
    t.app.inject({
      method: "POST",
      url: `/hooks/default/${path}`,
      payload: body,
      headers: { "content-type": "application/json" },
    });
  const list = async <T>(url: string) =>
    ((await call(t.app, jar, "GET", url)).json() as { items: T[] }).items;

  describe("A-14: names of switched-off triggers", () => {
    it("a switched-off webhook path or MCP tool name passes to another workflow", async () => {
      const triggers = [
        { type: "webhook", path: "handed-over", signature: "none" },
        { type: "mcp", toolName: "handed_over", description: "First owner" },
      ];
      const first = await create("First owner", triggers);
      const firstVersion = await publish(first.id);
      const firstDeploy = await deploy(first.id, firstVersion);
      expect(firstDeploy.statusCode).toBe(200);
      const firstHook = firstDeploy.json().triggers.webhooks[0].id as string;
      const firstTool = firstDeploy.json().triggers.mcpExposures[0].id as string;

      const second = await create("Second owner", triggers);
      const secondVersion = await publish(second.id);
      // both are on: the names are taken
      const refused = await deploy(second.id, secondVersion);
      expect(refused.statusCode).toBe(422);
      expect(JSON.stringify(refused.json())).toContain("E_TRIGGER_CONFLICT");

      // the first owner switches both off: the second takes the names over
      await call(t.app, jar, "PATCH", `/v1/webhooks/${firstHook}`, { enabled: false });
      const stillTool = await deploy(second.id, secondVersion);
      expect(stillTool.statusCode).toBe(422);
      expect(JSON.stringify(stillTool.json())).toContain("MCP tool name");
      await call(t.app, jar, "PATCH", `/v1/mcp/exposures/${firstTool}`, { enabled: false });
      const taken = await deploy(second.id, secondVersion);
      expect(taken.statusCode).toBe(200);

      const hooks = await list<{ id: string; path: string; workflowId: string; enabled: boolean }>(
        "/v1/webhooks?limit=200",
      );
      const atPath = hooks.filter((h) => h.path === "dev/handed-over");
      expect(atPath).toEqual([expect.objectContaining({ workflowId: second.id, enabled: true })]);
      const tools = await list<{ toolName: string; workflowId: string; enabled: boolean }>(
        "/v1/mcp/exposures?limit=200",
      );
      expect(tools.filter((x) => x.toolName === "handed_over")).toEqual([
        expect.objectContaining({ workflowId: second.id, enabled: true }),
      ]);
      const run = await hook("dev/handed-over", JSON.stringify({ message: "hi" }));
      expect(run.statusCode).toBe(202);

      // the first owner can't take them back while the second's are on
      expect((await deploy(first.id, firstVersion)).statusCode).toBe(422);
    });

    it("a switched-off manual exposure's tool name can be exposed again", async () => {
      const a = await create("Manual first");
      const b = await create("Manual second");
      const first = await call(t.app, jar, "POST", "/v1/mcp/exposures", {
        workflowId: a.id,
        environmentId: envs.dev,
        toolName: "manual_handover",
        description: "first",
      });
      expect(first.statusCode).toBe(201);
      const dup = await call(t.app, jar, "POST", "/v1/mcp/exposures", {
        workflowId: b.id,
        environmentId: envs.dev,
        toolName: "manual_handover",
        description: "second",
      });
      expect(dup.statusCode).toBe(409);
      await call(t.app, jar, "PATCH", `/v1/mcp/exposures/${first.json().exposure.id as string}`, {
        enabled: false,
      });
      const again = await call(t.app, jar, "POST", "/v1/mcp/exposures", {
        workflowId: b.id,
        environmentId: envs.dev,
        toolName: "manual_handover",
        description: "second",
      });
      expect(again.statusCode).toBe(201);
      expect(again.json().exposure.workflowId).toBe(b.id);
    });
  });

  describe("E-01: signing secrets belong to their webhook or channel", () => {
    const credentialIds = async () =>
      (await list<{ id: string }>("/v1/credentials?limit=200")).map((c) => c.id);

    it("a webhook's secret is not listed, replaces the previous one, and can't be broken from Credentials", async () => {
      const w = await create("Signed hook", [
        { type: "webhook", path: "signed-owned", signature: "hmac_sha256" },
      ]);
      const hookId = (await deploy(w.id, await publish(w.id))).json().triggers.webhooks[0]
        .id as string;
      const before = await credentialIds();
      const first = await call(t.app, jar, "POST", `/v1/webhooks/${hookId}/rotate-secret`);
      expect(first.statusCode).toBe(200);
      const second = await call(t.app, jar, "POST", `/v1/webhooks/${hookId}/rotate-secret`);
      const secretId = second.json().credentialId as string;
      // the list doesn't grow, and the previous secret is gone
      expect(await credentialIds()).toEqual(before);
      expect(
        (await call(t.app, jar, "GET", `/v1/credentials/${first.json().credentialId as string}`))
          .statusCode,
      ).toBe(404);
      const owned = await call(t.app, jar, "GET", `/v1/credentials/${secretId}`);
      expect(owned.json().owner).toEqual({
        kind: "webhook",
        id: hookId,
        name: "dev/signed-owned",
      });

      const del = await call(t.app, jar, "DELETE", `/v1/credentials/${secretId}?force=true`);
      expect(del.statusCode).toBe(409);
      expect(del.json().error.message).toContain("webhook dev/signed-owned");
      const rotate = await call(t.app, jar, "POST", `/v1/credentials/${secretId}/rotate`, {
        values: { value: "replaced" },
      });
      expect(rotate.statusCode).toBe(409);
      const rename = await call(t.app, jar, "PATCH", `/v1/credentials/${secretId}`, {
        name: "mine now",
      });
      expect(rename.statusCode).toBe(409);
      const hooks = await list<{ id: string; secretBound: boolean }>("/v1/webhooks?limit=200");
      expect(hooks.find((h) => h.id === hookId)?.secretBound).toBe(true);

      // another webhook can't borrow it
      const other = await create("Borrower", [
        { type: "webhook", path: "borrower", signature: "hmac_sha256" },
      ]);
      const otherHook = (await deploy(other.id, await publish(other.id))).json().triggers
        .webhooks[0].id as string;
      const borrow = await call(t.app, jar, "PATCH", `/v1/webhooks/${otherHook}`, {
        secretCredentialId: secretId,
      });
      expect(borrow.statusCode).toBe(409);
    });

    it("a notification channel's secret is not listed and rotates in place", async () => {
      const before = await credentialIds();
      const created = await call(t.app, jar, "POST", "/v1/notifications", {
        kind: "webhook",
        name: "Ops hook",
        config: { url: "http://127.0.0.1:9/flowaid-test" },
        events: ["run.failed"],
      });
      expect(created.statusCode).toBe(201);
      const channelId = created.json().channel.id as string;
      for (let i = 0; i < 2; i++)
        expect(
          (await call(t.app, jar, "POST", `/v1/notifications/${channelId}/rotate-secret`))
            .statusCode,
        ).toBe(200);
      expect(await credentialIds()).toEqual(before);
      const [secret] = (await t.db.admin`
        select id, owner_notification_id from credentials where owner_notification_id = ${channelId}
      `) as unknown as { id: string }[];
      expect(secret).toBeTruthy();
      const del = await call(t.app, jar, "DELETE", `/v1/credentials/${secret?.id as string}`);
      expect(del.statusCode).toBe(409);
      expect(del.json().error.message).toContain("Ops hook");

      // deleting the channel deletes its secret
      expect((await call(t.app, jar, "DELETE", `/v1/notifications/${channelId}`)).statusCode).toBe(
        204,
      );
      const left = await t.db.admin`select id from credentials where id = ${secret?.id as string}`;
      expect(left.length).toBe(0);
    });

    it("the migration marks secrets made before owners existed, and runs again safely", async () => {
      const w = await create("Legacy hook", [
        { type: "webhook", path: "legacy-owned", signature: "hmac_sha256" },
      ]);
      const hookId = (await deploy(w.id, await publish(w.id))).json().triggers.webhooks[0]
        .id as string;
      const current = (
        await call(t.app, jar, "POST", `/v1/webhooks/${hookId}/rotate-secret`)
      ).json().credentialId as string;
      // what a database from before 0016 holds: the current secret and a left-over one, unowned
      const sealed = await t.ctx.credentials.seal(current, "http.header", {
        name: "X-Signature-Secret",
        value: "old",
      });
      const [ws] = await t.db.admin`select workspace_id from webhooks where id = ${hookId}`;
      await t.db.admin`update credentials set owner_webhook_id = null where id = ${current}`;
      await t.db.admin`
        insert into credentials (id, workspace_id, name, type, storage, ciphertext, wrapped_data_key, key_version, public_fields)
        values (gen_random_uuid(), ${ws?.workspace_id as string}, 'webhook dev/legacy-owned 2026-01-01T00:00:00.000Z', 'http.header', 'db',
          ${sealed.ciphertext}, ${sealed.wrappedDataKey}, ${sealed.keyVersion}, '{}'::jsonb)`;
      const named = await t.db.admin`
        select count(*)::int as n from credentials where name like 'webhook dev/legacy-owned %' and owner_webhook_id is null`;
      expect(named[0]?.n).toBe(2);

      const { readFileSync } = await import("node:fs");
      const { MIGRATIONS_DIR } = await import("@flowaid/database");
      const migration = readFileSync(`${MIGRATIONS_DIR}/0016_credential_owner.sql`, "utf8");
      for (let i = 0; i < 2; i++)
        for (const statement of migration.split("--> statement-breakpoint"))
          await t.db.owner.sql.unsafe(statement);
      const owned = await t.db.admin`
        select count(*)::int as n from credentials where name like 'webhook dev/legacy-owned %' and owner_webhook_id = ${hookId}`;
      expect(owned[0]?.n).toBe(2);
    });
  });
});
