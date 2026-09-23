import { describe, expect, it, vi } from "vitest";
import { Redactor } from "@flowaid/credentials";
import type {
  BooleanDecision,
  ChoiceDecision,
  DecisionKind,
  DecisionProvider,
  Run,
  RunEvent,
} from "@flowaid/workflow-core";
import {
  REVIEW_VERDICTS,
  TraceReviewer,
  shouldReview,
  type TraceReviewInput,
} from "./traceReviewer.js";
import { errorInfo, makeNodeRun, makeRun, nodeEvent, uid } from "./test/fixtures.js";

const base = {
  provider: "typesafe",
  model: "jev-1.13.0",
  latencyMs: 90,
  costUsd: 0.0003,
  attempts: [],
};
const choice = (value: string, confidence = 0.8): ChoiceDecision => ({
  ...base,
  kind: "choice",
  value,
  confidence,
  probabilities: { [value]: confidence },
});
const bool = (value: boolean): BooleanDecision => ({
  ...base,
  kind: "boolean",
  value,
  pYes: value ? 0.8 : 0.2,
  confidence: 0.8,
  probabilities: { true: value ? 0.8 : 0.2, false: value ? 0.2 : 0.8 },
});

function fakeProvider(verdict: string, wrong: boolean, batch = false) {
  const provider = {
    id: "typesafe",
    model: "jev-1.13.0",
    capabilities: {
      kinds: ["boolean", "choice", "score"] as DecisionKind[],
      batch,
      maxQuestions: batch ? 16 : 1,
      maxStateTokens: 32_000,
      text: true,
      images: false,
    },
    decideChoice: vi.fn(() => Promise.resolve(choice(verdict))),
    decideBoolean: vi.fn(() => Promise.resolve(bool(wrong))),
    health: () => ({
      status: "healthy" as const,
      errorRate1m: 0,
      p95LatencyMs: 90,
      consecutiveFailures: 0,
      checkedAt: "2026-09-23T12:00:00.000Z",
    }),
    decideScore: vi.fn(() => Promise.reject(new Error("unused"))),
    batch: vi.fn(() =>
      Promise.resolve({
        answers: { verdict: choice(verdict), wrong: bool(wrong) },
        usage: { inputTokens: 500, outputTokens: 2 },
        model: "jev-1.13.0",
        requestId: "req-1",
        latencyMs: 90,
      }),
    ),
  };
  return provider satisfies DecisionProvider;
}

const now = () => new Date("2026-09-23T12:00:00.000Z");

function input(run: Partial<Run>, extra: Partial<TraceReviewInput> = {}): TraceReviewInput {
  return { run: makeRun(run), nodeRuns: [], events: [], ...extra };
}

describe("TraceReviewer short-circuits", () => {
  const interruptedNode = makeNodeRun({
    n: 3,
    nodeId: "charge",
    status: "failed",
    seq: 2,
    error: errorInfo("NONIDEMPOTENT_INTERRUPTED"),
  });
  const interruptedEvent = nodeEvent("NODE_FAILED", 3, "charge", 4, {
    error: errorInfo("NONIDEMPOTENT_INTERRUPTED"),
    firedPorts: [],
    latencyMs: 0,
    terminal: true,
  });

  it.each([
    [
      "failed with BOUNDS_EXCEEDED",
      input({ status: "failed", error: errorInfo("BOUNDS_EXCEEDED") }),
      "FILE_BUG",
      "bounds_exceeded",
      true,
    ],
    [
      "a node run interrupted non-idempotently",
      input(
        { status: "failed", error: errorInfo("NODE_EXECUTION_ERROR") },
        { nodeRuns: [interruptedNode] },
      ),
      "PRIORITY_REVIEW",
      "nonidempotent_interrupted",
      false,
    ],
    [
      "an interruption only in the event log",
      input({ status: "completed" }, { events: [interruptedEvent] }),
      "PRIORITY_REVIEW",
      "nonidempotent_interrupted",
      false,
    ],
    [
      "an interruption as the cause of the run error",
      input({
        status: "failed",
        error: {
          ...errorInfo("NODE_EXECUTION_ERROR"),
          cause: errorInfo("NONIDEMPOTENT_INTERRUPTED"),
        },
      }),
      "PRIORITY_REVIEW",
      "nonidempotent_interrupted",
      false,
    ],
    ["cancelled", input({ status: "cancelled" }), "NO_ACTION", "cancelled", false],
    [
      "cancelled after a non-idempotent interruption",
      input({ status: "cancelled" }, { nodeRuns: [interruptedNode] }),
      "PRIORITY_REVIEW",
      "nonidempotent_interrupted",
      false,
    ],
  ] as const)("%s → %s", async (_label, review, verdict, rule, alert) => {
    const provider = fakeProvider("NO_ACTION", false);
    const result = await new TraceReviewer({ provider, now }).review(review);
    expect(result).toMatchObject({
      verdict,
      rule,
      alert,
      source: "rule",
      likelyWrongOutcome: null,
      costUsd: 0,
    });
    expect(provider.decideChoice).not.toHaveBeenCalled();
    expect(provider.batch).not.toHaveBeenCalled();
  });

  it("does not short-circuit BOUNDS_EXCEEDED on a node that was routed around", () => {
    const reviewer = new TraceReviewer({ provider: fakeProvider("NO_ACTION", false) });
    const nodeRuns = [
      makeNodeRun({
        n: 1,
        nodeId: "loop",
        status: "failed",
        seq: 1,
        error: errorInfo("BOUNDS_EXCEEDED"),
      }),
    ];
    expect(
      reviewer.shortCircuit({ run: makeRun({ status: "completed" }), nodeRuns, events: [] }),
    ).toBeNull();
  });
});

describe("TraceReviewer judged by a provider", () => {
  const nodeRuns = [
    makeNodeRun({
      n: 1,
      nodeId: "classify",
      nodeType: "flowaid.decision.choice",
      seq: 1,
      decision: choice("billing", 0.41),
    }),
    makeNodeRun({
      n: 2,
      nodeId: "confident",
      nodeType: "flowaid.decision.choice",
      seq: 3,
      decision: choice("bug", 0.97),
    }),
    makeNodeRun({
      n: 3,
      nodeId: "fetch",
      status: "failed",
      seq: 5,
      error: errorInfo(
        "TOOL_EXECUTION_ERROR",
        "GET https://api.example.com?key=sk-live-SECRET-123 failed",
      ),
    }),
  ];
  const events: RunEvent[] = [
    nodeEvent("NODE_RETRIED", 3, "fetch", 6, {
      error: errorInfo("NETWORK_ERROR"),
      nextAttempt: 2,
      delayMs: 100,
      timerId: uid(500),
    }),
    nodeEvent("PROVIDER_FAILOVER", 1, "classify", 2, {
      from: "typesafe",
      to: "llm",
      error: errorInfo("PROVIDER_OVERLOADED"),
    }),
    nodeEvent("HUMAN_APPROVAL_RECEIVED", 4, "approve", 8, {
      humanTaskId: uid(700),
      response: { action: "reject", comment: "wrong route" },
      by: "u1",
    }),
    nodeEvent("HUMAN_APPROVAL_RECEIVED", 5, "approve2", 9, {
      humanTaskId: uid(701),
      response: { action: "approve" },
      by: "u1",
    }),
    nodeEvent("TOOL_RETURNED", 3, "fetch", 7, {
      toolCallId: "c1",
      tool: "http_get",
      ok: false,
      result: null,
      error: errorInfo("TOOL_EXECUTION_ERROR"),
      latencyMs: 30,
    }),
  ];
  const review = input(
    {
      status: "failed",
      error: errorInfo("NODE_EXECUTION_ERROR"),
      costUsd: 0.05,
      usage: { inputTokens: 1000, outputTokens: 200 },
    },
    { nodeRuns, events, baseline: { p95DurationMs: 5_000, p95CostUsd: 0.02 } },
  );

  it("asks one choice and one boolean question and stores the verdict", async () => {
    const provider = fakeProvider("PRIORITY_REVIEW", true);
    const result = await new TraceReviewer({ provider, now }).review(review);
    expect(result).toMatchObject({
      runId: review.run.id,
      verdict: "PRIORITY_REVIEW",
      likelyWrongOutcome: true,
      source: "provider",
      alert: false,
      confidence: 0.8,
      provider: "typesafe",
      reviewedAt: "2026-09-23T12:00:00.000Z",
    });
    expect(result.costUsd).toBeCloseTo(0.0006);
    const [state, question, ctx] = provider.decideChoice.mock.calls[0] as unknown as [
      unknown,
      { options: Record<string, string> },
      { idempotencyKey: string },
    ];
    expect(Object.keys(question.options)).toEqual([...REVIEW_VERDICTS]);
    expect(ctx.idempotencyKey).toBe(`trace-review:${review.run.id}`);
    expect(state).toBe(result.summary);
  });

  it("batches both questions when the provider batches", async () => {
    const provider = fakeProvider("PAGE_ON_CALL", false, true);
    const result = await new TraceReviewer({ provider }).review(review);
    expect(provider.batch).toHaveBeenCalledOnce();
    expect(provider.decideChoice).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      verdict: "PAGE_ON_CALL",
      alert: true,
      likelyWrongOutcome: false,
    });
  });

  it("falls back to REVIEW when the provider answers something else", async () => {
    const result = await new TraceReviewer({ provider: fakeProvider("SHRUG", false) }).review(
      review,
    );
    expect(result.verdict).toBe("REVIEW");
    expect(result.reason).toContain("'SHRUG'");
  });

  it("rejects batch answers of the wrong kind", async () => {
    const provider = fakeProvider("REVIEW", false, true);
    provider.batch.mockResolvedValueOnce({
      answers: { verdict: bool(true), wrong: bool(true) } as never,
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "m",
      requestId: "req-2",
      latencyMs: 1,
    });
    await expect(new TraceReviewer({ provider }).review(review)).rejects.toThrow("wrong kinds");
  });

  it("summarises the trace compactly and redacts learned secrets", () => {
    const reviewer = new TraceReviewer({
      provider: fakeProvider("REVIEW", false),
      redactor: new Redactor().learn(["sk-live-SECRET-123"]),
    });
    const summary = reviewer.summarize(review);
    expect(JSON.stringify(summary)).not.toContain("sk-live-SECRET-123");
    expect(summary).toMatchObject({
      run: { status: "failed", costUsd: 0.05, tokens: 1200, nodeRuns: 3, durationMs: 10_000 },
      nodeStatuses: { completed: 2, failed: 1 },
      retries: { count: 1 },
      lowConfidenceDecisions: {
        threshold: 0.7,
        items: [{ node: "classify", value: "billing", confidence: 0.41 }],
      },
      humanOverrides: [{ node: "approve", action: "reject", edited: false }],
      failovers: { count: 1, items: [{ from: "typesafe", to: "llm" }] },
      toolErrors: { count: 1, items: [{ tool: "http_get", code: "TOOL_EXECUTION_ERROR" }] },
      durationVsP95: 2,
      costVsP95: 2.5,
    });
  });

  it("caps lists and truncates long messages", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      makeNodeRun({
        n: 100 + i,
        nodeId: `n${i}`,
        status: "failed",
        seq: 10 + i,
        error: errorInfo("INTERNAL", "x".repeat(1000)),
      }),
    );
    const summary = new TraceReviewer({
      provider: fakeProvider("REVIEW", false),
      maxItems: 5,
    }).summarize(input({ status: "failed" }, { nodeRuns: many }));
    const failures = summary.failures as Array<{ message: string }>;
    expect(failures).toHaveLength(5);
    expect(failures[0]?.message.length).toBe(300);
  });

  it("refuses runs that have not finished", async () => {
    await expect(
      new TraceReviewer({ provider: fakeProvider("REVIEW", false) }).review(
        input({ status: "running" }),
      ),
    ).rejects.toThrow("only finished runs");
  });
});

describe("shouldReview", () => {
  it("always reviews failures and never unfinished runs", () => {
    expect(shouldReview({ id: uid(1), status: "failed" }, 0)).toBe(true);
    expect(shouldReview({ id: uid(1), status: "timed_out" }, 0)).toBe(true);
    expect(shouldReview({ id: uid(1), status: "running" }, 1)).toBe(false);
    expect(shouldReview({ id: uid(1), status: "cancelled" }, 1)).toBe(false);
    expect(shouldReview({ id: uid(1), status: "completed" }, 1)).toBe(true);
    expect(shouldReview({ id: uid(1), status: "completed" }, 0)).toBe(false);
  });

  it("samples completed runs deterministically at about the rate", () => {
    const ids = Array.from({ length: 4000 }, (_, i) => uid(i + 1));
    const sampled = ids.filter((id) => shouldReview({ id, status: "completed" }, 0.1));
    expect(sampled.length / ids.length).toBeGreaterThan(0.08);
    expect(sampled.length / ids.length).toBeLessThan(0.12);
    expect(ids.filter((id) => shouldReview({ id, status: "completed" }, 0.1))).toEqual(sampled);
  });
});
