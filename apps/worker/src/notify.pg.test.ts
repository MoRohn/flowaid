import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { notifications, workspaces } from "@flowaid/database";
import { eq } from "drizzle-orm";
import { uuidv7 } from "@flowaid/shared";
import { createAlertDispatcher } from "./services/alerts.js";
import { createHarness, type Harness } from "./test/setup.js";

const ref = (node: string, port: string, path?: string) => ({
  kind: "ref",
  ref: { kind: "port", node, port, ...(path ? { path } : {}) },
});

describeDb("workspace alerts from the worker reach subscribed, enabled channels (Postgres)", () => {
  let h: Harness;
  const delivered: { url: string; body: Record<string, unknown> }[] = [];
  beforeAll(async () => {
    // the real dispatcher (channel lookup, dedupe, delivery log) over the harness database
    h = await createHarness({
      extra: ({ db, credentials }) => ({
        webUrl: "https://app.example.com",
        alerts: createAlertDispatcher({
          db,
          credentials,
          fetch: (url, init) => {
            delivered.push({
              url,
              body: JSON.parse(init.body as string) as Record<string, unknown>,
            });
            return Promise.resolve(new Response("", { status: 204 }));
          },
        }),
      }),
    });
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
    expect(human?.body).toMatchObject({ title: "Review needed: Refund 42?" });
    expect(String(human?.body.url)).toMatch(
      /^https:\/\/app\.example\.com\/ws-[0-9a-f]+\/human-tasks\//,
    );
    expect(delivered.find((d) => d.body.event === "run.failed")?.body).toMatchObject({
      title: expect.stringMatching(/^Run failed in /),
      text: expect.stringContaining("one is not greater than two"),
    });
  });
  it("sends budget.exceeded once a month when finished runs reach the monthly budget", async () => {
    await h.db.app.system(async (tx) => {
      await tx.insert(notifications).values({
        id: uuidv7(),
        workspaceId: h.workspaceId,
        kind: "webhook",
        name: "finance",
        config: { url: "https://hooks.example.com/finance" },
        events: ["budget.warning", "budget.exceeded"],
      });
      // one decision of the fake provider costs $0.00002: the first run reaches the budget
      await tx
        .update(workspaces)
        .set({ settings: { budgets: { monthlyCostUsd: 0.00002 } } })
        .where(eq(workspaces.id, h.workspaceId));
    });
    const judge = await h.deploy("Costs", {
      inputs: { type: "object", properties: { message: { type: "string" } } },
      outputs: { type: "object", properties: { urgent: {} } },
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
          value: { kind: "object", fields: { urgent: ref("judge", "decision", "/value") } },
        },
      ],
    });
    try {
      for (const message of ["one", "two"]) {
        const id = await h.start(judge.workflowId, judge.versionId, { message });
        expect((await h.waitFor(id, ["completed", "failed"])).status).toBe("completed");
      }
      const finance = () => delivered.filter((d) => d.url === "https://hooks.example.com/finance");
      const deadline = Date.now() + 5_000;
      while (finance().length < 1 && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 50));
      await new Promise((r) => setTimeout(r, 300));
      expect(finance().map((d) => d.body.event)).toEqual(["budget.exceeded"]);
      expect(finance()[0]?.body).toMatchObject({
        severity: "critical",
        title: expect.stringMatching(/^Monthly budget reached \(\d{4}-\d{2}\)$/),
        url: expect.stringMatching(/\/settings\?tab=workspace$/),
      });
    } finally {
      await h.db.app.system((tx) =>
        tx.update(workspaces).set({ settings: {} }).where(eq(workspaces.id, h.workspaceId)),
      );
    }
  });
});
