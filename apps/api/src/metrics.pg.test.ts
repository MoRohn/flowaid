import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { describeDb } from "@flowaid/database/testing";
import {
  alertDeliveries,
  humanTasks,
  nodeRuns,
  notifications,
  runEvents,
  runs,
} from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import { createAlertDispatcher } from "./services/alerts.js";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

const HOUR = 3_600_000;

describeDb("metrics and alerts (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  let workspaceId: string;
  let workflowId: string;
  let envs: Record<string, string>;
  const posted: { url: string; body: Record<string, unknown> }[] = [];
  let base: number;

  beforeAll(async () => {
    t = await createTestApp();
    t.ctx.alerts = createAlertDispatcher({
      db: t.ctx.db,
      credentials: t.ctx.credentials,
      fetch: (url, init) => {
        posted.push({ url, body: JSON.parse(init.body as string) as Record<string, unknown> });
        return Promise.resolve(new Response("ok"));
      },
    });
    jar = await login(t.app);
    workspaceId = (await call(t.app, jar, "GET", "/v1/me")).json().principal.workspaceId as string;
    envs = Object.fromEntries(
      (
        (await call(t.app, jar, "GET", "/v1/environments")).json() as { id: string; name: string }[]
      ).map((e) => [e.name, e.id]),
    );
    workflowId = (await call(t.app, jar, "POST", "/v1/workflows", { name: "Metrics" })).json()
      .id as string;
    const versionId = (
      await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/publish`, {})
    ).json().id as string;
    base = Math.floor(t.clock.now() / HOUR) * HOUR - 3 * HOUR;
    const at = (ms: number) => new Date(base + ms);
    const run = (
      i: number,
      status: string,
      durationMs: number | null,
      cost: number,
      input = 0,
      output = 0,
    ) => ({
      id: uuidv7(),
      workspaceId,
      workflowId,
      workflowVersionId: versionId,
      environmentId: envs.dev as string,
      status: status as never,
      origin: "api" as never,
      mode: "async" as never,
      input: {},
      costUsd: String(cost),
      usage: { inputTokens: input, outputTokens: output },
      createdAt: at(i * HOUR + 60_000),
      startedAt: at(i * HOUR + 60_000),
      endedAt: durationMs === null ? null : at(i * HOUR + 60_000 + durationMs),
    });
    const rows = [
      run(0, "completed", 1000, 0.01, 100, 20),
      run(1, "completed", 3000, 0.02, 50, 10),
      run(1, "failed", 2000, 0),
      run(2, "waiting_for_human", null, 0),
    ];
    const [r1, r2, r3, r4] = rows as [
      (typeof rows)[0],
      (typeof rows)[0],
      (typeof rows)[0],
      (typeof rows)[0],
    ];
    const node = (runId: string, nodeId: string, extra: Record<string, unknown>) => ({
      id: uuidv7(),
      runId,
      workspaceId,
      nodeId,
      kind: "task" as never,
      nodeName: nodeId,
      status: "completed" as never,
      scheduledSeq: 2,
      ...extra,
    });
    await t.db.app.system(async (tx) => {
      await tx.insert(runs).values(rows);
      await tx.insert(nodeRuns).values([
        node(r1.id, "decide", {
          nodeType: "flowaid.decision.boolean",
          decisionConfidence: "0.95",
        }),
        node(r2.id, "decide", {
          nodeType: "flowaid.decision.boolean",
          decisionConfidence: "0.45",
        }),
        node(r1.id, "call", { nodeType: "flowaid.tools.http", latencyMs: 100 }),
        node(r2.id, "call", { nodeType: "flowaid.tools.http", latencyMs: 300 }),
        node(r3.id, "call", { nodeType: "flowaid.tools.http", attempt: 2, status: "failed" }),
      ]);
      await tx.insert(humanTasks).values({
        id: uuidv7(),
        workspaceId,
        runId: r4.id,
        nodeRunId: uuidv7(),
        nodeId: "approve",
        workflowId,
        request: { title: "Approve", mode: { type: "approval" } } as never,
      });
      await tx.insert(runEvents).values({
        runId: r1.id,
        seq: 5,
        type: "PROVIDER_FAILOVER",
        payload: { from: "openai", to: "anthropic", error: { code: "RATE_LIMIT_ERROR" } },
        at: at(61_000),
      });
    });
  });
  afterAll(() => t.close());

  const range = () => ({
    from: new Date(base).toISOString(),
    to: new Date(base + 3 * HOUR).toISOString(),
  });

  it("aggregates runs, latency, cost, confidence, reviews, retries and provider failures", async () => {
    const { from, to } = range();
    const res = await call(t.app, jar, "GET", `/v1/metrics/overview?from=${from}&to=${to}`);
    expect(res.statusCode).toBe(200);
    const m = res.json();
    expect(m.runs).toEqual({
      total: 4,
      byStatus: { completed: 2, failed: 1, waiting_for_human: 1 },
    });
    expect(m.successRate).toBeCloseTo(2 / 3);
    expect(m.errorRate).toBeCloseTo(1 / 3);
    expect(m.latencyMs).toEqual({ p50: 2000, p95: 2900, p99: 2980 });
    expect(m.aiCostUsd).toBe(0.03);
    expect(m.tokens).toEqual({ input: 150, output: 30 });
    expect(m.toolLatencyMs).toEqual({ p50: 200, p95: 290 });
    expect(m.decisionConfidence.histogram[9].count).toBe(1);
    expect(m.decisionConfidence.histogram[4].count).toBe(1);
    expect(m.decisionConfidence.mean).toBeCloseTo(0.7);
    expect(m.humanReviewRate).toBe(0.25);
    expect(m.retryRate).toBeCloseTo(1 / 3);
    expect(m.providerFailures).toEqual([
      { provider: "openai", code: "RATE_LIMIT_ERROR", count: 1 },
    ]);
  });

  it("filters by workflow and environment, and pinned keys see only their workflows", async () => {
    const { from, to } = range();
    const other = await call(
      t.app,
      jar,
      "GET",
      `/v1/metrics/overview?from=${from}&to=${to}&environmentId=${envs.prod as string}`,
    );
    expect(other.json().runs.total).toBe(0);
    expect(other.json().successRate).toBeNull();
    const key = (
      await call(t.app, jar, "POST", "/v1/api-keys", {
        name: "pinned",
        scopes: ["runs:read"],
        environmentId: envs.dev,
        workflowIds: [uuidv7()],
      })
    ).json().key as string;
    const pinned = await t.app.inject({
      method: "GET",
      url: `/v1/metrics/overview?from=${from}&to=${to}`,
      headers: { authorization: `Bearer ${key}` },
    });
    expect(pinned.json().runs.total).toBe(0);
  });

  it("returns dense hourly series and refuses unbounded requests", async () => {
    const { from, to } = range();
    const res = await call(
      t.app,
      jar,
      "GET",
      `/v1/metrics/timeseries?from=${from}&to=${to}&bucket=1h`,
    );
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s.timestamps).toHaveLength(3);
    expect(s.series.runs).toEqual([1, 2, 1]);
    expect(s.series.failed).toEqual([0, 1, 0]);
    expect(s.series.humanReviews).toEqual([0, 0, 1]);
    expect(s.series.costUsd).toEqual([0.01, 0.02, 0]);
    expect(
      (await call(t.app, jar, "GET", `/v1/metrics/timeseries?from=${from}&to=${to}&bucket=1m`))
        .statusCode,
    ).toBe(200);
    const year = new Date(base - 200 * 24 * HOUR).toISOString();
    expect(
      (await call(t.app, jar, "GET", `/v1/metrics/timeseries?from=${year}&to=${to}&bucket=1m`))
        .statusCode,
    ).toBe(400);
    expect(
      (await call(t.app, jar, "GET", `/v1/metrics/overview?from=${to}&to=${from}`)).statusCode,
    ).toBe(400);
  });

  it("alerts a channel once per hour when a webhook is rejected, and lists the deliveries", async () => {
    await t.db.app.system((tx) =>
      tx.insert(notifications).values({
        id: uuidv7(),
        workspaceId,
        kind: "slack_webhook",
        name: "ops",
        config: { url: "https://hooks.slack.test/T/B/x" },
        events: ["webhook.rejected"],
      }),
    );
    const w = (await call(t.app, jar, "POST", "/v1/workflows", { name: "Hooked" })).json();
    await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id as string}/draft`,
      {
        definition: {
          ...w.draft,
          triggers: [{ type: "webhook", path: "orders", signature: "none" }],
        },
      },
      { "if-match": String(w.draftRevision) },
    );
    const v = (
      await call(t.app, jar, "POST", `/v1/workflows/${w.id as string}/publish`, {})
    ).json();
    await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id as string}/deployments/${envs.prod as string}`,
      {
        versionId: v.id,
      },
    );
    const hook = () =>
      t.app.inject({
        method: "POST",
        url: "/hooks/default/prod/orders",
        payload: "{}",
        headers: { "content-type": "application/json" },
      });
    expect((await hook()).statusCode).toBe(403);
    expect((await hook()).statusCode).toBe(403);
    for (let i = 0; i < 100 && posted.length === 0; i++)
      await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 100));
    expect(posted).toHaveLength(1);
    expect(posted[0]?.url).toBe("https://hooks.slack.test/T/B/x");
    expect(String(posted[0]?.body.text)).toContain("was rejected");

    const list = (await call(t.app, jar, "GET", "/v1/alerts/deliveries")).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ event: "webhook.rejected", status: "sent" });
    const rows = await t.db.app.system((tx) =>
      tx.select().from(alertDeliveries).where(eq(alertDeliveries.workspaceId, workspaceId)),
    );
    expect(rows).toHaveLength(1);
  });

  it("reports the dashboard feature", async () => {
    expect((await call(t.app, jar, "GET", "/v1/me")).json().features.dashboard).toBe(true);
  });
});
