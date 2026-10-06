import { afterAll, beforeAll, expect, it } from "vitest";
import { PgRunStore } from "@flowaid/database";
import { describeDb, fixture } from "@flowaid/database/testing";
import { booleanDecision, choiceDecision, scoreDecision } from "@flowaid/providers";
import { uuidv7 } from "@flowaid/shared";
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
    // a run whose input says `hang` is left to the test to record
    worker = new FakeWorker(t.db.app, (input) =>
      (input as { hang?: unknown } | null)?.hang ? "hang" : "complete",
    );
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

  it("names the workflows a set gates, and unlinks them when it is deleted", async () => {
    const setId = (
      await call(t.app, jar, "POST", "/v1/evaluations/sets", { name: "Gate link", workflowId })
    ).json().id as string;
    expect(
      (await call(t.app, jar, "PATCH", `/v1/workflows/${workflowId}`, { evaluationSetId: setId }))
        .statusCode,
    ).toBe(200);
    expect((await call(t.app, jar, "GET", `/v1/evaluations/sets/${setId}`)).json().gateOf).toEqual([
      { id: workflowId, name: "Evaluated" },
    ]);
    expect((await call(t.app, jar, "DELETE", `/v1/evaluations/sets/${setId}`)).statusCode).toBe(
      204,
    );
    // before, the workflow kept the id of a set that no longer existed
    expect(
      (await call(t.app, jar, "GET", `/v1/workflows/${workflowId}`)).json().evaluationSetId,
    ).toBeNull();
    const [audit] = await t.db
      .admin`select details from audit_events where action = 'evaluation_set.delete' and resource_id = ${setId}`;
    expect(audit?.details).toMatchObject({ unlinkedWorkflowIds: [workflowId] });
  });

  it("pages the sets by name with a cursor", async () => {
    for (const name of ["Pager C", "Pager A", "Pager B"])
      await call(t.app, jar, "POST", "/v1/evaluations/sets", { name });
    const names: string[] = [];
    let cursor: string | null = null;
    do {
      const pg = (
        await call(t.app, jar, "GET", `/v1/evaluations/sets?limit=2&cursor=${cursor ?? ""}`)
      ).json() as { items: { name: string }[]; next_cursor: string | null };
      expect(pg.items.length).toBeLessThanOrEqual(2);
      names.push(...pg.items.map((x) => x.name));
      cursor = pg.next_cursor;
    } while (cursor);
    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((n) => n.startsWith("Pager"))).toEqual(["Pager A", "Pager B", "Pager C"]);
    expect((await call(t.app, jar, "GET", "/v1/evaluations/sets?limit=500")).statusCode).toBe(400);
  });

  it("turns a run into a case with decisions and outcome prefilled", async () => {
    const v = (await call(t.app, jar, "GET", `/v1/workflows/${workflowId}/versions`)).json()
      .items[0];
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

  it("captures every answer of a batch decision step, one per question", async () => {
    const v = (await call(t.app, jar, "GET", `/v1/workflows/${workflowId}/versions`)).json()
      .items[0];
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
    // the fake worker leaves this run to the test, which records a batch step's three answers
    const runId = (
      await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/run`, {
        input: { message: "Love the new dashboard", hang: true },
      })
    ).json().run_id as string;
    const m = { provider: "typesafe", model: "jev", latencyMs: 5, costUsd: 0.0001 };
    const answers = {
      topic: choiceDecision({ billing: 0.1, feedback: 0.9 }, m),
      urgency: scoreDecision([0.8, 0.2], ["low", "high"], m),
      needs_person: booleanDecision(0.1, m),
    };
    const nodeRunId = uuidv7();
    const at = { nodeRunId, nodeId: "triage", scope: "", attempt: 1 };
    await appendAs(t.db.app, runId, [
      {
        ...fixture("RUN_STARTED"),
        workerId: "test",
        leaseUntil: new Date(Date.now() + 30_000).toISOString(),
        deadlineAt: new Date(Date.now() + 600_000).toISOString(),
      },
      { ...fixture("NODE_SCHEDULED"), ...at, kind: "task", nodeType: "flowaid.decision.batch" },
      { ...fixture("NODE_STARTED"), ...at },
      ...Object.entries(answers).map(([question, decision]) => ({
        ...fixture("DECISION_COMPLETED"),
        ...at,
        batchId: `${nodeRunId}:batch`,
        question,
        decision,
      })),
      {
        ...fixture("NODE_COMPLETED"),
        ...at,
        output: { answers },
        firedPorts: ["done"],
      },
      { ...fixture("RUN_COMPLETED"), output: { ok: true }, outcome: null, durationMs: 5 },
    ] as never);
    const setId = (
      await call(t.app, jar, "POST", "/v1/evaluations/sets", { name: "Batch answers", workflowId })
    ).json().id as string;
    const created = await call(t.app, jar, "POST", `/v1/runs/${runId}/add-to-evaluation`, {
      setId,
    });
    expect(created.statusCode).toBe(201);
    // before, only `triage: { value: false }` (the last answer) was captured
    expect(created.json().expected.decisions).toEqual({
      "triage.topic": { value: "feedback" },
      "triage.urgency": { value: answers.urgency.value },
      "triage.needs_person": { value: false },
    });
  });
});

/** Appends events to a run as its worker would (lease, fenced append, release). */
async function appendAs(db: TestApp["db"]["app"], runId: string, events: never[]): Promise<void> {
  const store = new PgRunStore(db);
  await store.acquireLease(runId, "test", 30_000);
  const run = await store.getRun(runId);
  if (!run) throw new Error(`no run ${runId}`);
  await store.appendEvents(runId, events, { leaseOwner: "test", expectedSeq: run.lastSeq });
  await store.releaseLease(runId, "test");
}
