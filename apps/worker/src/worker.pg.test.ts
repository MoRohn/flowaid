import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { humanTasks } from "@flowaid/database";
import { eq } from "drizzle-orm";
import { createHarness, type Harness } from "./test/setup.js";

const ref = (node: string, port: string, path?: string) => ({
  kind: "ref",
  ref: { kind: "port", node, port, ...(path ? { path } : {}) },
});

describeDb("worker end to end (Postgres)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  it("runs data nodes to completion with the output and a full event log", async () => {
    const { workflowId, versionId } = await h.deploy("Greeter", {
      inputs: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      outputs: { type: "object", properties: { greeting: { type: "string" }, shout: {} } },
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        {
          id: "greet",
          kind: "task",
          type: "flowaid.data.template",
          typeVersion: "1.0.0",
          name: "Greet",
          config: { template: "Hello {{ start.name }}" },
        },
        {
          id: "shout",
          kind: "task",
          type: "flowaid.data.transform",
          typeVersion: "1.0.0",
          name: "Shout",
          config: { expr: "upper(greet.text)" },
        },
        {
          id: "done",
          kind: "output",
          name: "Done",
          value: {
            kind: "object",
            fields: { greeting: ref("greet", "text"), shout: ref("shout", "result") },
          },
        },
      ],
    });
    const runId = await h.start(workflowId, versionId, { name: "Ada" });
    const run = await h.waitFor(runId, ["completed", "failed"]);
    expect(run.status).toBe("completed");
    expect(run.output).toEqual({ greeting: "Hello Ada", shout: "HELLO ADA" });
    const types = (await h.store.listEvents(runId, 0, 1000)).map((e) => e.type);
    expect(types[0]).toBe("RUN_CREATED");
    expect(types).toContain("RUN_STARTED");
    // input, greet, shout and output nodes
    expect(types.filter((t) => t === "NODE_COMPLETED")).toHaveLength(4);
    expect(types.at(-1)).toBe("RUN_COMPLETED");
    const nodeRuns = await h.store.listNodeRuns(runId);
    expect(nodeRuns.map((n) => n.nodeId).sort()).toEqual(
      expect.arrayContaining(["greet", "shout"]),
    );
  });

  it("makes typed decisions through the provider registry and records them", async () => {
    const { workflowId, versionId } = await h.deploy("Urgency", {
      inputs: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
      outputs: { type: "object", properties: { urgent: {}, confidence: {} } },
      secrets: [{ name: "TYPESAFE_API_KEY", credentialType: "typesafe.api_key", required: false }],
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        {
          id: "judge",
          kind: "task",
          type: "flowaid.decision.boolean",
          typeVersion: "1.0.0",
          name: "Urgent?",
          config: { instructions: "Is this message urgent?" },
          inputs: { state: ref("start", "message") },
          credentials: { typesafe: "TYPESAFE_API_KEY" },
        },
        {
          id: "done",
          kind: "output",
          name: "Done",
          value: {
            kind: "object",
            fields: {
              urgent: ref("judge", "decision", "/value"),
              confidence: ref("judge", "decision", "/confidence"),
            },
          },
        },
      ],
    });
    const runId = await h.start(workflowId, versionId, { message: "The site is down!" });
    const run = await h.waitFor(runId, ["completed", "failed"]);
    expect(run.error).toBeNull();
    expect(run.output).toEqual({ urgent: true, confidence: 0.93 });
    const events = await h.store.listEvents(runId, 0, 1000);
    const decided = events.find((e) => e.type === "DECISION_COMPLETED") as
      { decision?: { provider: string; pYes: number } } | undefined;
    expect(decided?.decision).toMatchObject({ provider: "typesafe", pYes: 0.93 });
    expect(run.costUsd).toBeGreaterThan(0);
  });

  it("waits for a person and resumes after the response", async () => {
    const { workflowId, versionId } = await h.deploy("Approval", {
      inputs: { type: "object", properties: { amount: { type: "number" } }, required: ["amount"] },
      outputs: { type: "object", properties: { action: {} } },
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        {
          id: "approve",
          kind: "human",
          name: "Approve refund",
          mode: { type: "approval" },
          title: { kind: "template", source: "Refund {{ start.amount }}?" },
        },
        {
          id: "done",
          kind: "output",
          name: "Done",
          value: { kind: "object", fields: { action: ref("approve", "decision", "/action") } },
        },
      ],
    });
    const runId = await h.start(workflowId, versionId, { amount: 42 });
    await h.waitFor(runId, ["waiting_for_human"]);
    const [task] = await h.db.app.system((tx) =>
      tx.select().from(humanTasks).where(eq(humanTasks.runId, runId)),
    );
    expect(task?.request).toMatchObject({
      title: "Refund 42?",
      mode: { type: "approval" },
      origin: "human_node",
    });
    expect(
      await h.store.respondHumanTask(
        task?.id as string,
        { action: "approve", comment: "ok" },
        "user:1",
      ),
    ).toBe(true);
    await h.queue.enqueue("run:general", { type: "run.resume", runId, reason: "human" });
    const run = await h.waitFor(runId, ["completed", "failed"]);
    expect(run.output).toEqual({ action: "approve" });
  });

  it("redelivers a trigger that arrives while another worker holds the run", async () => {
    const { workflowId, versionId } = await h.deploy("Approval (busy)", {
      inputs: { type: "object", properties: {} },
      outputs: { type: "object", properties: { action: {} } },
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        {
          id: "approve",
          kind: "human",
          name: "Approve",
          mode: { type: "approval" },
          title: { kind: "template", source: "Approve?" },
        },
        {
          id: "done",
          kind: "output",
          name: "Done",
          value: { kind: "object", fields: { action: ref("approve", "decision", "/action") } },
        },
      ],
      edges: [{ id: "c1", from: { node: "start", port: "done" }, to: { node: "approve" } }],
    });
    const runId = await h.start(workflowId, versionId, {});
    await h.waitFor(runId, ["waiting_for_human"]);
    const [task] = await h.db.app.system((tx) =>
      tx.select().from(humanTasks).where(eq(humanTasks.runId, runId)),
    );
    await h.store.respondHumanTask(task?.id as string, { action: "approve" }, "user:1");
    // another worker holds the run when the resume job is handled
    expect(await h.store.acquireLease(runId, "worker-elsewhere", 60_000)).not.toBeNull();
    await h.queue.enqueue("run:general", { type: "run.resume", runId, reason: "human" });
    await new Promise((r) => setTimeout(r, 300));
    expect((await h.store.getRun(runId))?.status).toBe("waiting_for_human");
    await h.store.releaseLease(runId, "worker-elsewhere");
    const run = await h.waitFor(runId, ["completed", "failed"]);
    expect(run.output).toEqual({ action: "approve" });
  });

  it("fails runs with a node error and cancels on request", async () => {
    const { workflowId, versionId } = await h.deploy("Breaks", {
      inputs: { type: "object", properties: {} },
      outputs: { type: "object", properties: { v: {} } },
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        {
          id: "check",
          kind: "task",
          type: "flowaid.dev.assert",
          typeVersion: "1.0.0",
          name: "Check",
          config: { condition: "1 > 2", message: "one is not greater than two" },
        },
        {
          id: "done",
          kind: "output",
          name: "Done",
          value: { kind: "object", fields: { v: ref("check", "value") } },
        },
      ],
      // No data dependency on the input: a control edge activates the node.
      edges: [{ id: "c1", from: { node: "start", port: "done" }, to: { node: "check" } }],
    });
    const runId = await h.start(workflowId, versionId, {});
    const failed = await h.waitFor(runId, ["failed", "completed"]);
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatchObject({
      code: "NODE_EXECUTION_ERROR",
      message: expect.stringContaining("one is not greater than two"),
    });

    const slow = await h.deploy("Slow", {
      inputs: { type: "object", properties: {} },
      outputs: { type: "object", properties: { v: {} } },
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        {
          id: "wait",
          kind: "task",
          type: "flowaid.dev.mock",
          typeVersion: "1.0.0",
          name: "Wait",
          config: { output: 1, delayMs: 30_000 },
        },
        {
          id: "done",
          kind: "output",
          name: "Done",
          value: { kind: "object", fields: { v: ref("wait", "output") } },
        },
      ],
      edges: [{ id: "c1", from: { node: "start", port: "done" }, to: { node: "wait" } }],
    });
    const slowId = await h.start(slow.workflowId, slow.versionId, {});
    await h.waitFor(slowId, ["running"]);
    await h.store.requestCancel(slowId, "user:1", "test");
    await h.queue.enqueue("run:control", {
      type: "run.control",
      runId: slowId,
      action: "cancel",
      by: "user:1",
      reason: "test",
    });
    const cancelled = await h.waitFor(slowId, ["cancelled"]);
    expect(cancelled.status).toBe("cancelled");
  });
});
