/**
 * The SDK against the real API: a listening server over Postgres, an API key, the fake worker.
 * Covers the run loop end to end through `@flowaid/workflow-sdk` — async and sync starts, the
 * SSE transport, waiting, human tasks, typed calls and the error envelope.
 */
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { RunEvent } from "@flowaid/workflow-core";
import { Flowaid, FlowaidApiError } from "@flowaid/workflow-sdk";
import { describeDb } from "@flowaid/database/testing";
import { FakeWorker, type Script } from "./test/fakeWorker.js";
import { call, createTestApp, login, type TestApp } from "./test/app.js";

describeDb("@flowaid/workflow-sdk against the API (Postgres)", () => {
  let t: TestApp;
  let worker: FakeWorker;
  let fa: Flowaid;
  let workflowId: string;
  beforeAll(async () => {
    t = await createTestApp();
    const jar = await login(t.app);
    const dev = (
      (await call(t.app, jar, "GET", "/v1/environments")).json() as { id: string; name: string }[]
    ).find((e) => e.name === "dev")?.id as string;
    workflowId = (await call(t.app, jar, "POST", "/v1/workflows", { name: "Echo" })).json()
      .id as string;
    const v = (await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/publish`, {})).json();
    await call(t.app, jar, "PUT", `/v1/workflows/${workflowId}/deployments/${dev}`, {
      versionId: v.id,
    });
    const key = (
      await call(t.app, jar, "POST", "/v1/api-keys", {
        name: "sdk",
        scopes: ["runs:create", "runs:read", "runs:approve", "workflows:read"],
        environmentId: dev,
      })
    ).json().key as string;
    worker = new FakeWorker(t.db.app, (input) => {
      const m = (input as { message?: string }).message ?? "";
      return (["fail", "human"].includes(m) ? m : "complete") as Script;
    });
    await worker.start();
    await t.app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = t.app.server.address() as AddressInfo;
    fa = new Flowaid({ baseUrl: `http://127.0.0.1:${port}`, apiKey: key });
  });
  afterAll(async () => {
    await worker.stop();
    await t.close();
  });

  it("async run: streams every durable event over SSE and waits for the result", async () => {
    const run = await fa.workflows.run(workflowId, { message: "hi" });
    expect(run.initialStatus).toBe("queued");
    const events: RunEvent[] = [];
    for await (const ev of run.stream()) events.push(ev);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("RUN_CREATED");
    expect(types.at(-1)).toBe("RUN_COMPLETED");
    const seqs = events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(run.lastEnd).toMatchObject({ final_status: "completed" });

    const done = await run.wait();
    expect(done).toMatchObject({
      status: "completed",
      output: { message: 'echo: {"message":"hi"}' },
    });
    expect(await run.output()).toEqual({ output: done.output, outcome: null });

    // Resuming after a position replays only what follows it.
    const rest: RunEvent[] = [];
    for await (const ev of fa.run(run.id).stream({ after: seqs.at(-2) ?? 0 })) rest.push(ev);
    expect(rest.map((e) => e.seq)).toEqual([seqs.at(-1)]);
  });

  it("sync run: completes in the start call; failures carry the run's error", async () => {
    const run = await fa.workflows.run(workflowId, { message: "sync" }, { mode: "sync" });
    expect(run.initialStatus).toBe("completed");
    expect((await run.wait()).status).toBe("completed");

    const error = await fa.workflows
      .run(workflowId, { message: "fail" }, { mode: "sync" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FlowaidApiError);
    expect(error).toMatchObject({ status: 500, code: "NODE_EXECUTION_ERROR", nodeId: "draft" });
  });

  it("human tasks: waits for a person, responds, and the run completes", async () => {
    const run = await fa.workflows.run(workflowId, { message: "human" }, { mode: "sync" });
    expect(run.initialStatus).toBe("waiting_for_human");
    const taskId = run.humanTask?.id as string;
    const open = await fa.humanTasks.list({ status: "open" });
    expect(open.items.map((x) => x.id)).toContain(taskId);
    expect((await fa.humanTasks.get(taskId)).task.status).toBe("open");
    await fa.humanTasks.respond(taskId, { action: "approve", comment: "ok" });
    const done = await run.wait();
    expect(done).toMatchObject({ status: "completed", outcome: "human_approved" });
  });

  it("typed calls reach every operation; errors keep the envelope", async () => {
    const page = await fa.api.get("/v1/runs", { query: { workflowId, limit: 2 } });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items[0]?.workflowId).toBe(workflowId);
    const missing = await fa.runs
      .get("0190b5a4-0000-7000-8000-000000000999")
      .catch((e: unknown) => e);
    expect(missing).toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect((missing as FlowaidApiError).requestId).toEqual(expect.any(String));
  });
});
