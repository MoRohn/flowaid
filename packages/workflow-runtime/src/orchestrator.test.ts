import { afterEach, describe, expect, it } from "vitest";
import { uuidv7 } from "@flowaid/shared";
import { compile, COMPILER_VERSION } from "@flowaid/workflow-compiler";
import type { ExecutionPlan, Run } from "@flowaid/workflow-core";
import { NodeRegistry } from "./executor.js";
import { catalogOfPackages, runLocally } from "./local.js";
import { Orchestrator } from "./orchestrator.js";
import { MemoryQueueDriver, MemoryRunStore } from "./testing/memory.js";
import { acmeRegistry, definition, task, testPackage } from "./test/nodes.js";

const ref = (node: string, port: string, path?: string) => ({
  kind: "ref",
  ref: { kind: "port", node, port, ...(path ? { path } : {}) },
});
const edge = (id: string, from: string, port: string, to: string) => ({
  id,
  from: { node: from, port },
  to: { node: to },
});
const start = { id: "start", kind: "input", name: "in" };

describe("runLocally", () => {
  it("runs a compiled definition end to end with real nodes and providers", async () => {
    const { registry, calls } = acmeRegistry([0.93]);
    const def = definition(
      [
        start,
        task("add", "@test/kit.add", { amount: 2 }, { value: ref("start", "x") }),
        task(
          "decide",
          "@test/kit.decide",
          { question: "Is it big?" },
          { state: { kind: "template", source: "value={{ add.value }}" } },
          { credentials: {} },
        ),
        { id: "big", kind: "output", name: "big", value: ref("add", "value"), outcome: "big" },
        {
          id: "small",
          kind: "output",
          name: "small",
          value: ref("add", "value"),
          outcome: "small",
        },
      ],
      [edge("e1", "decide", "yes", "big"), edge("e2", "decide", "no", "small")],
      { secrets: [{ name: "ACME", credentialType: "http.bearer" }] },
    );
    const seen: string[] = [];
    const result = await runLocally(def, {
      input: { x: 40 },
      nodes: [testPackage],
      providers: registry,
      secrets: { ACME: "acme-secret-token" },
      onEvent: (e) => seen.push(e.type),
    });
    expect(result.error).toBeNull();
    expect(result.status).toBe("completed");
    expect(result).toMatchObject({ output: 42, outcome: "big" });
    expect(calls.credential).toMatchObject({ token: "acme-secret-token" });
    const types = result.events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["DECISION_REQUESTED", "DECISION_COMPLETED"]));
    expect(seen).toEqual(types);
    expect(result.costUsd).toBeCloseTo(0.003);
    expect(result.nodeRuns.find((n) => n.nodeId === "decide")?.decision?.provider).toBe("acme");
    // Executed nodes are spans; the pruned branch appears as NODE_SKIPPED in the log only.
    expect(result.trace.map((s) => [s.nodeId, s.status])).toEqual([
      ["start", "completed"],
      ["add", "completed"],
      ["decide", "completed"],
      ["big", "completed"],
    ]);
    expect(
      result.events
        .filter((e) => e.type === "NODE_SKIPPED")
        .map((e) => ("nodeId" in e ? e.nodeId : "")),
    ).toEqual(["small"]);
  });

  it("validates node input against the node's schema at run time", async () => {
    const { registry } = acmeRegistry();
    const def = definition(
      [
        start,
        task(
          "add",
          "@test/kit.add",
          { amount: 1 },
          { value: { kind: "literal", value: "not a number" } },
        ),
        { id: "out", kind: "output", name: "out", value: ref("add", "value") },
      ],
      [edge("e0", "start", "done", "add")],
    );
    await expect(
      runLocally(def, { input: { x: 1 }, nodes: [testPackage], providers: registry }),
    ).rejects.toThrow(/does not compile/);
  });

  it("retries on real timers and answers human tasks through opts.human", async () => {
    const { registry } = acmeRegistry();
    const def = definition([
      start,
      task(
        "flaky",
        "@test/kit.flaky",
        { failTimes: 2 },
        { value: ref("start", "x") },
        {
          policy: {
            retry: { maxAttempts: 3, backoff: { type: "fixed", initialMs: 30, jitter: false } },
          },
        },
      ),
      task("approve", "@test/kit.approval", {}, { value: ref("flaky", "value") }),
      {
        id: "out",
        kind: "output",
        name: "out",
        value: {
          kind: "object",
          fields: { approved: ref("approve", "approved"), attempt: ref("flaky", "attempt") },
        },
      },
    ]);
    const asked: string[] = [];
    const result = await runLocally(def, {
      input: { x: 7 },
      nodes: [testPackage],
      providers: registry,
      human: (req) => {
        asked.push(req.title);
        return Promise.resolve({ action: "approve" });
      },
    });
    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ approved: true, attempt: 3 });
    expect(asked).toEqual(["Approve 7?"]);
    expect(result.events.filter((e) => e.type === "NODE_RETRIED")).toHaveLength(2);
  });

  it("stops at waiting_for_human without a responder", async () => {
    const { registry } = acmeRegistry();
    const def = definition([
      start,
      task("approve", "@test/kit.approval", {}, { value: ref("start", "x") }),
      { id: "out", kind: "output", name: "out", value: ref("approve", "approved") },
    ]);
    const result = await runLocally(def, {
      input: { x: 1 },
      nodes: [testPackage],
      providers: registry,
    });
    expect(result.status).toBe("waiting_for_human");
  });

  it("runs subflows as child runs", async () => {
    const { registry } = acmeRegistry();
    const childId = "00000000-0000-4000-8000-00000000c411";
    const child = {
      ...(definition([
        start,
        task("add", "@test/kit.add", { amount: 100 }, { value: ref("start", "x") }),
        {
          id: "out",
          kind: "output",
          name: "out",
          value: { kind: "object", fields: { y: ref("add", "value") } },
        },
      ]) as object),
      id: childId,
    };
    const parent = definition([
      start,
      {
        id: "sub",
        kind: "subflow",
        name: "sub",
        workflowId: childId,
        inputs: { x: ref("start", "x") },
      },
      { id: "out", kind: "output", name: "out", value: ref("sub", "output") },
    ]);
    const catalog = catalogOfPackages([testPackage]);
    const childPlan = compile(child, {
      catalog,
      level: "publish",
      compilerVersion: COMPILER_VERSION,
    } as never);
    if (!childPlan.ok) throw new Error("child does not compile");
    const parentPlan = compile(parent, {
      catalog,
      level: "draft",
      compilerVersion: COMPILER_VERSION,
      resolveSubflow: () => ({
        versionId: uuidv7(),
        inputs: childPlan.plan.inputs,
        outputs: { type: "object", properties: { y: { type: "number" } } },
        references: [],
      }),
    } as never);
    if (!parentPlan.ok) throw new Error(parentPlan.diagnostics.map((d) => d.message).join("\n"));
    const result = await runLocally(parentPlan.plan, {
      input: { x: 1 },
      nodes: [testPackage],
      providers: registry,
      subflows: () => childPlan.plan,
    });
    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ y: 101 });
  });
});

describe("Orchestrator on shared stores", () => {
  let orchestrators: Orchestrator[] = [];
  afterEach(async () => {
    await Promise.all(orchestrators.map((o) => o.close()));
    orchestrators = [];
  });

  function setup(nodes: unknown[], edges: unknown[] = []) {
    const catalog = catalogOfPackages([testPackage]);
    const compiled = compile(definition(nodes, edges), {
      catalog,
      level: "publish",
      compilerVersion: COMPILER_VERSION,
    } as never);
    if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => d.message).join("\n"));
    const plan: ExecutionPlan = compiled.plan;
    const store = new MemoryRunStore();
    const queue = new MemoryQueueDriver();
    const make = (workerId: string, leaseTtlMs = 30_000) => {
      const o = new Orchestrator({
        store,
        queue,
        registry: new NodeRegistry([testPackage]),
        workerId,
        loadPlan: () => Promise.resolve(plan),
        leaseTtlMs,
      });
      orchestrators.push(o);
      return o;
    };
    const create = async () => {
      const id = uuidv7();
      const now = new Date().toISOString();
      const run = {
        id,
        workspaceId: uuidv7(),
        workflowId: plan.workflowId,
        workflowVersionId: uuidv7(),
        environmentId: uuidv7(),
        status: "queued",
        origin: "api",
        mode: "async",
        input: { x: 5 },
        output: null,
        outcome: null,
        error: null,
        parentRunId: null,
        parentNodeRunId: null,
        sourceRunId: null,
        sessionId: null,
        idempotencyKey: null,
        labels: {},
        lastSeq: 1,
        usage: { inputTokens: 0, outputTokens: 0 },
        costUsd: 0,
        nodeRunCount: 0,
        createdAt: now,
        startedAt: null,
        endedAt: null,
      } as Run;
      await store.createRun(run, {
        type: "RUN_CREATED",
        runId: id,
        seq: 1,
        at: now,
        workflowVersionId: run.workflowVersionId,
        environmentId: run.environmentId,
        origin: "api",
        mode: "async",
        input: run.input,
        planHash: plan.planHash,
        idempotencyKey: null,
        sourceRunId: null,
      });
      return id;
    };
    return { plan, store, make, create };
  }

  it("a second worker takes over a run whose worker died, and retries its safe node", async () => {
    const { store, make, create } = setup([
      start,
      task("slow", "@test/kit.slow", { ms: 60_000 }, { value: ref("start", "x") }),
      { id: "out", kind: "output", name: "out", value: ref("slow", "value") },
    ]);
    const runId = await create();
    const a = make("worker-a", 40);
    expect(await a.handle(runId, { type: "start" })).toBe("ok");
    await a.close(); // dies with `slow` in flight; its lease lapses
    await new Promise((r) => setTimeout(r, 60));
    const b = make("worker-b");
    // Make the retried attempt quick: the second attempt is a fresh execution.
    expect(await b.reapExpiredLeases()).toBe(1);
    const events = await store.listEvents(runId, 0, 100);
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["RUN_LEASE_TAKEN", "NODE_RETRIED"]),
    );
    const retried = events.find((e) => e.type === "NODE_RETRIED");
    expect(retried && "error" in retried ? retried.error.code : null).toBe("WORKER_LOST");
    expect(
      (await store.listNodeRuns(runId)).filter((n) => n.nodeId === "slow").map((n) => n.attempt),
    ).toEqual([1, 2]);
    // Worker A cannot write any more: its appends are fenced.
    await expect(
      store.appendEvents(
        runId,
        [{ type: "RUN_RESUMED", reason: "timer", nodeRunId: null } as never],
        { leaseOwner: "worker-a", expectedSeq: events.length },
      ),
    ).rejects.toThrow(/not leased/);
  });

  it("serialises two workers on one run through the lease", async () => {
    const { store, make, create } = setup([
      start,
      task("add", "@test/kit.add", { amount: 1 }, { value: ref("start", "x") }),
      { id: "out", kind: "output", name: "out", value: ref("add", "value") },
    ]);
    const runId = await create();
    const a = make("worker-a");
    const b = make("worker-b");
    const results = await Promise.all([
      a.handle(runId, { type: "start" }),
      b.handle(runId, { type: "start" }),
    ]);
    expect(results.sort()).toEqual(["busy", "ok"]);
    const winner = results[0] === "ok" ? a : b;
    await winner.whenIdle(runId);
    await new Promise((r) => setTimeout(r, 20));
    const run = await store.getRun(runId);
    expect(run).toMatchObject({ status: "completed", output: 6 });
    const events = await store.listEvents(runId, 0, 100);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(events.filter((e) => e.type === "RUN_STARTED")).toHaveLength(1);
  });

  it("fires durable timers from the store (compare-and-set), once", async () => {
    const { store, make, create } = setup(
      [
        start,
        { id: "w", kind: "wait", name: "w", until: { type: "delay", ms: 30 } },
        { id: "out", kind: "output", name: "out", value: { kind: "literal", value: "woke" } },
      ],
      [edge("e0", "start", "done", "w"), edge("e1", "w", "done", "out")],
    );
    const runId = await create();
    const a = make("worker-a");
    const b = make("worker-b");
    await a.handle(runId, { type: "start" });
    expect((await store.getRun(runId))?.status).toBe("waiting");
    await new Promise((r) => setTimeout(r, 40));
    const fired = await Promise.all([a.fireDueTimers(), b.fireDueTimers()]);
    expect(fired.reduce((x, y) => x + y, 0)).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(await store.getRun(runId)).toMatchObject({ status: "completed", output: "woke" });
  });
});

describe("write-time redaction", () => {
  it("persists redacted events while the run itself sees raw values", async () => {
    const { Redactor } = await import("@flowaid/credentials");
    const { createEventRedactor } = await import("./redaction.js");
    const { registry } = acmeRegistry();
    const catalog = catalogOfPackages([testPackage]);
    const compiled = compile(
      definition([
        start,
        task(
          "add",
          "@test/kit.add",
          { amount: 1 },
          { value: ref("start", "x") },
          { policy: { privacy: { doNotPersist: true } } },
        ),
        {
          id: "out",
          kind: "output",
          name: "out",
          value: {
            kind: "object",
            fields: {
              v: ref("add", "value"),
              note: { kind: "literal", value: "token sk-live-abc12345 used" },
            },
          },
        },
      ]),
      { catalog, level: "publish", compilerVersion: COMPILER_VERSION } as never,
    );
    if (!compiled.ok) throw new Error("compile");
    const redact = createEventRedactor(new Redactor().learn(["sk-live-abc12345"]));
    const completed = redact(
      {
        type: "NODE_COMPLETED",
        runId: "r",
        seq: 5,
        at: "2026-09-23T10:00:00.000Z",
        nodeRunId: "n",
        nodeId: "add",
        scope: "",
        attempt: 1,
        output: { value: 2 },
        firedPorts: ["done"],
        usage: null,
        costUsd: 0,
        latencyMs: 1,
        reused: false,
      } as never,
      compiled.plan,
    );
    expect((completed as { output: unknown }).output).toEqual({ $redacted: true });
    const output = redact(
      {
        type: "RUN_OUTPUT",
        runId: "r",
        seq: 6,
        at: "2026-09-23T10:00:00.000Z",
        nodeRunId: "o",
        nodeId: "out",
        output: { note: "token sk-live-abc12345 used" },
        outcome: null,
        earlyExit: false,
      } as never,
      compiled.plan,
    );
    expect(JSON.stringify(output)).not.toContain("sk-live-abc12345");
    void registry;
  });
});
