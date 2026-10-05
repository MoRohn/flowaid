import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { FakeWorker, type Script } from "./test/fakeWorker.js";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

describeDb("runs, streams and human tasks (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  let worker: FakeWorker;
  let workflowId: string;
  let envs: Record<string, string>;
  beforeAll(async () => {
    t = await createTestApp();
    jar = await login(t.app);
    envs = Object.fromEntries(
      (
        (await call(t.app, jar, "GET", "/v1/environments")).json() as { id: string; name: string }[]
      ).map((e) => [e.name, e.id]),
    );
    workflowId = (await call(t.app, jar, "POST", "/v1/workflows", { name: "Echo" })).json()
      .id as string;
    const v = (await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/publish`, {})).json();
    await call(t.app, jar, "PUT", `/v1/workflows/${workflowId}/deployments/${envs.dev as string}`, {
      versionId: v.id,
    });
    worker = new FakeWorker(t.db.app, (input) => {
      const m = (input as { message?: string }).message ?? "";
      return (["fail", "human", "hang"].includes(m) ? m : "complete") as Script;
    });
    await worker.start();
  });
  afterAll(async () => {
    await worker.stop();
    await t.close();
  });
  const run = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    call(t.app, jar, "POST", `/v1/workflows/${workflowId}/run`, body, headers);

  it("async: 202 queued with links; the worker completes it", async () => {
    const res = await run({ input: { message: "hi" } });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({
      status: "queued",
      links: { stream: expect.stringMatching(/\/stream$/) },
    });
    const id = res.json().run_id as string;
    for (let i = 0; i < 100; i++) {
      const r = (await call(t.app, jar, "GET", `/v1/runs/${id}`)).json();
      if (r.status === "completed") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    // a signed-in person started it: the builder's "Run" is a ui run, not an api one
    expect((await call(t.app, jar, "GET", `/v1/runs/${id}`)).json()).toMatchObject({
      origin: "ui",
    });
    expect((await call(t.app, jar, "GET", `/v1/runs/${id}/output`)).json()).toEqual({
      output: { message: 'echo: {"message":"hi"}' },
      outcome: null,
    });
  });

  it("sync: 200 RunCompleted; failed runs return the run's error envelope", async () => {
    const ok = await run({ input: { message: "sync" }, mode: "sync", waitTimeoutMs: 20_000 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      status: "completed",
      output: { message: 'echo: {"message":"sync"}' },
      usage: { inputTokens: 3 },
      cost_usd: 0.001,
    });
    const failed = await run({ input: { message: "fail" }, mode: "sync", waitTimeoutMs: 20_000 });
    expect(failed.statusCode).toBe(500);
    expect(failed.json().error).toMatchObject({
      code: "NODE_EXECUTION_ERROR",
      message: "the model refused",
      run_id: expect.any(String),
      node_id: "draft",
    });
  });

  it("sync: a human wait answers 202 waiting_for_human; responding resumes the run", async () => {
    const res = await run({ input: { message: "human" }, mode: "sync", waitTimeoutMs: 20_000 });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({
      status: "waiting_for_human",
      human_task: { id: expect.any(String), url: expect.stringContaining("/inbox/") },
    });
    const taskId = res.json().human_task.id as string;
    const inbox = (await call(t.app, jar, "GET", "/v1/human-tasks?status=open")).json();
    expect(inbox.items.map((x: { id: string }) => x.id)).toContain(taskId);
    expect(
      (
        await call(t.app, jar, "POST", `/v1/human-tasks/${taskId}/respond`, {
          response: { action: "choose", option: "x" },
        })
      ).statusCode,
    ).toBe(400);
    const answered = await call(t.app, jar, "POST", `/v1/human-tasks/${taskId}/respond`, {
      response: { action: "approve", comment: "fine" },
    });
    expect(answered.statusCode).toBe(202);
    expect(
      (
        await call(t.app, jar, "POST", `/v1/human-tasks/${taskId}/respond`, {
          response: { action: "approve" },
        })
      ).statusCode,
    ).toBe(409);
    const runId = res.json().run_id as string;
    for (
      let i = 0;
      i < 100 && (await call(t.app, jar, "GET", `/v1/runs/${runId}`)).json().status !== "completed";
      i++
    )
      await new Promise((r) => setTimeout(r, 50));
    expect(worker.errors.map(String)).toEqual([]);
    expect((await call(t.app, jar, "GET", `/v1/runs/${runId}`)).json()).toMatchObject({
      status: "completed",
      outcome: "human_approved",
    });
    expect(worker.jobs.some((j) => j.type === "run.resume" && j.runId === runId)).toBe(true);
  });

  it("sync: still running at the timeout answers 202 running", async () => {
    const res = await run({ input: { message: "hang" }, mode: "sync", waitTimeoutMs: 1000 });
    expect(res.statusCode).toBe(202);
    expect(["queued", "running", "starting"]).toContain(res.json().status);
  });

  it("validates input (400, no run), needs a deployment or a draft, and runs drafts for sessions", async () => {
    const before = (await t.db.admin`select count(*)::int as n from runs`)[0]?.n as number;
    const bad = await run({ input: { nope: 1 } });
    expect(bad.statusCode).toBe(400);
    expect((await t.db.admin`select count(*)::int as n from runs`)[0]?.n).toBe(before);
    const other = (await call(t.app, jar, "POST", "/v1/workflows", { name: "Undeployed" })).json()
      .id as string;
    expect(
      (await call(t.app, jar, "POST", `/v1/workflows/${other}/run`, { input: { message: "x" } }))
        .statusCode,
    ).toBe(409);
    const draft = await call(t.app, jar, "POST", `/v1/workflows/${other}/run`, {
      input: { message: "x" },
      draft: true,
    });
    expect(draft.statusCode).toBe(202);
    const [row] = await t.db
      .admin`select v.kind from runs r join workflow_versions v on v.id = r.workflow_version_id where r.id = ${draft.json().run_id as string}`;
    expect(row?.kind).toBe("draft");
  });

  it("Idempotency-Key: same body → same run, different body → 409", async () => {
    const a = await run({ input: { message: "idem" } }, { "idempotency-key": "k-1" });
    const b = await run({ input: { message: "idem" } }, { "idempotency-key": "k-1" });
    expect(b.json().run_id).toBe(a.json().run_id);
    const c = await run({ input: { message: "other" } }, { "idempotency-key": "k-1" });
    expect(c.statusCode).toBe(409);
  });

  it("streams SSE: replay, Last-Event-ID resume and END", async () => {
    const id = (
      await run({ input: { message: "stream" }, mode: "sync", waitTimeoutMs: 20_000 })
    ).json().run_id as string;
    const full = await call(t.app, jar, "GET", `/v1/runs/${id}/stream`);
    expect(full.headers["content-type"]).toContain("text/event-stream");
    expect(full.body).toContain("retry: 2000");
    expect(full.body).toMatch(/id: 1\nevent: RUN_CREATED/);
    expect(full.body).toContain("event: RUN_COMPLETED");
    expect(full.body).toContain(`event: END\ndata: {"run_id":"${id}","final_status":"completed"}`);
    const resumed = await call(t.app, jar, "GET", `/v1/runs/${id}/stream`, undefined, {
      "last-event-id": "2",
    });
    expect(resumed.body).not.toContain("event: RUN_CREATED");
    expect(resumed.body).not.toContain("event: RUN_STARTED");
    expect(resumed.body).toContain("event: RUN_COMPLETED");
    const polled = (await call(t.app, jar, "GET", `/v1/runs/${id}/events?after=0&limit=2`)).json();
    expect(polled.items.map((e: { type: string }) => e.type)).toEqual([
      "RUN_CREATED",
      "RUN_STARTED",
    ]);
  });

  it("streams live events as the worker appends them", async () => {
    const started = await run({ input: { message: "live" } });
    const id = started.json().run_id as string;
    const res = await call(t.app, jar, "GET", `/v1/runs/${id}/stream?until=terminal`);
    expect(res.body).toContain("event: RUN_COMPLETED");
  });

  it("cancels (202 + control job), refuses terminal cancels, replays, lists and purges", async () => {
    const hang = (await run({ input: { message: "hang" } })).json().run_id as string;
    const cancel = await call(t.app, jar, "POST", `/v1/runs/${hang}/cancel`, { reason: "test" });
    expect(cancel.statusCode).toBe(202);
    const [row] = await t.db.admin`select cancel_reason from runs where id = ${hang}`;
    expect(row?.cancel_reason).toBe("test");
    const done = (
      await run({ input: { message: "x" }, mode: "sync", waitTimeoutMs: 20_000 })
    ).json().run_id as string;
    expect((await call(t.app, jar, "POST", `/v1/runs/${done}/cancel`, {})).statusCode).toBe(409);
    const replay = await call(t.app, jar, "POST", `/v1/runs/${done}/replay`, {});
    expect(replay.statusCode).toBe(202);
    expect(
      (await call(t.app, jar, "GET", `/v1/runs/${replay.json().run_id as string}`)).json(),
    ).toMatchObject({ origin: "replay", sourceRunId: done });
    const list = (
      await call(t.app, jar, "GET", `/v1/runs?workflowId=${workflowId}&limit=3`)
    ).json();
    expect(list.items).toHaveLength(3);
    expect(list.next_cursor).not.toBeNull();
    expect(list.items[0]).not.toHaveProperty("decisions");
    const withDecisions = (
      await call(t.app, jar, "GET", `/v1/runs?workflowId=${workflowId}&limit=3&include=decisions`)
    ).json();
    // the fake worker's runs decide nothing: the summaries are there, and empty
    expect(withDecisions.items.map((r: { decisions: unknown[] }) => r.decisions)).toEqual([
      [],
      [],
      [],
    ]);
    expect((await call(t.app, jar, "DELETE", `/v1/runs/${done}`)).statusCode).toBe(204);
    expect((await call(t.app, jar, "GET", `/v1/runs/${done}`)).statusCode).toBe(404);
  });

  it("searches every run, not one page: id start, workflow name, error text and created time", async () => {
    const all = (await call(t.app, jar, "GET", `/v1/runs?limit=200`)).json().items as {
      id: string;
      createdAt: string;
      workflowId: string;
      error: { message: string } | null;
    }[];
    expect(all.length).toBeGreaterThan(3);
    const oldest = all.at(-1) as (typeof all)[number];
    const ids = (q: string, limit = 2) =>
      call(t.app, jar, "GET", `/v1/runs?q=${encodeURIComponent(q)}&limit=${limit}`).then((r) =>
        (r.json().items as { id: string }[]).map((x) => x.id),
      );
    // the oldest run is far past the first page of 2, and still found by the start of its id
    expect(await ids(oldest.id.slice(0, 13).toUpperCase())).toEqual([oldest.id]);
    expect((await ids("ECHO", 200)).sort()).toEqual(
      all
        .filter((r) => r.workflowId === workflowId)
        .map((r) => r.id)
        .sort(),
    );
    const failed = all.filter((r) => r.error?.message.includes("refused")).map((r) => r.id);
    expect(failed.length).toBeGreaterThan(0);
    expect(await ids("model REFUSED", 200)).toEqual(failed);
    // LIKE wildcards are plain characters
    expect(await ids("%")).toEqual([]);
    expect(await ids("_")).toEqual([]);
    const range = (from: string, to: string) =>
      call(
        t.app,
        jar,
        "GET",
        `/v1/runs?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=200`,
      ).then((r) => (r.json().items as { id: string }[]).map((x) => x.id));
    // (the test database's clock stands still: every run here has the same creation time)
    const at = Date.parse(oldest.createdAt);
    const iso = (ms: number) => new Date(ms).toISOString();
    expect(await range(iso(at - 1000), iso(at + 1000))).toHaveLength(all.length);
    expect(await range(iso(at - 60_000), iso(at - 1000))).toEqual([]);
    expect(await range(iso(at + 1000), "2100-01-01T00:00:00Z")).toEqual([]);
    expect((await call(t.app, jar, "GET", `/v1/runs?from=yesterday`)).statusCode).toBe(400);
  });

  it("returns each run's version number with include=version (null for a draft)", async () => {
    const draft = (await run({ input: { message: "x" }, draft: true })).json().run_id as string;
    const list = (
      await call(t.app, jar, "GET", `/v1/runs?workflowId=${workflowId}&limit=200&include=version`)
    ).json().items as { id: string; version: number | null; decisions?: unknown }[];
    expect(list.find((r) => r.id === draft)?.version).toBeNull();
    expect(list.filter((r) => r.id !== draft).every((r) => r.version === 1)).toBe(true);
    expect(list[0]).not.toHaveProperty("decisions");
    const both = (
      await call(t.app, jar, "GET", `/v1/runs?limit=1&include=decisions,version`)
    ).json().items[0] as { version: unknown; decisions: unknown };
    expect(both.decisions).toEqual([]);
    expect(both).toHaveProperty("version");
    expect((await call(t.app, jar, "GET", `/v1/runs?include=nodes`)).statusCode).toBe(400);
  });

  it("applies backpressure when the workspace has too many runs in flight", async () => {
    const ws = (await call(t.app, jar, "GET", "/v1/me")).json().principal.workspaceId as string;
    await call(t.app, jar, "PATCH", `/v1/workspaces/${ws}`, { settings: { maxQueuedRuns: 1 } });
    await run({ input: { message: "hang" } });
    const res = await run({ input: { message: "hang" } });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("RATE_LIMIT_ERROR");
    await call(t.app, jar, "PATCH", `/v1/workspaces/${ws}`, { settings: { maxQueuedRuns: 1000 } });
  });

  it("API keys need an environment unless pinned; pinned keys cannot pick another", async () => {
    const key = (
      await call(t.app, jar, "POST", "/v1/api-keys", {
        name: "runner",
        scopes: ["runs:create", "runs:read"],
      })
    ).json().key as string;
    const h = { authorization: `Bearer ${key}` };
    const noEnv = await t.app.inject({
      method: "POST",
      url: `/v1/workflows/${workflowId}/run`,
      payload: { input: { message: "k" } },
      headers: h,
    });
    expect(noEnv.statusCode).toBe(400);
    const withEnv = await t.app.inject({
      method: "POST",
      url: `/v1/workflows/${workflowId}/run`,
      payload: { input: { message: "k" }, environmentId: envs.dev },
      headers: h,
    });
    expect(withEnv.statusCode).toBe(202);
    const pinned = (
      await call(t.app, jar, "POST", "/v1/api-keys", {
        name: "pinned",
        scopes: ["runs:create"],
        environmentId: envs.staging,
      })
    ).json().key as string;
    const wrong = await t.app.inject({
      method: "POST",
      url: `/v1/workflows/${workflowId}/run`,
      payload: { input: { message: "k" }, environmentId: envs.dev },
      headers: { authorization: `Bearer ${pinned}` },
    });
    expect(wrong.statusCode).toBe(403);
  });

  it("lists workflows with deployments, 24 h run activity and the last run", async () => {
    await run({ input: { message: "activity" }, mode: "sync", waitTimeoutMs: 20_000 });
    const list = (await call(t.app, jar, "GET", "/v1/workflows?include=activity")).json() as {
      items: {
        id: string;
        deployments: { environmentId: string; version: number }[];
        runs24h: number[];
        lastRun: { status: string } | null;
      }[];
    };
    const echo = list.items.find((w) => w.id === workflowId);
    expect(echo?.deployments).toEqual([{ environmentId: envs.dev, version: 1 }]);
    expect(echo?.runs24h).toHaveLength(24);
    expect(echo?.runs24h.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(echo?.lastRun).not.toBeNull();
    const plain = (await call(t.app, jar, "GET", "/v1/workflows")).json();
    expect(plain.items[0]).not.toHaveProperty("runs24h");
  });
});
