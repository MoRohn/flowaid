import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { describeDb } from "@flowaid/database/testing";
import { alertDeliveries, auditEvents, notifications, runs, workspaces } from "@flowaid/database";
import { setupTelemetry, startMetricsListener, type Telemetry } from "@flowaid/observability";
import { booleanDecision, choiceDecision } from "@flowaid/providers";
import { uuidv7 } from "@flowaid/shared";
import type { DecisionProvider } from "@flowaid/workflow-core";
import { createAlertDispatcher } from "./services/alerts.js";
import { createHarness, type Harness } from "./test/setup.js";

const ref = (node: string, port: string) => ({ kind: "ref", ref: { kind: "port", node, port } });

/** A judge that pages on call and thinks the outcome is wrong. */
const judge = {
  id: "fake-judge",
  model: "judge-1",
  capabilities: {
    batch: false,
    maxQuestions: 1,
    maxStateTokens: 100_000,
    kinds: ["boolean", "choice", "score"],
    text: true,
    images: false,
  },
  decideChoice: () =>
    Promise.resolve(
      choiceDecision(
        { NO_ACTION: 0.02, REVIEW: 0.03, PRIORITY_REVIEW: 0.05, FILE_BUG: 0.1, PAGE_ON_CALL: 0.8 },
        { provider: "fake", model: "judge-1", latencyMs: 3, costUsd: 0.0001 },
      ),
    ),
  decideBoolean: () =>
    Promise.resolve(
      booleanDecision(0.9, { provider: "fake", model: "judge-1", latencyMs: 3, costUsd: 0 }),
    ),
  decideScore: () => Promise.reject(new Error("unused")),
  batch: () => Promise.reject(new Error("unused")),
} as unknown as DecisionProvider;

describeDb("observability: metrics, alerts and trace reviews (Postgres)", () => {
  let h: Harness;
  let telemetry: Telemetry;
  const posted: { url: string; body: Record<string, unknown> }[] = [];
  beforeAll(async () => {
    telemetry = setupTelemetry({ serviceName: "worker-test", global: false });
    h = await createHarness({
      extra: ({ db, credentials }) => ({
        instruments: telemetry.instruments,
        metricsSampleMs: 50,
        webUrl: "https://flowaid.example",
        traceReview: { judge },
        alerts: createAlertDispatcher({
          db,
          credentials,
          fetch: (url, init) => {
            posted.push({ url, body: JSON.parse(init.body as string) as Record<string, unknown> });
            return Promise.resolve(new Response("ok"));
          },
        }),
      }),
    });
    await h.db.app.system(async (tx) => {
      await tx
        .update(workspaces)
        .set({ settings: { traceReview: { enabled: true, sampleRate: 0 } } as never })
        .where(eq(workspaces.id, h.workspaceId));
      await tx.insert(notifications).values({
        id: uuidv7(),
        workspaceId: h.workspaceId,
        kind: "webhook",
        name: "on-call",
        config: { url: "https://hooks.example/alerts" },
        events: ["run.failed", "trace_review.page", "human_task.created"],
      });
    });
  });
  afterAll(async () => {
    await h.close();
    await telemetry.shutdown();
  });

  const until = async (check: () => Promise<boolean> | boolean, what: string) => {
    for (let i = 0; i < 200; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timed out waiting for ${what}`);
  };

  it("a failed run records metrics, alerts once, and is reviewed with a page", async () => {
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
      edges: [{ id: "c1", from: { node: "start", port: "done" }, to: { node: "check" } }],
    });
    const runId = await h.start(workflowId, versionId, {});
    await h.waitFor(runId, ["failed"]);

    await until(
      () =>
        posted.some(
          (p) =>
            p.body.event === "run.failed" && (p.body.data as { runId?: string }).runId === runId,
        ),
      "the run.failed alert",
    );
    const failed = posted.find((p) => p.body.event === "run.failed");
    expect(failed?.url).toBe("https://hooks.example/alerts");
    expect(failed?.body).toMatchObject({
      severity: "warning",
      url: expect.stringMatching(new RegExp(`/runs/${runId}$`)),
      data: { code: "NODE_EXECUTION_ERROR", nodeId: "check" },
    });

    // the review job pages on call: runs.review, an audit row and a second alert
    await until(async () => {
      const [row] = await h.db.app.system((tx) =>
        tx.select({ review: runs.review }).from(runs).where(eq(runs.id, runId)),
      );
      return row?.review?.verdict === "PAGE_ON_CALL";
    }, "the trace review");
    const audit = await h.db.app.system((tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.action, "run.reviewed"), eq(auditEvents.resourceId, runId))),
    );
    expect(audit[0]?.details).toMatchObject({
      verdict: "PAGE_ON_CALL",
      source: "provider",
      alert: true,
    });
    await until(() => posted.some((p) => p.body.event === "trace_review.page"), "the page");
    const page = posted.find((p) => p.body.event === "trace_review.page");
    expect(page?.body).toMatchObject({ severity: "critical", data: { verdict: "PAGE_ON_CALL" } });

    const deliveries = await h.db.app.system((tx) =>
      tx.select().from(alertDeliveries).where(eq(alertDeliveries.workspaceId, h.workspaceId)),
    );
    expect(deliveries.map((d) => d.status)).toEqual(["sent", "sent"]);
    expect(new Set(deliveries.map((d) => d.key))).toEqual(
      new Set([`run.failed:${runId}`, `trace_review.page:${runId}`]),
    );

    const handler = telemetry.prometheusHandler;
    if (!handler) throw new Error("no prometheus handler");
    const listener = await startMetricsListener({ port: 0, host: "127.0.0.1", handler });
    try {
      const text = await (await fetch(`http://127.0.0.1:${listener.port}/metrics`)).text();
      expect(text).toMatch(/flowaid_runs_total\{[^}]*status="failed"[^}]*\} 1/);
      expect(text).toMatch(/flowaid_node_runs_total\{[^}]*type="flowaid.dev.assert"[^}]*\} 1/);
      expect(text).toContain("flowaid_run_duration_ms_bucket");
    } finally {
      await listener.close();
    }
  });

  it("a waiting human task alerts its channels", async () => {
    const { workflowId, versionId } = await h.deploy("Approve", {
      inputs: { type: "object", properties: {} },
      outputs: { type: "object", properties: {} },
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        {
          id: "approve",
          kind: "human",
          name: "Approve",
          mode: { type: "approval" },
          title: { kind: "literal", value: "Approve the refund" },
        },
        { id: "done", kind: "output", name: "Done", value: { kind: "literal", value: {} } },
      ],
      edges: [
        { id: "c1", from: { node: "start", port: "done" }, to: { node: "approve" } },
        { id: "c2", from: { node: "approve", port: "approved" }, to: { node: "done" } },
      ],
    });
    const runId = await h.start(workflowId, versionId, {});
    await h.waitFor(runId, ["waiting_for_human"]);
    await until(() => posted.some((p) => p.body.event === "human_task.created"), "the task alert");
    const alert = posted.find((p) => p.body.event === "human_task.created");
    expect(alert?.body).toMatchObject({
      title: "Review needed: Approve the refund",
      data: { runId, nodeId: "approve" },
      url: expect.stringContaining("/human-tasks/"),
    });
  });

  it("samples queue depth and the runs the worker holds", async () => {
    // a delayed job waits on the queue without being claimed
    await h.queue.enqueue(
      "ingest",
      { type: "ingest.source", sourceId: "later" },
      { delayMs: 60_000, jobId: "depth-probe" },
    );
    const handler = telemetry.prometheusHandler;
    if (!handler) throw new Error("no prometheus handler");
    const listener = await startMetricsListener({ port: 0, host: "127.0.0.1", handler });
    try {
      const scrape = async () => (await fetch(`http://127.0.0.1:${listener.port}/metrics`)).text();
      await expect
        .poll(scrape, { timeout: 5_000 })
        .toMatch(/flowaid_queue_depth\{[^}]*queue="ingest"[^}]*\} 1/);
      const text = await scrape();
      expect(text).toMatch(/flowaid_queue_depth\{[^}]*queue="run:general"[^}]*\} 0/);
      expect(text).toMatch(/flowaid_worker_active_runs\{[^}]*pool="general"[^}]*\} \d+/);
    } finally {
      await listener.close();
    }
  });
});
