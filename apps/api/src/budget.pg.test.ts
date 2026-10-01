import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { notifications } from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import { createAlertDispatcher } from "./services/alerts.js";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

// late on the last day of a month (UTC), so the boundary is one short step away
const MARCH_END = Date.parse("2030-03-31T23:59:00Z");

describeDb("the monthly budget refuses new runs and alerts once a month (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  let ws: string;
  let workflowId: string;
  const delivered: { event: string; title: string }[] = [];
  beforeAll(async () => {
    t = await createTestApp();
    t.clock.t = MARCH_END;
    jar = await login(t.app);
    ws = (await call(t.app, jar, "GET", "/v1/me")).json().principal.workspaceId as string;
    const envs = Object.fromEntries(
      (
        (await call(t.app, jar, "GET", "/v1/environments")).json() as { id: string; name: string }[]
      ).map((e) => [e.name, e.id]),
    );
    workflowId = (await call(t.app, jar, "POST", "/v1/workflows", { name: "Spender" })).json()
      .id as string;
    const v = (await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/publish`, {})).json();
    await call(t.app, jar, "PUT", `/v1/workflows/${workflowId}/deployments/${envs.dev}`, {
      versionId: v.id,
    });
    t.ctx.alerts = createAlertDispatcher({
      db: t.db.app,
      credentials: t.ctx.credentials,
      fetch: (_url, init) => {
        const body = JSON.parse(init.body as string) as { event: string; title: string };
        delivered.push({ event: body.event, title: body.title });
        return Promise.resolve(new Response("", { status: 204 }));
      },
    });
    await t.db.app.system((tx) =>
      tx.insert(notifications).values({
        id: uuidv7(),
        workspaceId: ws,
        kind: "webhook",
        name: "finance",
        config: { url: "https://hooks.example.com/finance" },
        events: ["budget.warning", "budget.exceeded"],
      }),
    );
  });
  afterAll(() => t.close());

  const run = (body: Record<string, unknown> = {}) =>
    call(t.app, jar, "POST", `/v1/workflows/${workflowId}/run`, {
      input: { message: "hi" },
      ...body,
    });
  /** a run (started through the API) made to look like it cost `usd`, created at `at` */
  const spent = async (usd: number, at: string) => {
    const id = (await run()).json().run_id as string;
    await t.db
      .admin`update runs set cost_usd = ${usd}, created_at = ${at}::timestamptz where id = ${id}`;
    return id;
  };
  const settle = () => new Promise((r) => setTimeout(r, 300));
  const budget = async () => (await call(t.app, jar, "GET", `/v1/workspaces/${ws}/budget`)).json();

  it("reports the month's spend; without a budget nothing is refused", async () => {
    await spent(5, "2030-02-27T12:00:00Z"); // last month: not counted
    await spent(0.5, "2030-03-10T12:00:00Z");
    expect(await budget()).toEqual({
      month: "2030-03",
      spentUsd: 0.5,
      monthlyCostUsd: null,
      reached: false,
    });
    expect((await run()).statusCode).toBe(202);
  });

  it("warns once at 80 %, refuses at 100 % with one exceeded alert, and runs again next month", async () => {
    const patched = await call(t.app, jar, "PATCH", `/v1/workspaces/${ws}`, {
      settings: { budgets: { monthlyCostUsd: 1 } },
    });
    expect(patched.statusCode).toBe(200);
    const big = await spent(0.35, "2030-03-11T12:00:00Z"); // 0.85 of 1.00
    expect((await run()).statusCode).toBe(202);
    expect((await run()).statusCode).toBe(202);
    await settle();
    expect(delivered.map((d) => d.event)).toEqual(["budget.warning"]);
    expect(delivered[0]?.title).toBe("85% of the monthly budget spent (2030-03)");

    await t.db.admin`update runs set cost_usd = 0.5 where id = ${big}`; // 1.00 of 1.00
    const refused = await run();
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({
      code: "CONFLICT",
      details: { reason: "budget_exceeded", month: "2030-03", spentUsd: 1, monthlyCostUsd: 1 },
    });
    expect(refused.json().error.message).toMatch(/monthly budget of \$1\.00 is used up/);
    // every origin the API starts goes through the same check: a draft run is refused too
    expect((await run({ draft: true })).statusCode).toBe(409);
    expect((await budget()).reached).toBe(true);
    await settle();
    expect(delivered.map((d) => d.event)).toEqual(["budget.warning", "budget.exceeded"]);

    // a new month (UTC) starts from zero; the alerts may go out again then
    t.clock.t = MARCH_END + 90_000;
    expect(await budget()).toMatchObject({ month: "2030-04", spentUsd: 0, reached: false });
    expect((await run()).statusCode).toBe(202);

    // a higher budget lets runs start again within the month
    t.clock.t = MARCH_END;
    await call(t.app, jar, "PATCH", `/v1/workspaces/${ws}`, {
      settings: { budgets: { monthlyCostUsd: 10 } },
    });
    expect((await run()).statusCode).toBe(202);
    await settle();
    expect(delivered).toHaveLength(2);
  });
});
