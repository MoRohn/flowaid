import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { FakeWorker } from "./test/fakeWorker.js";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

describeDb("evaluations (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  let worker: FakeWorker;
  let workflowId: string;
  beforeAll(async () => {
    t = await createTestApp();
    jar = await login(t.app);
    worker = new FakeWorker(t.db.app, () => "complete");
    await worker.start();
    const w = (await call(t.app, jar, "POST", "/v1/workflows", { name: "Evaluated" })).json();
    workflowId = w.id as string;
  });
  afterAll(async () => {
    await worker.stop();
    await t.close();
  });

  const completeEvaluation = async (evaluationRunId: string, passRate: number) => {
    await t.db
      .admin`update evaluation_runs set status = 'completed', summary = ${t.db.admin.json({ cases: 2, passed: Math.round(passRate * 2), passRate })}, ended_at = now() where id = ${evaluationRunId}`;
  };

  it("manages sets and cases (bulk add, keyset pages, validated expectations)", async () => {
    const set = await call(t.app, jar, "POST", "/v1/evaluations/sets", {
      name: "Smoke",
      workflowId,
    });
    expect(set.statusCode).toBe(201);
    const setId = set.json().id as string;
    expect(
      (await call(t.app, jar, "POST", "/v1/evaluations/sets", { name: "Smoke" })).statusCode,
    ).toBe(409);
    const added = await call(t.app, jar, "POST", `/v1/evaluations/sets/${setId}/cases`, [
      {
        input: { message: "a" },
        expected: { output: [{ path: "/message", matcher: { type: "contains", value: "a" } }] },
      },
      { input: { message: "b" } },
      { input: { message: "c" }, tags: ["edge"] },
    ]);
    expect(added.statusCode).toBe(201);
    expect(added.json().map((c: { ordinal: number }) => c.ordinal)).toEqual([0, 1, 2]);
    const bad = await call(t.app, jar, "POST", `/v1/evaluations/sets/${setId}/cases`, {
      input: {},
      expected: { output: [{ path: "nope", matcher: { type: "equals" } }] },
    });
    expect(bad.statusCode).toBe(400);
    const page = (
      await call(t.app, jar, "GET", `/v1/evaluations/sets/${setId}/cases?limit=2`)
    ).json();
    expect(page.items).toHaveLength(2);
    const next = (
      await call(
        t.app,
        jar,
        "GET",
        `/v1/evaluations/sets/${setId}/cases?limit=2&cursor=${page.next_cursor as string}`,
      )
    ).json();
    expect(next.items.map((c: { ordinal: number }) => c.ordinal)).toEqual([2]);
    const patched = await call(
      t.app,
      jar,
      "PATCH",
      `/v1/evaluations/cases/${next.items[0].id as string}`,
      { tags: ["edge", "slow"] },
    );
    expect(patched.json().tags).toEqual(["edge", "slow"]);
  });

  it("starts evaluations of the draft (queued for the worker) and compares runs", async () => {
    const setId = (
      await call(t.app, jar, "POST", "/v1/evaluations/sets", { name: "Compare", workflowId })
    ).json().id as string;
    await call(t.app, jar, "POST", `/v1/evaluations/sets/${setId}/cases`, [
      { input: { message: "x" } },
    ]);
    const started = await call(t.app, jar, "POST", "/v1/evaluations/runs", {
      setId,
      draft: true,
      gate: { minPassRate: 0.5 },
    });
    expect(started.statusCode).toBe(202);
    const runId = started.json().id as string;
    const [job] = await t.db
      .admin`select payload from queue_jobs where queue = 'evaluation' and id = ${`evaluation.run:${runId}`}`;
    expect(job?.payload).toEqual({ type: "evaluation.run", evaluationRunId: runId });
    const [version] = await t.db
      .admin`select v.kind from evaluation_runs e join workflow_versions v on v.id = e.workflow_version_id where e.id = ${runId}`;
    expect(version?.kind).toBe("draft");
    const other = (
      await call(t.app, jar, "POST", "/v1/evaluations/runs", { setId, draft: true })
    ).json().id as string;
    const [c] = await t.db.admin`select id from evaluation_cases where set_id = ${setId}`;
    const metrics = {
      latencyMs: 10,
      costUsd: 0.001,
      tokens: 5,
      branches: {},
      decisions: {},
      humanRequested: false,
      toolCalls: { total: 0, ok: 0 },
      schemaErrors: 0,
    };
    await t.db
      .admin`insert into evaluation_results (evaluation_run_id, case_id, passed, checks, metrics, failures) values (${runId}, ${c?.id as string}, false, '{"items":[]}', ${t.db.admin.json(metrics)}, '["status"]')`;
    await t.db
      .admin`insert into evaluation_results (evaluation_run_id, case_id, passed, checks, metrics, failures) values (${other}, ${c?.id as string}, true, '{"items":[]}', ${t.db.admin.json(metrics)}, '[]')`;
    const report = (
      await call(t.app, jar, "GET", `/v1/evaluations/runs/${runId}/compare/${other}`)
    ).json();
    expect(report).toMatchObject({
      verdict: "fail",
      flips: [{ field: "passed", before: true, after: false }],
    });
    const md = await call(
      t.app,
      jar,
      "GET",
      `/v1/evaluations/runs/${runId}/compare/${other}?format=markdown`,
    );
    expect(md.body).toContain("## Evaluation: FAIL");
    expect(
      (await call(t.app, jar, "POST", `/v1/evaluations/runs/${other}/cancel`)).statusCode,
    ).toBe(202);
    expect(
      (await call(t.app, jar, "POST", `/v1/evaluations/runs/${other}/cancel`)).statusCode,
    ).toBe(409);
  });

  it("gates publishing on an evaluation of the exact draft", async () => {
    const setId = (
      await call(t.app, jar, "POST", "/v1/evaluations/sets", { name: "Gate", workflowId })
    ).json().id as string;
    const gate = { requireEvaluation: { setId, minPassRate: 0.8 } };
    const none = await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/publish`, gate);
    expect(none.statusCode).toBe(422);
    expect(JSON.stringify(none.json())).toContain("run it first");
    const low = (
      await call(t.app, jar, "POST", "/v1/evaluations/runs", { setId, draft: true })
    ).json().id as string;
    await completeEvaluation(low, 0.5);
    const failed = await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/publish`, gate);
    expect(failed.statusCode).toBe(422);
    expect(failed.json().error.details).toMatchObject({
      evaluationRunId: low,
      gate: { minPassRate: 0.8 },
    });
    const good = (
      await call(t.app, jar, "POST", "/v1/evaluations/runs", { setId, draft: true })
    ).json().id as string;
    await completeEvaluation(good, 1);
    expect(
      (await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/publish`, gate)).statusCode,
    ).toBe(201);
  });

  it("turns a run into a case with decisions and outcome prefilled", async () => {
    const v = (await call(t.app, jar, "GET", `/v1/workflows/${workflowId}/versions`)).json()[0];
    const envs = (await call(t.app, jar, "GET", "/v1/environments")).json() as {
      id: string;
      name: string;
    }[];
    await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${workflowId}/deployments/${envs.find((e) => e.name === "dev")?.id as string}`,
      { versionId: v.id },
    );
    const runId = (
      await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/run`, {
        input: { message: "keep me" },
        mode: "sync",
        waitTimeoutMs: 20_000,
      })
    ).json().run_id as string;
    const setId = (
      await call(t.app, jar, "POST", "/v1/evaluations/sets", { name: "From runs", workflowId })
    ).json().id as string;
    const created = await call(t.app, jar, "POST", `/v1/runs/${runId}/add-to-evaluation`, {
      setId,
      expected: { maxLatencyMs: 5000 },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      input: { message: "keep me" },
      sourceRunId: runId,
      expected: { maxLatencyMs: 5000 },
    });
  });
});
