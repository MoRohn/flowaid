import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PgQueueDriver, createDatabase, type Database } from "@flowaid/database";
import { describeDb } from "@flowaid/database/testing";
import type { JsonObject, SandboxExecutor } from "@flowaid/workflow-core";
import { createPoolWorker, type PoolWorker } from "./poolWorker.js";
import { createHarness, type Harness } from "./test/setup.js";

/** Runs the code as "sum the inputs' numbers" — the delegation mechanics, not isolated-vm. */
function fakeSandbox(hosts: string[]): SandboxExecutor {
  return {
    kind: "isolated-vm",
    run: (req) => {
      hosts.push(`pid:${process.pid}`);
      const values = Object.values(req.inputs).filter((v): v is number => typeof v === "number");
      return Promise.resolve({
        output: { total: values.reduce((a, b) => a + b, 0) },
        logs: [{ level: "info", message: "summed" }],
        durationMs: 1,
      });
    },
  };
}

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

const codeWorkflow = {
  inputs: {
    type: "object",
    properties: { a: { type: "number" }, b: { type: "number" } },
    required: ["a", "b"],
  },
  outputs: { type: "object", properties: { total: { type: "number" } } },
  nodes: [
    { id: "start", kind: "input", name: "Start" },
    {
      id: "adder",
      kind: "task",
      name: "Sum",
      type: "flowaid.tools.code",
      typeVersion: "1.0.0",
      config: {
        language: "javascript",
        code: "return { total: inputs.a + inputs.b };",
        inputs: {
          type: "object",
          properties: { a: { type: "number" }, b: { type: "number" } },
        },
        output: { type: "object", properties: { total: { type: "number" } } },
      },
      inputs: {
        inputs: {
          kind: "object",
          fields: {
            a: { kind: "ref", ref: { kind: "port", node: "start", port: "a" } },
            b: { kind: "ref", ref: { kind: "port", node: "start", port: "b" } },
          },
        },
      },
    },
    {
      id: "end",
      kind: "output",
      name: "End",
      value: {
        kind: "object",
        fields: {
          total: {
            kind: "ref",
            ref: { kind: "port", node: "adder", port: "result", path: "/total" },
            default: 0,
          },
        },
      },
    },
  ],
  edges: [
    { id: "e1", from: { node: "start", port: "done" }, to: { node: "adder" } },
    { id: "e2", from: { node: "adder", port: "done" }, to: { node: "end" } },
  ],
};

describeDb("delegated code pool (Postgres)", () => {
  let h: Harness;
  let code: Database;
  let codeQueue: PgQueueDriver;
  let sandboxHost: PoolWorker;
  const executedOn: string[] = [];
  beforeAll(async () => {
    // The orchestrating worker serves only `general`: code nodes leave it.
    h = await createHarness({ pools: ["general"] });
    // The sandbox host connects as the restricted flowaid_code role.
    code = createDatabase({ url: h.db.codeUrl, max: 4, applicationName: "flowaid-test-code" });
    codeQueue = new PgQueueDriver(code.sql, { pollMs: 25 });
    sandboxHost = createPoolWorker({
      db: code,
      queue: codeQueue,
      pools: ["code"],
      http: () => Promise.reject(new Error("no network in this test")),
      sandbox: fakeSandbox(executedOn),
      log: silent,
    });
    await sandboxHost.start();
  });
  afterAll(async () => {
    await sandboxHost.stop();
    await codeQueue.close();
    await code.close();
    await h.worker.stop();
    await h.queue.close();
    await h.db.drop();
  });

  it("runs a code node on the code pool's worker and resumes the run with its result", async () => {
    const { workflowId, versionId } = await h.deploy("Delegated sum", codeWorkflow);
    const runId = await h.start(workflowId, versionId, { a: 2, b: 40 });
    const run = await h.waitFor(runId, ["completed", "failed"], 20_000);
    expect(run.error).toBeNull();
    expect(run.status).toBe("completed");
    expect(run.output).toEqual({ total: 42 });
    expect(executedOn).toHaveLength(1);
    const events = await h.store.listEvents(runId, 0, 200);
    expect(events.map((e) => e.type)).toContain("NODE_DELEGATED");
    // the handoff row is removed once the run handled the result (just after that step)
    await expect
      .poll(async () => {
        const left = await h.db.app.system((tx) =>
          tx.execute(sql`select count(*)::int as n from delegated_nodes`),
        );
        return (left as unknown as { n: number }[])[0]?.n;
      })
      .toBe(0);
  });

  it("gives the sandbox role no table access beyond the queue", async () => {
    await expect(code.sql`select * from delegated_nodes`).rejects.toThrow(/permission denied/);
    await expect(code.sql`select * from runs`).rejects.toThrow(/permission denied/);
    await expect(code.sql`select * from credentials`).rejects.toThrow(/permission denied/);
    // claiming a node run that was never delegated returns nothing
    const rows = await code.sql<{ c: JsonObject | null }[]>`
      select flowaid_delegated_claim('00000000-0000-0000-0000-000000000001'::uuid, 'code', 'w') as c`;
    expect(rows[0]?.c).toBeNull();
  });
});
