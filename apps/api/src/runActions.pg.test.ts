import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { runs } from "@flowaid/database";
import { describeDb } from "@flowaid/database/testing";
import { FakeWorker, type Script } from "./test/fakeWorker.js";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

/**
 * Run actions (API.md §3.4, ARCHITECTURE.md §5.9): replay, restart-from-node, fork and retry-node
 * as the API sees them — validation, the new run's row (origin, source, replay spec), the retry
 * claim and its job, audit. Execution is covered by the worker's run-actions test.
 */
describeDb("run actions (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  let worker: FakeWorker;
  let workflowId: string;
  let versionId: string;
  const post = (url: string, body: unknown = {}) => call(t.app, jar, "POST", url, body);

  const runTo = async (message: string, status: string): Promise<string> => {
    const id = (await post(`/v1/workflows/${workflowId}/run`, { input: { message } })).json()
      .run_id as string;
    for (let i = 0; i < 200; i++) {
      if ((await call(t.app, jar, "GET", `/v1/runs/${id}`)).json().status === status) return id;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`run ${id} never became ${status}`);
  };
  const row = async (id: string) =>
    (await t.db.app.system((tx) => tx.select().from(runs).where(eq(runs.id, id))))[0];

  beforeAll(async () => {
    t = await createTestApp();
    jar = await login(t.app);
    const envs = (await call(t.app, jar, "GET", "/v1/environments")).json() as {
      id: string;
      name: string;
    }[];
    workflowId = (await post("/v1/workflows", { name: "Echo" })).json().id as string;
    versionId = (await post(`/v1/workflows/${workflowId}/publish`)).json().id as string;
    await call(t.app, jar, "PUT", `/v1/workflows/${workflowId}/deployments/${envs[0]?.id}`, {
      versionId,
    });
    worker = new FakeWorker(t.db.app, (input) =>
      (input as { message?: string }).message === "fail" ? "fail" : ("complete" as Script),
    );
    await worker.start();
  });
  afterAll(async () => {
    await worker.stop();
    await t.close();
  });

  describe("retry-node", () => {
    it("reopens a failed run in place: claims it, enqueues the retry, audits it", async () => {
      const failed = await runTo("fail", "failed");
      const nodeRuns = (await call(t.app, jar, "GET", `/v1/runs/${failed}/node-runs`)).json() as {
        id: string;
        nodeId: string;
        status: string;
      }[];
      const draft = nodeRuns.find((n) => n.nodeId === "draft");
      expect(draft?.status).toBe("failed");

      const missing = await post(
        `/v1/runs/${failed}/node-runs/00000000-0000-4000-8000-000000000000/retry`,
      );
      expect(missing.statusCode).toBe(404);

      const res = await post(`/v1/runs/${failed}/node-runs/${draft?.id}/retry`);
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ run_id: failed, status: "retrying" });
      expect((await row(failed))?.status).toBe("retrying");
      for (let i = 0; i < 100 && !worker.jobs.some((j) => j.type === "run.resume"); i++)
        await new Promise((r) => setTimeout(r, 25));
      expect(worker.jobs).toContainEqual({
        type: "run.resume",
        runId: failed,
        reason: "manual_retry",
      });
      // The claim makes a second retry a conflict, not a second resume.
      expect((await post(`/v1/runs/${failed}/node-runs/${draft?.id}/retry`)).statusCode).toBe(409);
      const audit = (await call(t.app, jar, "GET", "/v1/audit?action=run.retry_node")).json() as {
        items: { resourceId: string; details: { nodeId?: string } }[];
      };
      expect(audit.items[0]).toMatchObject({ resourceId: failed, details: { nodeId: "draft" } });
    });

    it("refuses runs that did not fail", async () => {
      const ok = await runTo("hi", "completed");
      expect(
        (await post(`/v1/runs/${ok}/node-runs/00000000-0000-4000-8000-000000000000/retry`))
          .statusCode,
      ).toBe(409);
    });
  });

  describe("restart, fork and recorded replay", () => {
    let source: string;
    beforeAll(async () => {
      source = await runTo("hi", "completed");
    });

    it("restart: a new run that re-executes from the node, with the node's inputs patched", async () => {
      expect((await post(`/v1/runs/${source}/restart`, { nodeId: "nope" })).statusCode).toBe(409);
      const res = await post(`/v1/runs/${source}/restart`, {
        nodeId: "done",
        input: { value: { message: "patched" } },
      });
      expect(res.statusCode).toBe(202);
      const created = await row(res.json().run_id as string);
      expect(created).toMatchObject({
        origin: "restart",
        sourceRunId: source,
        workflowVersionId: versionId,
        input: { message: "hi" },
        replay: {
          mode: "recorded",
          action: "restart",
          fromNodeId: "done",
          inputOverrides: [{ nodeId: "done", input: { value: { message: "patched" } } }],
        },
      });
    });

    it("fork: onto the draft or a version, with patched input and variables", async () => {
      expect((await post(`/v1/runs/${source}/fork`, {})).statusCode).toBe(400);
      expect((await post(`/v1/runs/${source}/fork`, { versionId, draft: true })).statusCode).toBe(
        400,
      );
      expect(
        (await post(`/v1/runs/${source}/fork`, { draft: true, nodeId: "nope" })).statusCode,
      ).toBe(409);
      const res = await post(`/v1/runs/${source}/fork`, {
        draft: true,
        nodeId: "done",
        input: { message: "forked" },
        variables: { tone: "formal" },
      });
      expect(res.statusCode).toBe(202);
      const created = await row(res.json().run_id as string);
      expect(created).toMatchObject({
        origin: "fork",
        sourceRunId: source,
        input: { message: "forked" },
        variables: { tone: "formal" },
        replay: { action: "fork", fromNodeId: "done", inputOverrides: [] },
      });
      expect(created?.workflowVersionId).not.toBe(versionId); // the draft's version row
    });

    it("replay: re-executes by default, reuses recorded results on request", async () => {
      const plain = await post(`/v1/runs/${source}/replay`);
      expect((await row(plain.json().run_id as string))?.replay).toBeNull();
      const recorded = await post(`/v1/runs/${source}/replay`, { mode: "recorded" });
      expect(await row(recorded.json().run_id as string)).toMatchObject({
        origin: "replay",
        sourceRunId: source,
        replay: { action: "replay", fromNodeId: null },
      });
    });

    it("refuses to reuse a run whose node results were not persisted", async () => {
      const secret = await runTo("hi", "completed");
      const privacy = (await row(secret))?.privacy;
      if (!privacy) throw new Error("the run has no privacy settings");
      await t.db.app.system((tx) =>
        tx
          .update(runs)
          .set({ privacy: { ...privacy, doNotPersist: true, replayable: false } })
          .where(eq(runs.id, secret)),
      );
      expect((await post(`/v1/runs/${secret}/restart`, { nodeId: "done" })).statusCode).toBe(409);
      expect((await post(`/v1/runs/${secret}/fork`, { draft: true })).statusCode).toBe(409);
      expect((await post(`/v1/runs/${secret}/replay`, { mode: "recorded" })).statusCode).toBe(409);
      expect((await post(`/v1/runs/${secret}/replay`)).statusCode).toBe(202);
    });
  });
});
