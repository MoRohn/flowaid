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

  describe("E-02: where a credential is used", () => {
    it("lists every use and refuses a delete until they are gone, unless forced by an admin", async () => {
      const cred = (
        await call(t.app, jar, "POST", "/v1/credentials", {
          name: "CRM token (uses)",
          type: "http.bearer",
          values: { token: "test-not-a-real-key" },
        })
      ).json() as { id: string };
      // a workflow binds it, and an MCP server authenticates with it
      const w = (await call(t.app, jar, "POST", "/v1/workflows", { name: "Uses CRM" })).json();
      await call(
        t.app,
        jar,
        "PUT",
        `/v1/workflows/${w.id as string}/draft`,
        { definition: { ...w.draft, secrets: [{ name: "CRM", credentialType: "http.bearer" }] } },
        { "if-match": String(w.draftRevision) },
      );
      expect(
        (
          await call(t.app, jar, "PUT", `/v1/workflows/${w.id as string}/secrets/${envs.dev}`, {
            CRM: cred.id,
          })
        ).statusCode,
      ).toBe(200);
      const server = await call(t.app, jar, "POST", "/v1/mcp/servers", {
        name: "CRM tools",
        transport: "streamable_http",
        url: "http://127.0.0.1:9/mcp",
        authKind: "headers",
        credentialId: cred.id,
      });
      expect(server.statusCode).toBe(201);

      const uses = (await call(t.app, jar, "GET", `/v1/credentials/${cred.id}/uses`)).json();
      expect(uses).toEqual([
        expect.objectContaining({
          kind: "workflow_secret",
          id: w.id,
          name: "Uses CRM",
          environmentId: envs.dev,
          secretName: "CRM",
        }),
        expect.objectContaining({ kind: "mcp_server", id: server.json().id, name: "CRM tools" }),
      ]);

      const refused = await call(t.app, jar, "DELETE", `/v1/credentials/${cred.id}`);
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error.message).toContain(
        "the secret CRM of the workflow Uses CRM and the MCP server CRM tools",
      );
      expect(refused.json().error.details.uses).toHaveLength(2);
      // ?force=false is not force
      expect(
        (await call(t.app, jar, "DELETE", `/v1/credentials/${cred.id}?force=false`)).statusCode,
      ).toBe(409);

      // unbind and delete: the binding goes, the server keeps working without the credential
      expect(
        (await call(t.app, jar, "DELETE", `/v1/credentials/${cred.id}?force=true`)).statusCode,
      ).toBe(204);
      const after = (
        await call(t.app, jar, "GET", `/v1/mcp/servers/${server.json().id as string}`)
      ).json();
      expect(after.credentialId).toBeNull();
      const bindings = (
        await call(t.app, jar, "GET", `/v1/workflows/${w.id as string}/secrets/${envs.dev}`)
      ).json();
      expect(bindings).toEqual({});
    });
  });

  describe("E-03: a schedule's Run now", () => {
    it("records the run as the schedule's last run", async () => {
      const w = await create("Run me now", [
        { type: "schedule", cron: "0 3 1 1 *", input: { message: "yearly" } },
      ]);
      const scheduleId = (await deploy(w.id, await publish(w.id))).json().triggers.schedules[0]
        .id as string;
      const fired = await call(t.app, jar, "POST", `/v1/schedules/${scheduleId}/trigger`);
      expect(fired.statusCode).toBe(202);
      const runId = fired.json().run_id as string;
      const row = (
        await list<{ id: string; lastRunId: string | null; lastRunAt: string | null }>(
          `/v1/schedules?workflowId=${w.id}`,
        )
      ).find((x) => x.id === scheduleId);
      expect(row?.lastRunId).toBe(runId);
      expect(row?.lastRunAt).not.toBeNull();
    });
  });

  describe("E-06: MCP servers can be edited, and their errors are named", () => {
    it("a changed address sets the status back to pending", async () => {
      const created = await call(t.app, jar, "POST", "/v1/mcp/servers", {
        name: "Editable MCP",
        transport: "streamable_http",
        url: "http://127.0.0.1:9/mcp",
        authKind: "none",
      });
      const id = created.json().id as string;
      // nothing listens on port 9: the saved test fails and the row says so at once
      const tested = await call(t.app, jar, "POST", `/v1/mcp/servers/${id}/test`);
      expect(tested.json().ok).toBe(false);
      const failed = (await call(t.app, jar, "GET", `/v1/mcp/servers/${id}`)).json();
      expect(failed.status).toBe("error");
      expect(failed.lastError).toBeTruthy();
      expect(failed.lastCheckedAt).not.toBeNull();

      const renamed = await call(t.app, jar, "PATCH", `/v1/mcp/servers/${id}`, {
        name: "Edited MCP",
      });
      expect(renamed.json()).toMatchObject({ name: "Edited MCP", status: "error" });
      const moved = await call(t.app, jar, "PATCH", `/v1/mcp/servers/${id}`, {
        url: "http://127.0.0.1:10/mcp",
      });
      expect(moved.json()).toMatchObject({ status: "pending", lastError: null });

      await call(t.app, jar, "POST", "/v1/mcp/servers", {
        name: "Other MCP",
        transport: "streamable_http",
        url: "https://mcp.example.com/mcp",
        authKind: "none",
      });
      expect(
        (await call(t.app, jar, "PATCH", `/v1/mcp/servers/${id}`, { name: "Other MCP" }))
          .statusCode,
      ).toBe(409);
    });
  });

  describe("E-08: an OpenAPI toolset can be renamed and given another credential", () => {
    it("renames, refuses a taken name, and changes the credential", async () => {
      const { readFileSync } = await import("node:fs");
      const document = readFileSync(
        new URL("../../../packages/openapi-tools/fixtures/petstore-3.0.yaml", import.meta.url),
        "utf8",
      );
      const imported = async (name: string) => {
        const res = await call(t.app, jar, "POST", "/v1/tools/openapi/import", {
          name,
          document,
          serverUrl: "https://petstore.example.com/v1",
        });
        expect(res.statusCode, res.body).toBe(201);
        return res.json() as { id: string; definitions: { name: string }[] };
      };
      const shop = await imported("shop-a");
      await imported("shop-b");
      const key = (
        await call(t.app, jar, "POST", "/v1/credentials", {
          name: "Shop key (toolset)",
          type: "http.bearer",
          values: { token: "test-not-a-real-key" },
        })
      ).json() as { id: string };
      expect(
        (await call(t.app, jar, "PATCH", `/v1/tools/${shop.id}`, { name: "shop-b" })).statusCode,
      ).toBe(409);
      const renamed = await call(t.app, jar, "PATCH", `/v1/tools/${shop.id}`, {
        name: "shop-renamed",
        credentialId: key.id,
      });
      expect(renamed.statusCode).toBe(200);
      // operations keep the names they were imported with
      expect(renamed.json()).toMatchObject({
        name: "shop-renamed",
        credentialId: key.id,
        definitions: shop.definitions,
      });
    });
  });

  describe("E-09: a notification channel's delivery history", () => {
    it("lists what was sent to the channel, tests included, with each outcome", async () => {
      const channel = (
        await call(t.app, jar, "POST", "/v1/notifications", {
          kind: "webhook",
          name: "History hook",
          config: { url: "http://127.0.0.1:9/flowaid-test" },
          events: ["run.failed"],
        })
      ).json().channel as { id: string };
      const empty = await call(t.app, jar, "GET", `/v1/notifications/${channel.id}/deliveries`);
      expect(empty.json().items).toEqual([]);
      // nothing listens on port 9: the test fails and the history says why
      const sent = await call(t.app, jar, "POST", `/v1/notifications/${channel.id}/test`);
      expect(sent.json().ok).toBe(false);
      const history = (
        await call(t.app, jar, "GET", `/v1/notifications/${channel.id}/deliveries`)
      ).json() as { items: { event: string; status: string; error: string | null }[] };
      expect(history.items).toEqual([
        expect.objectContaining({ event: "test", status: "failed", error: sent.json().error }),
      ]);
      expect(
        (
          await call(
            t.app,
            jar,
            "GET",
            "/v1/notifications/00000000-0000-4000-8000-000000000000/deliveries",
          )
        ).statusCode,
      ).toBe(404);
    });
  });

  describe("E-06, E-07: private-address refusals say how to allow them", () => {
    let strict: TestApp;
    let strictJar: Jar;
    beforeAll(async () => {
      strict = await createTestApp({ allowPrivateNetwork: false });
      strictJar = await login(strict.app);
    });
    afterAll(async () => {
      await strict.close();
    });

    it("MCP discover and test, OpenAPI preview and a notification test name the setting", async () => {
      const server = await call(strict.app, strictJar, "POST", "/v1/mcp/servers", {
        name: "Local MCP",
        transport: "streamable_http",
        url: "http://127.0.0.1:9/mcp",
        authKind: "none",
      });
      const id = server.json().id as string;
      const discover = await call(strict.app, strictJar, "POST", `/v1/mcp/servers/${id}/discover`);
      // not 403 ("you have no access"): the address was refused
      expect(discover.statusCode).toBe(400);
      expect(discover.json().error.message).toContain("FLOWAID_ALLOW_PRIVATE_NETWORK=true");
      const row = (await call(strict.app, strictJar, "GET", `/v1/mcp/servers/${id}`)).json();
      expect(row.status).toBe("error");
      expect(row.lastError).toContain("FLOWAID_ALLOW_PRIVATE_NETWORK=true");
      const test = await call(strict.app, strictJar, "POST", `/v1/mcp/servers/${id}/test`);
      expect(test.json().ok).toBe(false);
      expect(test.json().message).toContain("FLOWAID_ALLOW_PRIVATE_NETWORK=true");

      const preview = await call(strict.app, strictJar, "POST", "/v1/tools/openapi/preview", {
        document: {
          openapi: "3.0.3",
          info: { title: "Local", version: "1" },
          servers: [{ url: "http://localhost:3101" }],
          paths: {},
        },
      });
      expect(preview.statusCode).toBe(400);
      expect(preview.json().error.message).toContain("FLOWAID_ALLOW_PRIVATE_NETWORK=true");
      expect(preview.json().error.message).not.toContain("E_TOOL_SERVER_PRIVATE:");

      const channel = await call(strict.app, strictJar, "POST", "/v1/notifications", {
        kind: "webhook",
        name: "Local hook",
        config: { url: "http://127.0.0.1:9/flowaid-test" },
        events: ["run.failed"],
      });
      const sent = await call(
        strict.app,
        strictJar,
        "POST",
        `/v1/notifications/${channel.json().channel.id as string}/test`,
      );
      expect(sent.json().ok).toBe(false);
      expect(sent.json().error).toContain("FLOWAID_ALLOW_PRIVATE_NETWORK=true");
    });
  });
});
