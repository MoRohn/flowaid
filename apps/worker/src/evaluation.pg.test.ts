import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import {
  evaluationCases,
  evaluationResults,
  evaluationRuns,
  evaluationSets,
} from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import { eq } from "drizzle-orm";
import { createHarness, type Harness } from "./test/setup.js";

const ref = (node: string, port: string, path?: string) => ({
  kind: "ref",
  ref: { kind: "port", node, port, ...(path ? { path } : {}) },
});

describeDb("evaluation runs (Postgres)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  const startEvaluation = async (
    workflowId: string,
    versionId: string,
    cases: { input: unknown; expected: unknown }[],
    extra: Record<string, unknown> = {},
  ) => {
    const setId = uuidv7();
    const runId = uuidv7();
    await h.db.app.system(async (tx) => {
      await tx.insert(evaluationSets).values({
        id: setId,
        workspaceId: h.workspaceId,
        workflowId,
        name: `set-${setId.slice(-6)}`,
      });
      await tx.insert(evaluationCases).values(
        cases.map((c, i) => ({
          id: uuidv7(),
          workspaceId: h.workspaceId,
          setId,
          ordinal: i,
          input: c.input as never,
          expected: c.expected as never,
        })),
      );
      await tx.insert(evaluationRuns).values({
        id: runId,
        workspaceId: h.workspaceId,
        setId,
        workflowId,
        workflowVersionId: versionId,
        environmentId: h.environmentId,
        concurrency: 2,
        ...extra,
      });
    });
    await h.queue.enqueue("evaluation", { type: "evaluation.run", evaluationRunId: runId });
    for (let i = 0; i < 400; i++) {
      const [r] = await h.db.app.system((tx) =>
        tx.select().from(evaluationRuns).where(eq(evaluationRuns.id, runId)),
      );
      if (r && ["completed", "failed", "cancelled"].includes(r.status)) return r;
      await new Promise((res) => setTimeout(res, 100));
    }
    const [r] = await h.db.app.system((tx) =>
      tx.select().from(evaluationRuns).where(eq(evaluationRuns.id, runId)),
    );
    const runs = await h.db
      .admin`select queue, attempts, last_error, done_at from queue_jobs where queue = 'evaluation'`;
    throw new Error(`evaluation did not finish: ${JSON.stringify(r)} runs=${JSON.stringify(runs)}`);
  };

  it("runs every case, scores decisions and outputs, and summarises", async () => {
    const { workflowId, versionId } = await h.deploy("Triage", {
      inputs: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
      outputs: { type: "object", properties: { urgent: {}, echo: {} } },
      secrets: [{ name: "TYPESAFE_API_KEY", credentialType: "typesafe.api_key", required: false }],
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        {
          id: "judge",
          kind: "task",
          type: "flowaid.decision.boolean",
          typeVersion: "1.0.0",
          name: "Urgent?",
          config: { instructions: "Urgent?" },
          inputs: { state: ref("start", "message") },
          credentials: { typesafe: "TYPESAFE_API_KEY" },
        },
        {
          id: "echo",
          kind: "task",
          type: "flowaid.data.template",
          typeVersion: "1.0.0",
          name: "Echo",
          config: { template: "{{ start.message }}" },
        },
        {
          id: "done",
          kind: "output",
          name: "Done",
          value: {
            kind: "object",
            fields: { urgent: ref("judge", "decision", "/value"), echo: ref("echo", "text") },
          },
        },
      ],
    });
    const run = await startEvaluation(workflowId, versionId, [
      {
        input: { message: "down!" },
        expected: {
          decisions: { judge: { value: true, minConfidence: 0.9 } },
          output: [{ path: "/echo", matcher: { type: "equals", value: "down!" } }],
        },
      },
      {
        input: { message: "hello" },
        expected: { output: [{ path: "/echo", matcher: { type: "contains", value: "hel" } }] },
      },
      { input: { message: "x" }, expected: { decisions: { judge: { value: false } } } },
    ]);
    expect(run.status).toBe("completed");
    expect(run).toMatchObject({ total: 3, completed: 3 });
    expect(run.summary).toMatchObject({ cases: 3, passed: 2, accuracy: { judge: 0.5 } });
    const results = await h.db.app.system((tx) =>
      tx.select().from(evaluationResults).where(eq(evaluationResults.evaluationRunId, run.id)),
    );
    expect(results.filter((r) => !r.passed)[0]?.failures[0]).toMatch(/decision:judge/);
  });

  it("answers human tasks from the case's expectations and applies the gate", async () => {
    const { workflowId, versionId } = await h.deploy("Approve", {
      inputs: { type: "object", properties: { amount: { type: "number" } }, required: ["amount"] },
      outputs: { type: "object", properties: { action: {} } },
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        {
          id: "ok",
          kind: "human",
          name: "Approve",
          mode: { type: "approval" },
          title: { kind: "template", source: "Refund {{ start.amount }}?" },
        },
        {
          id: "done",
          kind: "output",
          name: "Done",
          value: { kind: "object", fields: { action: ref("ok", "decision", "/action") } },
        },
      ],
    });
    const run = await startEvaluation(
      workflowId,
      versionId,
      [
        {
          input: { amount: 5 },
          expected: {
            human: { ok: { action: "reject" } },
            output: [{ path: "/action", matcher: { type: "equals", value: "reject" } }],
            humanExpected: true,
          },
        },
        {
          input: { amount: 9 },
          expected: {
            output: [{ path: "/action", matcher: { type: "equals", value: "approve" } }],
          },
        },
      ],
      { gate: { minPassRate: 0.9 } },
    );
    expect(run.summary).toMatchObject({ cases: 2, passed: 2, humanReviewRate: 1 });
    expect(run.report).toMatchObject({ verdict: "pass", gate: { minPassRate: 0.9 } });
  });
});
