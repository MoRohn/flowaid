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
});
