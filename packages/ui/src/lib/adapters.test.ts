import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NodeRunSchema,
  RunEventSchema,
  RunSchema,
  type NodeRun,
  type Run,
  type RunEvent,
  type RunEventOf,
} from "@flowaid/workflow-core";
import type { Span } from "@/types";
import {
  approvalReason,
  foldIterationEvent,
  foldRunEvents,
  humanTaskToApproval,
  routeFromPorts,
  scopeIterations,
  spanToNodeRunView,
  spanToTraceRow,
  toNodeRunView,
  toRunView,
} from "./adapters";

/** `packages/workflow-core/fixtures/events/`, resolved from this test file (vitest reports its absolute path). */
function fixturesDir(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("vitest did not report the test path");
  return join(dirname(testPath), "../../../workflow-core/fixtures/events/");
}
const FIXTURES_DIR = fixturesDir();

/** Every event fixture, Zod-validated, in `seq` order (ephemeral events last). */
function fixtureEvents(): RunEvent[] {
  const events = readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => RunEventSchema.parse(JSON.parse(readFileSync(`${FIXTURES_DIR}${f}`, "utf8"))));
  return events.sort((a, b) => (a.seq === 0 ? 1 : b.seq === 0 ? -1 : a.seq - b.seq));
}

function isType<T extends RunEvent["type"]>(event: RunEvent, type: T): event is RunEventOf<T> {
  return event.type === type;
}

/** The Zod-validated fixture for one event type, narrowed to that member of the union. */
function fixture<T extends RunEvent["type"]>(type: T): RunEventOf<T> {
  const parsed = RunEventSchema.parse(
    JSON.parse(readFileSync(`${FIXTURES_DIR}${type}.json`, "utf8")),
  );
  if (!isType(parsed, type)) throw new Error(`fixture ${type} has type ${parsed.type}`);
  return parsed;
}

describe("small helpers", () => {
  it("parses scope iterations and routes", () => {
    expect(scopeIterations("")).toBeUndefined();
    expect(scopeIterations("loop_x#3")).toEqual([3]);
    expect(scopeIterations("loop_x#3/each_y#0")).toEqual([3, 0]);
    expect(routeFromPorts(["done"])).toBeUndefined();
    expect(routeFromPorts(["review"])).toBe("review");
    expect(routeFromPorts(["done", "billing"])).toBe("billing");
  });
});

describe("toNodeRunView / toRunView", () => {
  const completed = fixture("NODE_COMPLETED");
  const decided = fixture("DECISION_COMPLETED");
  const nodeRun: NodeRun = NodeRunSchema.parse({
    id: completed.nodeRunId,
    runId: completed.runId,
    nodeId: completed.nodeId,
    scope: "",
    attempt: 1,
    status: "completed",
    kind: "task",
    nodeType: "flowaid.decision.choice",
    nodeName: "Intent",
    input: { message: "hi" },
    output: completed.output,
    firedPorts: completed.firedPorts,
    decision: decided.decision,
    error: null,
    usage: completed.usage,
    costUsd: completed.costUsd,
    latencyMs: completed.latencyMs,
    queueLatencyMs: 12,
    idempotencyKey: null,
    inputHash: "sha256:abc",
    reusedFromNodeRunId: null,
    pool: "general",
    scheduledSeq: 2,
    endedSeq: 6,
    startedAt: "2026-09-22T10:00:00.750Z",
    endedAt: "2026-09-22T10:00:01.300Z",
  });

  it("joins the category and keeps the contract fields", () => {
    const view = toNodeRunView(nodeRun, { category: "decision", parentNodeRunId: "parent" });
    expect(view).toMatchObject({
      id: nodeRun.id,
      nodeId: nodeRun.nodeId,
      nodeName: "Intent",
      nodeType: "flowaid.decision.choice",
      category: "decision",
      status: "completed",
      attempt: 1,
      parentNodeRunId: "parent",
      durationMs: completed.latencyMs,
      queueLatencyMs: 12,
      costUsd: completed.costUsd,
      decision: decided.decision,
      firedPorts: completed.firedPorts,
      input: { message: "hi" },
      output: completed.output,
    });
    expect(view.iteration).toBeUndefined();
    expect(view.error).toBeUndefined();
  });

  it("parses the scope into iterations and reads the route from the fired ports", () => {
    const inLoop = { ...nodeRun, scope: "enrich#2", firedPorts: ["billing"] };
    const view = toNodeRunView(inLoop, { category: "decision" });
    expect(view.iteration).toEqual([2]);
    expect(view.routeTaken).toBe("billing");
  });

  it("builds a RunView with the joins and the run's usage and cost", () => {
    const created = fixture("RUN_CREATED");
    const run: Run = RunSchema.parse({
      id: created.runId,
      workspaceId: "0192f0a1-5b3c-7d4e-8f60-00000000aa00",
      workflowId: "0192f0a1-5b3c-7d4e-8f60-00000000aa01",
      workflowVersionId: created.workflowVersionId,
      environmentId: created.environmentId,
      status: "completed",
      origin: created.origin,
      mode: created.mode,
      input: created.input,
      output: { ok: true },
      outcome: "replied",
      error: null,
      parentRunId: null,
      parentNodeRunId: null,
      sourceRunId: null,
      sessionId: null,
      idempotencyKey: null,
      labels: {},
      lastSeq: 20,
      usage: { inputTokens: 100, outputTokens: 10 },
      costUsd: 0.001,
      nodeRunCount: 4,
      createdAt: "2026-09-22T10:00:00.000Z",
      startedAt: "2026-09-22T10:00:00.500Z",
      endedAt: "2026-09-22T10:00:05.000Z",
    });
    const environment = { id: created.environmentId, name: "Production", protected: true };
    const view = toRunView(run, { workflowName: "Support triage", version: 14, environment });
    expect(view).toMatchObject({
      id: run.id,
      workflowName: "Support triage",
      version: 14,
      environment,
      status: "completed",
      origin: created.origin,
      durationMs: 4500,
      usage: { inputTokens: 100, outputTokens: 10 },
      costUsd: 0.001,
      output: { ok: true },
      nodeRuns: [],
    });
    expect(view.error).toBeUndefined();
  });
});

describe("spanToTraceRow", () => {
  const span = (over: Partial<Span>): Span => ({
    id: "s1",
    parentId: null,
    nodeId: "lookup",
    scope: "",
    attempt: 1,
    name: "Lookup",
    kind: "task",
    nodeType: "flowaid.tools.http",
    category: "tool",
    status: "completed",
    startedAt: "2026-09-22T10:00:00.000Z",
    endedAt: "2026-09-22T10:00:00.200Z",
    latencyMs: 200,
    queueLatencyMs: 5,
    costUsd: 0,
    usage: null,
    decision: null,
    firedPorts: ["done"],
    reused: false,
    markers: [],
    children: [],
    ...over,
  });

  it("stacks attempts into one row and keeps the latest on top", () => {
    const first = span({ id: "s1", status: "failed", attempt: 1 });
    const second = span({
      id: "s2",
      attempt: 2,
      startedAt: "2026-09-22T10:00:01.000Z",
      endedAt: "2026-09-22T10:00:01.300Z",
      latencyMs: 300,
      children: ["c1"],
    });
    const row = spanToTraceRow(second, { attempts: [first, second], depth: 1 });
    expect(row.kind).toBe("node");
    expect(row.id).toBe("s2");
    expect(row.depth).toBe(1);
    expect(row.hasChildren).toBe(true);
    expect(row.attempts.map((a) => a.attempt)).toEqual([1, 2]);
    expect(row.nodeRun.durationMs).toBe(300);
    expect(spanToNodeRunView(first).status).toBe("failed");
    expect(spanToNodeRunView(span({ parentId: "p", scope: "enrich#1" }))).toMatchObject({
      parentNodeRunId: "p",
      iteration: [1],
    });
  });
});

describe("humanTaskToApproval", () => {
  const requested = fixture("HUMAN_APPROVAL_REQUESTED");
  const decided = fixture("DECISION_COMPLETED");

  it("carries the HumanRequest through and derives the reason from the origin", () => {
    const view = humanTaskToApproval(
      {
        id: requested.humanTaskId,
        runId: requested.runId,
        nodeId: requested.nodeId,
        request: requested.request,
        createdAt: requested.at,
      },
      { nodeName: "Approve reply", decision: decided.decision, threshold: 0.95 },
    );
    expect(view).toMatchObject({
      id: requested.humanTaskId,
      runId: requested.runId,
      nodeId: requested.nodeId,
      nodeName: "Approve reply",
      request: requested.request,
      requestedAt: requested.at,
      decision: decided.decision,
    });
    expect(view.reason).toBe("Confidence 0.91 is below the pass threshold 0.95");
    expect(approvalReason({ origin: "human_node" }, {})).toBe("This step always asks a person");
    expect(approvalReason({ origin: "task_suspend" }, {})).toBe(
      "The agent needs approval before calling this tool",
    );
    expect(approvalReason({ origin: "decision_failover" }, { decision: decided.decision })).toMatch(
      /^Every decision provider failed/,
    );
    expect(
      humanTaskToApproval(
        { id: "t", runId: "r", nodeId: "n", request: requested.request, createdAt: requested.at },
        { nodeName: "x", reason: "custom" },
      ).reason,
    ).toBe("custom");
  });
});

describe("foldRunEvents", () => {
  const events = fixtureEvents();

  it("folds every Zod-validated fixture without reporting invalid events", () => {
    const folded = foldRunEvents(events, {
      categoryFor: (id) => (id === "intent" ? "decision" : undefined),
      nodeNameFor: (id) => (id === "intent" ? "Intent" : undefined),
    });
    expect(folded.invalid).toEqual([]);
    expect(folded.lastSeq).toBe(Math.max(...events.map((e) => e.seq)));
    const intent = folded.nodeRuns.find((n) => n.nodeId === "intent");
    if (!intent) throw new Error("intent node run missing");
    expect(intent.category).toBe("decision");
    expect(intent.nodeName).toBe("Intent");
    const decided = fixture("DECISION_COMPLETED");
    const decidedRun = folded.nodeRuns.find((n) => n.id === decided.nodeRunId);
    expect(decidedRun?.decision).toEqual(decided.decision);
    expect(decidedRun?.decisionQuestion).toBe(decided.question);
  });

  it("attaches tool calls, logs, human tasks and streams", () => {
    const folded = foldRunEvents(events);
    const called = fixture("TOOL_CALLED");
    const returned = fixture("TOOL_RETURNED");
    const toolRun = folded.nodeRuns.find((n) => n.id === returned.nodeRunId);
    expect(toolRun?.toolCall).toMatchObject({
      name: returned.tool,
      ok: returned.ok,
      durationMs: returned.latencyMs,
    });
    if (called.nodeRunId === returned.nodeRunId)
      expect(toolRun?.toolCall?.args).toEqual(called.args);
    const log = fixture("LOG");
    const logRun = folded.nodeRuns.find((n) => n.id === log.nodeRunId);
    expect(logRun?.logs?.[0]).toMatchObject({ level: log.level, message: log.message });
    const delta = fixture("GENERATION_DELTA");
    if (delta.channel === "text") expect(folded.streams[delta.nodeRunId]).toContain(delta.delta);
  });

  it("reports malformed events by index and keeps folding", () => {
    const folded = foldRunEvents([{ type: "NOPE" }, fixture("RUN_CREATED"), 42]);
    expect(folded.invalid).toEqual([0, 2]);
    expect(folded.status).toBe("queued");
  });

  it("derives the run status from the lifecycle events", () => {
    const waiting = fixture("RUN_WAITING");
    expect(foldRunEvents([waiting]).status).toBe(
      waiting.reason === "human" ? "waiting_for_human" : "waiting",
    );
    expect(foldRunEvents([fixture("RUN_COMPLETED")]).status).toBe("completed");
    expect(foldRunEvents([fixture("RUN_FAILED")]).error?.code).toBe(
      fixture("RUN_FAILED").error.code,
    );
    const completed = fixture("NODE_COMPLETED");
    const reused = foldRunEvents([{ ...completed, reused: true }]);
    expect(reused.nodeRuns[0]?.status).toBe("reused");
  });
});

describe("foldIterationEvent (loop / foreach progress)", () => {
  const started = fixture("LOOP_ITERATION_STARTED");
  const completed = fixture("LOOP_ITERATION_COMPLETED");
  const exited = fixture("LOOP_EXITED");
  const eachStarted = fixture("FOREACH_STARTED");
  const item = fixture("FOREACH_ITEM_COMPLETED");

  it("opens and closes loop iterations from the fixtures", () => {
    const open = foldIterationEvent(undefined, started);
    expect(open).toEqual({
      mode: "loop",
      started: started.iteration + 1,
      completed: 0,
      failed: 0,
      iterations: [{ index: started.iteration, scope: started.childScope, status: "running" }],
    });
    const closed = foldIterationEvent(open, completed);
    expect(closed.completed).toBe(1);
    expect(closed.iterations).toEqual([
      { index: completed.iteration, scope: completed.childScope, status: "completed" },
    ]);
    const second = foldIterationEvent(closed, {
      ...started,
      iteration: 1,
      childScope: "research#1",
    });
    expect([second.started, second.completed]).toEqual([2, 1]);
    const done = foldIterationEvent(second, exited);
    expect(done.exitReason).toBe(exited.reason);
    expect(done.started).toBe(Math.max(2, exited.iterations));
  });

  it("is idempotent for redelivered events and never reopens a finished iteration", () => {
    const once = foldIterationEvent(foldIterationEvent(undefined, started), completed);
    expect(foldIterationEvent(once, completed)).toEqual(once);
    expect(foldIterationEvent(once, started).iterations).toEqual(once.iterations);
  });

  it("marks the running iteration failed when the body fails", () => {
    const failed = foldIterationEvent(foldIterationEvent(undefined, started), {
      ...exited,
      reason: "body_failed",
      iterations: 1,
    });
    expect(failed.failed).toBe(1);
    expect(failed.iterations[0]?.status).toBe("failed");
  });

  it("counts finished foreach items against the item count", () => {
    const begun = foldIterationEvent(undefined, eachStarted);
    expect(begun).toMatchObject({
      mode: "foreach",
      total: eachStarted.itemCount,
      concurrency: eachStarted.concurrency,
      completed: 0,
    });
    const one = foldIterationEvent(begun, item);
    expect(one.completed).toBe(1);
    expect(one.iterations).toEqual([
      { index: item.index, scope: item.childScope, status: item.status },
    ]);
    const two = foldIterationEvent(one, {
      ...item,
      index: 0,
      childScope: "research#0/search_all#0",
      status: "failed",
      error: { code: "TOOL_EXECUTION_ERROR", message: "503", retryable: true },
    });
    expect([two.completed, two.failed]).toEqual([2, 1]);
    expect(two.iterations.map((it) => it.index)).toEqual([0, item.index]);
    expect(foldIterationEvent(two, item)).toEqual(two);
  });

  it("is what foldRunEvents attaches to the loop and foreach node runs", () => {
    const folded = foldRunEvents(fixtureEvents());
    const loopRun = folded.nodeRuns.find((n) => n.id === started.nodeRunId);
    const eachRun = folded.nodeRuns.find((n) => n.id === item.nodeRunId);
    expect(loopRun?.progress).toMatchObject({ mode: "loop", exitReason: exited.reason });
    expect(eachRun?.progress).toMatchObject({
      mode: "foreach",
      total: eachStarted.itemCount,
      completed: 1,
    });
  });
});
