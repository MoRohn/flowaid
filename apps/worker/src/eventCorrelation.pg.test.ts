/**
 * RFC-0006 end to end on the real orchestrator: a correlated event wait records its key in
 * `event_subscriptions`, and only a signal carrying that key resumes the run.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { eventSubscriptions } from "@flowaid/database";
import { describeDb } from "@flowaid/database/testing";
import { createHarness, type Harness } from "./test/setup.js";

describeDb("event correlation (Postgres, real orchestrator)", () => {
  let h: Harness;
  let workflowId: string;
  let versionId: string;
  beforeAll(async () => {
    h = await createHarness();
    ({ workflowId, versionId } = await h.deploy("Await payment", {
      inputs: { type: "object", properties: { order: { type: "string" } }, required: ["order"] },
      outputs: {},
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        {
          id: "paid",
          kind: "wait",
          name: "Paid",
          until: {
            type: "event",
            eventName: "order.paid",
            timeoutMs: 600_000,
            correlation: { kind: "ref", ref: { kind: "port", node: "start", port: "order" } },
          },
        },
        {
          id: "done",
          kind: "output",
          name: "Done",
          value: { kind: "ref", ref: { kind: "port", node: "paid", port: "payload" } },
        },
      ],
      edges: [
        { id: "e1", from: { node: "start", port: "done" }, to: { node: "paid" } },
        { id: "e2", from: { node: "paid", port: "done" }, to: { node: "done" } },
      ],
    }));
  });
  afterAll(() => h.close());

  it("subscribes with the key and resumes only for a matching signal", async () => {
    const runId = await h.start(workflowId, versionId, { order: "A-1" });
    await h.waitFor(runId, ["waiting"]);
    const subs = await h.db.app.system((tx) =>
      tx.select().from(eventSubscriptions).where(eq(eventSubscriptions.runId, runId)),
    );
    expect(subs.map((s) => [s.eventName, s.correlationKey])).toEqual([["order.paid", "A-1"]]);

    await h.queue.enqueue("run:general", {
      type: "run.signal",
      runId,
      signal: {
        type: "event",
        eventName: "order.paid",
        payload: { amount: 1 },
        correlationKey: "B-2",
      },
    });
    await new Promise((r) => setTimeout(r, 500));
    expect((await h.store.getRun(runId))?.status).toBe("waiting");

    await h.queue.enqueue("run:general", {
      type: "run.signal",
      runId,
      signal: {
        type: "event",
        eventName: "order.paid",
        payload: { amount: 10 },
        correlationKey: "A-1",
      },
    });
    const run = await h.waitFor(runId, ["completed"]);
    expect(run.output).toEqual({ amount: 10 });
    const left = await h.db.app.system((tx) =>
      tx.select().from(eventSubscriptions).where(eq(eventSubscriptions.runId, runId)),
    );
    expect(left).toEqual([]);
  });
});
