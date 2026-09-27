import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { describeDb } from "@flowaid/database/testing";
import { FakeWorker, type Script } from "./test/fakeWorker.js";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

describeDb("external review links and the MCP server endpoint (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  let worker: FakeWorker;
  let workflowId: string;
  let dev: string;
  beforeAll(async () => {
    t = await createTestApp();
    jar = await login(t.app);
    dev = (
      (await call(t.app, jar, "GET", "/v1/environments")).json() as { id: string; name: string }[]
    ).find((e) => e.name === "dev")?.id as string;
    workflowId = (await call(t.app, jar, "POST", "/v1/workflows", { name: "Echo" })).json()
      .id as string;
    const v = (await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/publish`, {})).json();
    await call(t.app, jar, "PUT", `/v1/workflows/${workflowId}/deployments/${dev}`, {
      versionId: v.id,
    });
    worker = new FakeWorker(t.db.app, (input) => {
      const m = (input as { message?: string }).message ?? "";
      return (m === "human" ? "human" : "complete") as Script;
    });
    await worker.start();
  });
  afterAll(async () => {
    await worker.stop();
    await t.close();
  });

  async function openTask(): Promise<string> {
    await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/run`, {
      input: { message: "human" },
      mode: "sync",
      waitTimeoutMs: 20_000,
    });
    const inbox = (await call(t.app, jar, "GET", "/v1/human-tasks?status=open")).json() as {
      items: { id: string }[];
    };
    return inbox.items[0]?.id as string;
  }
  const review = (method: "GET" | "POST", url: string, token: string, payload?: unknown) =>
    t.app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
      ...(payload !== undefined ? { payload: payload as never } : {}),
    });

  it("mints single-use, revocable review links that answer the task without a session", async () => {
    const taskId = await openTask();
    const denied = await call(t.app, jar, "POST", `/v1/human-tasks/${taskId}/review-link`, {});
    expect(denied.statusCode).toBe(403);
    await t.db.app.system((tx) =>
      tx.execute(
        sql`update human_tasks set request = jsonb_set(request, '{externalReview}', 'true') where id = ${taskId}`,
      ),
    );
    const link = await call(t.app, jar, "POST", `/v1/human-tasks/${taskId}/review-link`, {});
    expect(link.statusCode).toBe(201);
    const token = /#t=(.+)$/.exec(link.json().url as string)?.[1] as string;
    expect(token).toMatch(/^[\w-]{40,}$/);

    expect((await t.app.inject({ method: "GET", url: `/v1/review?t=${token}` })).statusCode).toBe(
      400,
    );
    expect((await review("GET", "/v1/review", "nope")).statusCode).toBe(404);
    const view = await review("GET", "/v1/review", token);
    expect(view.statusCode).toBe(200);
    expect(view.headers["cache-control"]).toBe("no-store");
    expect(view.headers["referrer-policy"]).toBe("no-referrer");
    expect(view.json()).toMatchObject({ title: "Approve the reply", workflowName: "Echo" });
    expect(view.json()).not.toHaveProperty("assignees");

    // A second link, revoked, stops working.
    const other = (
      await call(t.app, jar, "POST", `/v1/human-tasks/${taskId}/review-link`, {})
    ).json();
    const otherToken = /#t=(.+)$/.exec(other.url as string)?.[1] as string;
    expect(
      (
        await call(
          t.app,
          jar,
          "DELETE",
          `/v1/human-tasks/${taskId}/review-link/${other.id as string}`,
        )
      ).statusCode,
    ).toBe(204);
    expect((await review("GET", "/v1/review", otherToken)).statusCode).toBe(404);

    const answered = await review("POST", "/v1/review/respond", token, {
      response: { action: "approve" },
    });
    expect(answered.statusCode).toBe(202);
    expect(
      (await review("POST", "/v1/review/respond", token, { response: { action: "approve" } }))
        .statusCode,
    ).toBe(404);
    const task = (await call(t.app, jar, "GET", `/v1/human-tasks/${taskId}`)).json();
    expect(task.task).toMatchObject({
      status: "responded",
      respondedBy: expect.stringMatching(/^review_token:/),
    });
    const audit = (await call(t.app, jar, "GET", "/v1/audit?action=human_task.respond")).json() as {
      items: { actorType: string }[];
    };
    expect(audit.items.some((a) => a.actorType === "review_token")).toBe(true);
  });

  it("serves exposed workflows as MCP tools over stateless Streamable HTTP", async () => {
    const key = (
      await call(t.app, jar, "POST", "/v1/mcp/tokens", {
        name: "agent",
        workflowIds: [workflowId],
        environmentId: dev,
      })
    ).json().key as string;
    await call(t.app, jar, "POST", "/v1/mcp/exposures", {
      workflowId,
      environmentId: dev,
      toolName: "echo",
      description: "Echoes the message",
    });
    let n = 0;
    const rpc = async (method: string, params: unknown = {}, auth = key, slug = "default") => {
      const res = await t.app.inject({
        method: "POST",
        url: `/mcp/${slug}`,
        headers: {
          authorization: `Bearer ${auth}`,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        payload: { jsonrpc: "2.0", id: ++n, method, params },
      });
      return res;
    };
    const userKey = (
      await call(t.app, jar, "POST", "/v1/api-keys", { name: "plain", scopes: ["runs:read"] })
    ).json().key as string;
    expect((await rpc("tools/list", {}, userKey)).statusCode).toBe(401);
    expect((await rpc("tools/list", {}, key, "other")).statusCode).toBe(404);

    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.statusCode).toBe(200);
    expect(init.json().result.serverInfo.name).toBe("flowaid-default");

    const tools = (await rpc("tools/list")).json().result.tools as { name: string }[];
    expect(tools.map((x) => x.name)).toEqual(["echo"]);

    const result = (await rpc("tools/call", { name: "echo", arguments: { message: "hi" } })).json()
      .result;
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result)).toContain("echo:");

    const unknown = (await rpc("tools/call", { name: "nope", arguments: {} })).json().result;
    expect(unknown.isError).toBe(true);

    const resources = (await rpc("resources/list")).json().result.resources as { uri: string }[];
    expect(resources[0]?.uri).toBe(`flowaid://workflows/${workflowId}/schema`);
    const read = (await rpc("resources/read", { uri: resources[0]?.uri })).json().result;
    expect(JSON.parse(read.contents[0].text as string)).toHaveProperty("inputs");
  });
});
