/**
 * Run actions end to end on the real orchestrator (ARCHITECTURE.md §5.9): retry-node reopens a
 * failed run in place; restart-from-node reuses the source run's results before the target.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { runs } from "@flowaid/database";
import { describeDb } from "@flowaid/database/testing";
import { createHarness, type Harness } from "./test/setup.js";

const ref = (node: string, port: string) => ({ kind: "ref", ref: { kind: "port", node, port } });
const task = (id: string, type: string, config: Record<string, unknown>, inputs = {}) => ({
  id,
  kind: "task",
  type,
  typeVersion: "1.0.0",
  name: id,
  config,
  inputs,
});

describeDb("run actions (Postgres, real orchestrator)", () => {
  let h: Harness;
  let workflowId: string;
  let versionId: string;
  let failedRunId: string;
  beforeAll(async () => {
    h = await createHarness();
    // start → a (x+1) → gate (fails unless $vars.ok) → c (value*10) → done
    ({ workflowId, versionId } = await h.deploy("Gated", {
      inputs: { type: "object", properties: { x: { type: "number" } }, required: ["x"] },
      outputs: { type: "object", properties: { y: {} } },
      variables: [{ name: "ok", schema: { type: "boolean" }, default: false, source: "run_input" }],
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        task("a", "flowaid.data.transform", { expr: "start.x + 1" }),
        task(
          "gate",
          "flowaid.dev.assert",
          { condition: "$vars.ok == true", message: "not ok yet" },
          { value: ref("a", "result") },
        ),
        task("c", "flowaid.data.transform", { expr: "gate.value * 10" }),
        {
          id: "done",
          kind: "output",
          name: "Done",
          value: { kind: "object", fields: { y: ref("c", "result") } },
        },
      ],
      edges: [
        { id: "e1", from: { node: "start", port: "done" }, to: { node: "a" } },
        { id: "e2", from: { node: "a", port: "done" }, to: { node: "gate" } },
        { id: "e3", from: { node: "gate", port: "done" }, to: { node: "c" } },
        { id: "e4", from: { node: "c", port: "done" }, to: { node: "done" } },
      ],
    }));
  });
  afterAll(() => h.close());

  it("retry-node: the API reopens a failed run and the worker continues it", async () => {
    failedRunId = await h.start(workflowId, versionId, { x: 1 });
    const failed = await h.waitFor(failedRunId, ["completed", "failed"]);
    expect(failed.status).toBe("failed");
    expect(failed.error?.message).toBe("not ok yet");

    // What POST …/node-runs/:id/retry does: fix the cause (here a run variable), claim, enqueue.
    await h.db.app.system((tx) =>
      tx
        .update(runs)
        .set({ variables: { ok: true }, status: "retrying" })
        .where(and(eq(runs.id, failedRunId), eq(runs.status, "failed"))),
    );
    await h.queue.enqueue("run:general", {
      type: "run.resume",
      runId: failedRunId,
      reason: "manual_retry",
    });
    const done = await h.waitFor(failedRunId, ["completed"]);
    expect(done.output).toEqual({ y: 20 });
    expect(done.error).toBeNull();
    expect(done.endedAt).not.toBeNull();

    const events = await h.store.listEvents(failedRunId, 0, 1000);
    const types = events.map((e) => e.type);
    expect(types.indexOf("RUN_FAILED")).toBeLessThan(types.indexOf("NODE_RETRIED"));
    expect(types.at(-1)).toBe("RUN_COMPLETED");
    const retried = events.find((e) => e.type === "NODE_RETRIED");
    expect(retried).toMatchObject({ nodeId: "gate", nextAttempt: 2, delayMs: 0 });
    const gate = (await h.store.listNodeRuns(failedRunId)).filter((n) => n.nodeId === "gate");
    expect(gate.map((n) => [n.attempt, n.status])).toEqual([
      [1, "retry_wait"],
      [2, "completed"],
    ]);
  });

  it("restart from a node: earlier results are reused, the node and what follows execute", async () => {
    const restartId = await h.start(
      workflowId,
      versionId,
      { x: 1 },
      { origin: "restart", sourceRunId: failedRunId },
      {
        variables: { ok: true },
        replay: { mode: "recorded", action: "restart", fromNodeId: "c", inputOverrides: [] },
      },
    );
    const run = await h.waitFor(restartId, ["completed", "failed"]);
    expect(run.status).toBe("completed");
    expect(run.output).toEqual({ y: 20 });
    const completed = (await h.store.listEvents(restartId, 0, 1000)).filter(
      (e) => e.type === "NODE_COMPLETED",
    );
    const reused = completed.filter((e) => e.reused).map((e) => e.nodeId);
    expect(reused.sort()).toEqual(["a", "gate"]);
    expect(completed.find((e) => e.nodeId === "c")?.reused).toBe(false);
    const nodeRuns = await h.store.listNodeRuns(restartId);
    expect(nodeRuns.find((n) => n.nodeId === "a")?.status).toBe("reused");
  });
});
