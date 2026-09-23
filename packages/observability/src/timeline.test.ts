import { describe, expect, it } from "vitest";
import type { DecisionResult, RunEvent } from "@flowaid/workflow-core";
import {
  buildTimeline,
  defaultCategory,
  parentOfScope,
  rootSpans,
  type TraceSpan,
} from "./timeline.js";
import { errorInfo, makeNodeRun, makeRun, nodeEvent, uid } from "./test/fixtures.js";

const run = makeRun();
const golden = (name: string, spans: TraceSpan[]) =>
  expect(`${JSON.stringify(spans, null, 2)}\n`).toMatchFileSnapshot(
    `../fixtures/timeline/${name}.json`,
  );

const decision: DecisionResult = {
  kind: "choice",
  value: "billing",
  probabilities: { billing: 0.82, bug: 0.18 },
  confidence: 0.82,
  provider: "typesafe",
  model: "jev-1.13.0",
  latencyMs: 180,
  costUsd: 0.0004,
  attempts: [{ provider: "typesafe", model: "jev-1.13.0", outcome: "ok", latencyMs: 180 }],
};

describe("buildTimeline: nested loop and foreach scopes", () => {
  const nodeRuns = [
    makeNodeRun({ n: 1, nodeId: "input", kind: "input", nodeType: null, seq: 1 }),
    makeNodeRun({
      n: 2,
      nodeId: "research",
      kind: "loop",
      nodeType: null,
      seq: 3,
      endSeq: 40,
      end: 3_900,
    }),
    makeNodeRun({
      n: 3,
      nodeId: "search_all",
      scope: "research#0",
      kind: "foreach",
      nodeType: null,
      seq: 5,
      endSeq: 12,
    }),
    makeNodeRun({
      n: 4,
      nodeId: "fetch",
      scope: "research#0/search_all#0",
      nodeType: "flowaid.tools.http",
      seq: 7,
    }),
    makeNodeRun({
      n: 5,
      nodeId: "fetch",
      scope: "research#0/search_all#1",
      nodeType: "flowaid.tools.http",
      seq: 8,
    }),
    makeNodeRun({
      n: 6,
      nodeId: "search_all",
      scope: "research#1",
      kind: "foreach",
      nodeType: null,
      seq: 20,
      endSeq: 30,
    }),
    makeNodeRun({
      n: 7,
      nodeId: "fetch",
      scope: "research#1/search_all#0",
      nodeType: "flowaid.tools.http",
      seq: 22,
    }),
    makeNodeRun({ n: 8, nodeId: "output", kind: "output", nodeType: null, seq: 41 }),
  ];
  const spans = buildTimeline(run, nodeRuns, []);
  const byId = new Map(spans.map((s) => [s.id, s]));

  it("parents each scope to the container run that owns it", () => {
    expect(byId.get(uid(3))?.parentId).toBe(uid(2));
    expect(byId.get(uid(4))?.parentId).toBe(uid(3));
    expect(byId.get(uid(5))?.parentId).toBe(uid(3));
    expect(byId.get(uid(7))?.parentId).toBe(uid(6));
    expect(byId.get(uid(2))?.children).toEqual([uid(3), uid(6)]);
    expect(rootSpans(spans).map((s) => s.nodeId)).toEqual(["input", "research", "output"]);
  });

  it("matches the golden timeline", async () => {
    await golden("nested-scopes", spans);
  });
});

describe("buildTimeline: retries", () => {
  const nodeRuns = [
    makeNodeRun({
      n: 10,
      nodeId: "call_api",
      nodeType: "flowaid.tools.http",
      status: "failed",
      seq: 2,
      error: errorInfo("PROVIDER_ERROR"),
    }),
    makeNodeRun({
      n: 11,
      nodeId: "call_api",
      attempt: 2,
      nodeType: "flowaid.tools.http",
      status: "failed",
      seq: 6,
      error: errorInfo("PROVIDER_ERROR"),
    }),
    makeNodeRun({ n: 12, nodeId: "call_api", attempt: 3, nodeType: "flowaid.tools.http", seq: 10 }),
    // A retried loop: its body ran under the second attempt.
    makeNodeRun({
      n: 20,
      nodeId: "refine",
      kind: "loop",
      nodeType: null,
      status: "failed",
      seq: 14,
      endSeq: 15,
    }),
    makeNodeRun({
      n: 21,
      nodeId: "refine",
      attempt: 2,
      kind: "loop",
      nodeType: null,
      seq: 17,
      endSeq: 25,
    }),
    makeNodeRun({
      n: 22,
      nodeId: "draft",
      scope: "refine#0",
      nodeType: "flowaid.ai.generate",
      seq: 19,
      costUsd: 0.002,
      usage: { inputTokens: 900, outputTokens: 120 },
    }),
  ];
  const events: RunEvent[] = [
    nodeEvent("TOOL_CALLED", 10, "call_api", 3),
    nodeEvent("NODE_RETRIED", 10, "call_api", 4, {
      error: errorInfo("PROVIDER_ERROR"),
      nextAttempt: 2,
      delayMs: 200,
      timerId: uid(500),
    }),
    nodeEvent("TOOL_CALLED", 11, "call_api", 7, {}, { attempt: 2 }),
    nodeEvent(
      "NODE_RETRIED",
      11,
      "call_api",
      8,
      { error: errorInfo("PROVIDER_ERROR"), nextAttempt: 3, delayMs: 400, timerId: uid(501) },
      { attempt: 2 },
    ),
    nodeEvent("TOOL_CALLED", 12, "call_api", 11, {}, { attempt: 3 }),
    nodeEvent(
      "PROVIDER_FAILOVER",
      22,
      "draft",
      20,
      { from: "openai", to: "anthropic", error: errorInfo("PROVIDER_OVERLOADED") },
      { scope: "refine#0" },
    ),
    nodeEvent(
      "LOG",
      22,
      "draft",
      21,
      { level: "info", message: "drafted", data: null },
      { scope: "refine#0" },
    ),
  ];
  const spans = buildTimeline(run, nodeRuns, events);
  const byId = new Map(spans.map((s) => [s.id, s]));

  it("makes earlier attempts children of the latest attempt", () => {
    expect(byId.get(uid(12))?.parentId).toBeNull();
    expect(byId.get(uid(12))?.children).toEqual([uid(10), uid(11)]);
    expect(byId.get(uid(10))?.parentId).toBe(uid(12));
    expect(byId.get(uid(11))?.parentId).toBe(uid(12));
  });

  it("puts a retried container's body under the latest attempt", () => {
    expect(byId.get(uid(22))?.parentId).toBe(uid(21));
    expect(byId.get(uid(21))?.children).toEqual([uid(20), uid(22)]);
  });

  it("records retry, tool call and failover markers (and not logs)", () => {
    expect(byId.get(uid(10))?.markers.map((m) => m.type)).toEqual(["TOOL_CALLED", "NODE_RETRIED"]);
    expect(byId.get(uid(22))?.markers).toEqual([
      { seq: 20, type: "PROVIDER_FAILOVER", at: expect.any(String) },
    ]);
  });

  it("matches the golden timeline", async () => {
    await golden("retries", spans);
  });
});

describe("buildTimeline: recorded replay", () => {
  const nodeRuns = [
    makeNodeRun({
      n: 30,
      nodeId: "classify",
      nodeType: "flowaid.decision.choice",
      status: "reused",
      reusedFrom: 130,
      seq: 2,
      decision,
      firedPorts: ["billing"],
    }),
    makeNodeRun({
      n: 31,
      nodeId: "lookup",
      nodeType: "flowaid.tools.http",
      status: "reused",
      reusedFrom: 131,
      seq: 4,
    }),
    makeNodeRun({
      n: 32,
      nodeId: "draft",
      nodeType: "flowaid.ai.generate",
      seq: 6,
      costUsd: 0.001,
    }),
  ];
  const spans = buildTimeline(run, nodeRuns, []);

  it("flags reused node runs and keeps their recorded decision", () => {
    expect(spans.map((s) => [s.nodeId, s.reused, s.status])).toEqual([
      ["classify", true, "reused"],
      ["lookup", true, "reused"],
      ["draft", false, "completed"],
    ]);
    expect(spans[0]?.decision?.confidence).toBe(0.82);
    expect(spans[0]?.category).toBe("decision");
  });

  it("matches the golden timeline", async () => {
    await golden("reused", spans);
  });
});

describe("buildTimeline: live runs fold events over a lagging projection", () => {
  const nodeRuns = [
    makeNodeRun({ n: 40, nodeId: "input", kind: "input", nodeType: null, seq: 1 }),
    // Projected while running; the events below finish it.
    makeNodeRun({
      n: 41,
      nodeId: "classify",
      nodeType: "flowaid.decision.choice",
      status: "running",
      seq: 3,
      endSeq: null,
    }),
  ];
  const events: RunEvent[] = [
    nodeEvent("NODE_SCHEDULED", 41, "classify", 3, {
      kind: "task",
      nodeType: "flowaid.decision.choice",
      inputHash: "h",
      idempotencyKey: null,
      reusedFromNodeRunId: null,
      batchId: null,
    }),
    nodeEvent("DECISION_COMPLETED", 41, "classify", 5, {
      batchId: "b",
      question: "route",
      decision,
      priceSnapshot: null,
    }),
    nodeEvent("NODE_COMPLETED", 41, "classify", 6, {
      output: {},
      firedPorts: ["billing"],
      usage: { inputTokens: 300, outputTokens: 4 },
      costUsd: 0.0004,
      latencyMs: 180,
      reused: false,
    }),
    // Only in the log so far.
    nodeEvent("NODE_SCHEDULED", 42, "approve", 7, {
      kind: "human",
      nodeType: "flowaid.human.approval",
      inputHash: "h",
      idempotencyKey: null,
      reusedFromNodeRunId: null,
      batchId: null,
    }),
    nodeEvent("NODE_STARTED", 42, "approve", 8, { input: {}, pool: "general", workerId: "w1" }),
    nodeEvent("NODE_WAITING", 42, "approve", 9, { reason: "human", ref: uid(600), state: null }),
    // Another run's event is ignored.
    {
      ...nodeEvent("NODE_SCHEDULED", 99, "other", 10, {
        kind: "task",
        nodeType: null,
        inputHash: "h",
        idempotencyKey: null,
        reusedFromNodeRunId: null,
        batchId: null,
      }),
      runId: uid(77),
    },
  ];
  const spans = buildTimeline(run, nodeRuns, events);
  const byId = new Map(spans.map((s) => [s.id, s]));

  it("completes the projected row from its events", () => {
    const classify = byId.get(uid(41));
    expect(classify).toMatchObject({
      status: "completed",
      latencyMs: 180,
      costUsd: 0.0004,
      firedPorts: ["billing"],
    });
    expect(classify?.decision?.kind).toBe("choice");
  });

  it("builds event-only node runs, with queue latency and a wait marker", () => {
    const approve = byId.get(uid(42));
    expect(approve).toMatchObject({
      status: "waiting",
      category: "human",
      queueLatencyMs: 100,
      startedAt: expect.any(String),
      endedAt: null,
    });
    expect(approve?.markers.map((m) => m.type)).toEqual(["NODE_WAITING"]);
    expect(byId.has(uid(99))).toBe(false);
  });

  it("is idempotent: folding the same events again gives the same spans", () => {
    expect(buildTimeline(run, nodeRuns, [...events, ...events])).toEqual(
      buildTimeline(run, nodeRuns, events).map((s) => ({ ...s, markers: expect.any(Array) })),
    );
  });

  it("matches the golden timeline", async () => {
    await golden("live", spans);
  });
});

describe("timeline helpers", () => {
  it("splits scope paths", () => {
    expect(parentOfScope("")).toBeNull();
    expect(parentOfScope("research#0")).toEqual({ scope: "", container: "research" });
    expect(parentOfScope("a#0/b_c#12")).toEqual({ scope: "a#0", container: "b_c" });
  });

  it.each([
    ["loop", null, "flow"],
    ["human", "flowaid.human.approval", "human"],
    ["task", "flowaid.decision.choice", "decision"],
    ["task", "flowaid.jev.decide", "decision"],
    ["task", "flowaid.ai.generate", "generation"],
    ["task", "flowaid.agent.react", "agent"],
    ["task", "flowaid.tools.mcp", "tool"],
    ["task", "flowaid.data.transform", "data"],
    ["task", "flowaid.retrieval.search", "retrieval"],
    ["task", "flowaid.state.set", "state"],
    ["task", "flowaid.safety.pii", "safety"],
    ["task", "acme.custom.thing", "developer"],
  ] as const)("defaultCategory(%s, %s) = %s", (kind, type, category) => {
    expect(defaultCategory(kind, type)).toBe(category);
  });

  it("uses names and categories from the plan when given", () => {
    const spans = buildTimeline(run, [makeNodeRun({ n: 50, nodeId: "x", seq: 1 })], [], {
      describe: () => ({ name: "Extract fields", category: "data" }),
    });
    expect(spans[0]).toMatchObject({ name: "Extract fields", category: "data" });
  });
});

describe("buildTimeline: every live status transition", () => {
  const scheduled = (n: number, nodeId: string, seq: number, attempt = 1) =>
    nodeEvent(
      "NODE_SCHEDULED",
      n,
      nodeId,
      seq,
      {
        kind: "task",
        nodeType: "flowaid.tools.http",
        inputHash: "h",
        idempotencyKey: null,
        reusedFromNodeRunId: null,
        batchId: null,
      },
      { attempt },
    );
  const started = (n: number, nodeId: string, seq: number, attempt = 1) =>
    nodeEvent(
      "NODE_STARTED",
      n,
      nodeId,
      seq,
      { input: {}, pool: "general", workerId: "w" },
      { attempt },
    );
  const events: RunEvent[] = [
    scheduled(60, "skipped", 1),
    nodeEvent("NODE_SKIPPED", 60, "skipped", 2, { reason: "pruned" }),
    scheduled(61, "cancelled", 3),
    started(61, "cancelled", 4),
    nodeEvent("NODE_CANCELLED", 61, "cancelled", 5, { reason: "run_cancelled" }),
    scheduled(62, "flaky", 6),
    started(62, "flaky", 7),
    nodeEvent("NODE_FAILED", 62, "flaky", 8, {
      error: errorInfo("NETWORK_ERROR"),
      firedPorts: [],
      latencyMs: 12,
      terminal: false,
    }),
    nodeEvent("NODE_RETRIED", 62, "flaky", 9, {
      error: errorInfo("NETWORK_ERROR"),
      nextAttempt: 2,
      delayMs: 100,
      timerId: uid(800),
    }),
    scheduled(63, "flaky", 10, 2),
    started(63, "flaky", 11, 2),
    nodeEvent(
      "NODE_FAILED",
      63,
      "flaky",
      12,
      { error: errorInfo("NETWORK_ERROR"), firedPorts: ["error"], latencyMs: 9, terminal: true },
      { attempt: 2 },
    ),
    scheduled(64, "gate", 13),
    started(64, "gate", 14),
    nodeEvent("NODE_WAITING", 64, "gate", 15, { reason: "human", ref: uid(801), state: null }),
    nodeEvent("HUMAN_APPROVAL_RECEIVED", 64, "gate", 16, {
      humanTaskId: uid(801),
      response: { action: "approve" },
      by: "u",
    }),
    scheduled(65, "retrying", 17),
    started(65, "retrying", 18),
    nodeEvent("NODE_RETRIED", 65, "retrying", 19, {
      error: errorInfo("NETWORK_ERROR"),
      nextAttempt: 2,
      delayMs: 100,
      timerId: uid(802),
    }),
    // Events for a node run the timeline never saw scheduled are ignored.
    started(66, "ghost", 20),
  ];
  const spans = buildTimeline(run, [], events);
  const status = Object.fromEntries(spans.map((s) => [`${s.nodeId}#${s.attempt}`, s.status]));

  it("folds each terminal and waiting state", () => {
    expect(status).toEqual({
      "skipped#1": "skipped",
      "cancelled#1": "cancelled",
      "flaky#1": "failed",
      "flaky#2": "failed",
      "gate#1": "running",
      "retrying#1": "retry_wait",
    });
    const cancelled = spans.find((s) => s.nodeId === "cancelled");
    expect(cancelled?.latencyMs).toBe(100);
    expect(spans.find((s) => s.nodeId === "flaky" && s.attempt === 2)?.firedPorts).toEqual([
      "error",
    ]);
  });
});
