import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { notificationTargets, notifications } from "@flowaid/database";
import { createNotifier, type NotificationKind } from "@flowaid/observability";
import { uuidv7 } from "@flowaid/shared";
import { createHarness, type Harness } from "./test/setup.js";

const ref = (node: string, port: string, path?: string) => ({
  kind: "ref",
  ref: { kind: "port", node, port, ...(path ? { path } : {}) },
});

describeDb("workspace notifications from the worker (Postgres)", () => {
  let h: Harness;
  const delivered: { url: string; body: Record<string, unknown> }[] = [];
  beforeAll(async () => {
    const notifier = createNotifier({
      // the real channel lookup, over the harness database (assigned before any run starts)
      targets: async (workspaceId, event) =>
        (await h.db.app.system((tx) => notificationTargets(tx, workspaceId, event))).map((r) => ({
          id: r.id,
          kind: r.kind as NotificationKind,
          name: r.name,
          config: r.config,
          credentialId: r.credentialId,
        })),
      secretFor: () => Promise.resolve(undefined),
      fetch: (url, init) => {
        delivered.push({ url, body: JSON.parse(init?.body as string) as Record<string, unknown> });
        return Promise.resolve(new Response("", { status: 204 }));
      },
    });
    h = await createHarness({ notify: { notifier, webUrl: "https://app.example.com" } });
    await h.db.app.system((tx) =>
      tx.insert(notifications).values([
        {
          id: uuidv7(),
          workspaceId: h.workspaceId,
          kind: "webhook",
          name: "ops",
          config: { url: "https://hooks.example.com/ops" },
          events: ["human_task.created", "run.failed"],
        },
        {
          id: uuidv7(),
          workspaceId: h.workspaceId,
          kind: "webhook",
          name: "muted",
          config: { url: "https://hooks.example.com/muted" },
          events: ["human_task.created", "run.failed"],
          enabled: false,
        },
      ]),
    );
  });
  afterAll(() => h.close());

  it("notifies subscribed, enabled channels when a run waits for a person and when one fails", async () => {
    const approval = await h.deploy("Approval", {
      inputs: { type: "object", properties: {} },
      outputs: { type: "object", properties: { action: {} } },
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        {
          id: "approve",
          kind: "human",
          name: "Approve",
          mode: { type: "approval" },
          title: { kind: "literal", value: "Refund 42?" },
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
    const waiting = await h.start(approval.workflowId, approval.versionId, {});
    await h.waitFor(waiting, ["waiting_for_human"]);

    const breaks = await h.deploy("Breaks", {
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
      edges: [{ id: "c1", from: { node: "start", port: "done" }, to: { node: "check" } }],
    });
    const failing = await h.start(breaks.workflowId, breaks.versionId, {});
    await h.waitFor(failing, ["failed"]);

    const deadline = Date.now() + 5_000;
    while (delivered.length < 2 && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 50));
    expect(delivered.every((d) => d.url === "https://hooks.example.com/ops")).toBe(true);
    const events = delivered.map((d) => d.body.event).sort();
    expect(events).toEqual(["human_task.created", "run.failed"]);
    const human = delivered.find((d) => d.body.event === "human_task.created");
    expect(human?.body).toMatchObject({ title: "Waiting for you: Refund 42?" });
    expect(String(human?.body.url)).toMatch(
      /^https:\/\/app\.example\.com\/ws-[0-9a-f]+\/human-tasks\//,
    );
    expect(delivered.find((d) => d.body.event === "run.failed")?.body).toMatchObject({
      title: "Run failed: Breaks",
      text: expect.stringContaining("one is not greater than two"),
    });
  });
});
