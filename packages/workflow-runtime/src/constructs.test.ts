import { describe, expect, it } from "vitest";
import type { ExecutorOutcome } from "./step.js";
import { okResult, simulate, type FakeCall } from "./testing/harness.js";
import { expr, lit, planOf, ref, transform } from "./test/plans.js";

const input = { x: 1 };
const start = { id: "start", kind: "input", name: "in" };
const out = (id: string, value: unknown, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "output",
  name: id,
  value,
  ...extra,
});
const edge = (id: string, from: string, port: string, to: string) => ({
  id,
  from: { node: from, port },
  to: { node: to },
});
const err = (
  retryable: boolean,
  code = "NETWORK_ERROR",
  extra: Record<string, unknown> = {},
): ExecutorOutcome => ({
  kind: "error",
  error: { code: code as never, message: "boom", retryable, ...extra },
  latencyMs: 3,
});
const retry = (maxAttempts: number, extra: Record<string, unknown> = {}) => ({
  retry: {
    maxAttempts,
    backoff: { type: "exponential", initialMs: 1000, maxMs: 10_000, factor: 2, jitter: false },
    ...extra,
  },
});

describe("retries", () => {
  const plan = planOf({
    nodes: [
      start,
      transform("a", "start.x", { policy: retry(3) }),
      out("out", { kind: "object", fields: { y: ref("a", "result") } }),
    ],
  });

  it("retries transient failures on durable timers with exponential backoff", async () => {
    let calls = 0;
    const sim = await simulate({
      plan,
      input,
      executors: { a: () => (++calls < 3 ? err(true) : okResult({ result: 42 })) },
    });
    expect(sim.status).toBe("retrying");
    expect(sim.of("NODE_RETRIED").map((e) => [e.nextAttempt, e.delayMs])).toEqual([[2, 1000]]);
    await sim.advance(999);
    expect(calls).toBe(1);
    await sim.advance(1);
    expect(sim.of("NODE_RETRIED").map((e) => e.delayMs)).toEqual([1000, 2000]);
    await sim.advance(2000);
    expect(sim.status).toBe("completed");
    expect(sim.of("RUN_COMPLETED")[0]?.output).toEqual({ y: 42 });
    expect(
      sim
        .of("NODE_SCHEDULED")
        .filter((e) => e.nodeId === "a")
        .map((e) => e.attempt),
    ).toEqual([1, 2, 3]);
    // The idempotency-relevant input hash is identical across attempts.
    expect(
      new Set(
        sim
          .of("NODE_SCHEDULED")
          .filter((e) => e.nodeId === "a")
          .map((e) => e.inputHash),
      ).size,
    ).toBe(1);
  });

  it("honours retryAfterMs from a rate limit", async () => {
    let calls = 0;
    const sim = await simulate({
      plan,
      input,
      executors: {
        a: () =>
          ++calls < 2
            ? err(true, "PROVIDER_RATE_LIMITED", { details: { retryAfterMs: 7000 } })
            : okResult({ result: 1 }),
      },
    });
    expect(sim.of("NODE_RETRIED")[0]?.delayMs).toBe(7000);
    await sim.advance(7000);
    expect(sim.status).toBe("completed");
  });

  it("does not retry non-retryable errors and fails the run", async () => {
    const sim = await simulate({
      plan,
      input,
      executors: { a: () => err(false, "SCHEMA_VALIDATION_ERROR") },
    });
    expect(sim.status).toBe("failed");
    expect(sim.of("NODE_RETRIED")).toHaveLength(0);
    expect(sim.of("RUN_FAILED")[0]?.error.code).toBe("SCHEMA_VALIDATION_ERROR");
  });

  it("gives up after maxAttempts", async () => {
    const sim = await simulate({ plan, input, executors: { a: () => err(true) } });
    await sim.advance(60_000);
    expect(sim.status).toBe("failed");
    expect(sim.of("NODE_RETRIED")).toHaveLength(2);
  });

  it("never retries a non-idempotent node", async () => {
    const http = planOf({
      nodes: [
        start,
        {
          id: "post",
          kind: "task",
          name: "post",
          type: "flowaid.tools.http",
          typeVersion: "1.0.0",
          config: { method: "POST", url: "https://api.example.com/charge", responseType: "json" },
        },
        out("out", lit({ ok: true })),
      ],
      edges: [edge("e0", "start", "done", "post"), edge("e1", "post", "done", "out")],
    });
    expect(http.nodes.post?.idempotency).toBe("none");
    // The compiler refuses this policy (E_RETRY_ON_IRREVERSIBLE); the runtime refuses it too.
    const post = http.nodes.post;
    if (post) post.policy.retry.maxAttempts = 3;
    const sim = await simulate({ plan: http, input, executors: { post: () => err(true) } });
    expect(sim.of("NODE_RETRIED")).toHaveLength(0);
    expect(sim.status).toBe("failed");
  });
});

describe("error routing", () => {
  it("fires the failed port when onError is route", async () => {
    const plan = planOf({
      nodes: [
        start,
        transform("a", "start.x", { policy: { onError: "route" } }),
        out("ok", lit("ok"), { outcome: "ok" }),
        out("recovered", lit("fallback"), { outcome: "recovered" }),
      ],
      edges: [edge("e1", "a", "done", "ok"), edge("e2", "a", "failed", "recovered")],
    });
    const sim = await simulate({ plan, input, executors: { a: () => err(false) } });
    expect(sim.of("RUN_COMPLETED")[0]).toMatchObject({ outcome: "recovered", output: "fallback" });
    expect(sim.statuses()).toMatchObject({ a: "failed", ok: "skipped", recovered: "completed" });
  });

  it("fails with NO_OUTPUT when no output node completes", async () => {
    const plan = planOf({
      nodes: [
        start,
        {
          id: "b",
          kind: "branch",
          name: "b",
          cases: [{ port: "yes", when: "start.x > 10" }],
          defaultPort: "no",
        },
        out("out", lit(1)),
      ],
      edges: [edge("e1", "b", "yes", "out")],
    });
    const sim = await simulate({ plan, input });
    expect(sim.status).toBe("failed");
    expect(sim.of("RUN_FAILED")[0]?.error.code).toBe("NO_OUTPUT");
  });
});

describe("crash recovery", () => {
  const plan = planOf({
    nodes: [
      start,
      transform("a", "start.x"),
      {
        id: "post",
        kind: "task",
        name: "post",
        type: "flowaid.tools.http",
        typeVersion: "1.0.0",
        config: { method: "POST", url: "https://api.example.com/charge", responseType: "json" },
      },
      out("out", { kind: "object", fields: { a: ref("a", "result"), p: ref("post", "status") } }),
    ],
    edges: [edge("e0", "start", "done", "post")],
  });

  it("re-runs safe nodes and fails non-idempotent ones with NONIDEMPOTENT_INTERRUPTED", async () => {
    const sim = await simulate({ plan, input, manual: true });
    const running = sim.pending.map((p) => p.nodeRunId);
    expect(running).toHaveLength(2);
    sim.pending.length = 0; // the worker died with both in flight
    await sim.trigger({ type: "recovered", lostNodeRunIds: running });
    const failed = sim.of("NODE_FAILED").filter((e) => e.terminal);
    expect(failed.map((e) => [e.nodeId, e.error.code])).toEqual([
      ["post", "NONIDEMPOTENT_INTERRUPTED"],
    ]);
    expect(sim.of("NODE_RETRIED").map((e) => [e.nodeId, e.error.code, e.delayMs])).toEqual([
      ["a", "WORKER_LOST", 0],
    ]);
    expect(sim.status).toBe("failed");
  });
});

describe("joins", () => {
  const branches = (mode: unknown, extra: Record<string, unknown> = {}) =>
    planOf({
      nodes: [
        start,
        transform("fast", "start.x"),
        transform("slow", "start.x"),
        transform("slow2", "slow.result", {}),
        {
          id: "j",
          kind: "join",
          name: "j",
          mode,
          inputs: { fast: ref("fast", "result"), slow: ref("slow2", "result") },
          ...extra,
        },
        out("out", ref("j", "values")),
      ],
      edges: [
        edge("e1", "fast", "done", "j"),
        edge("e2", "slow2", "done", "j"),
        edge("e3", "j", "done", "out"),
        edge("e4", "slow", "done", "slow2"),
      ],
    });

  it("all waits for every input", async () => {
    const sim = await simulate({ plan: branches({ type: "all" }), input, manual: true });
    await sim.runPending((e) => e.nodeId === "fast");
    expect(sim.statuses().j).toBe("pending");
    await sim.runPending();
    await sim.runPending();
    expect(sim.status).toBe("completed");
    expect(sim.of("JOIN_ARRIVED").map((e) => [e.from, e.status, e.arrived, e.expected])).toEqual([
      ["fast", "fired", 1, 2],
      ["slow2", "fired", 2, 2],
    ]);
  });

  it("race takes the first arrival and cancels the losing branch's private subgraph", async () => {
    const plan = branches({ type: "race" });
    expect(plan.nodes.j?.op.kind === "join" && plan.nodes.j.op.privateSubgraphs.e2).toEqual(
      expect.arrayContaining(["slow2"]),
    );
    const sim = await simulate({
      plan,
      input,
      manual: true,
      executors: { fast: () => okResult({ result: "F" }) },
    });
    await sim.runPending((e) => e.nodeId === "fast");
    expect(sim.status).toBe("completed");
    expect(sim.of("RUN_COMPLETED")[0]?.output).toMatchObject({ fast: "F", slow: null });
    const lost = [...sim.of("NODE_CANCELLED"), ...sim.of("NODE_SKIPPED")]
      .filter((e) => e.reason === "race_lost")
      .map((e) => e.nodeId);
    expect(lost).toEqual(expect.arrayContaining(["slow"]));
    expect([...sim.aborted].length).toBeGreaterThan(0);
  });

  it("times out with the arrivals so far and fires timeout", async () => {
    const plan = planOf({
      nodes: [
        start,
        transform("fast", "start.x"),
        transform("slow", "start.x"),
        {
          id: "j",
          kind: "join",
          name: "j",
          mode: { type: "all" },
          timeoutMs: 5000,
          inputs: { fast: ref("fast", "result"), slow: ref("slow", "result") },
        },
        out("done", ref("j", "values"), { outcome: "all" }),
        out("partial", ref("j", "values"), { outcome: "partial" }),
      ],
      edges: [
        edge("e1", "fast", "done", "j"),
        edge("e2", "slow", "done", "j"),
        edge("e3", "j", "done", "done"),
        edge("e4", "j", "timeout", "partial"),
      ],
    });
    const sim = await simulate({
      plan,
      input,
      manual: true,
      executors: { fast: () => okResult({ result: 1 }) },
    });
    await sim.runPending((e) => e.nodeId === "fast");
    await sim.advance(5000);
    expect(sim.statuses()).toMatchObject({ j: "completed", done: "skipped", partial: "completed" });
    // The timed-out input keeps running; the run completes once it drains.
    expect(sim.status).toBe("running");
    await sim.runPending();
    expect(sim.of("RUN_COMPLETED")[0]).toMatchObject({
      outcome: "partial",
      output: { fast: 1, slow: null },
    });
  });
});

describe("waits and events", () => {
  it("wait delay releases the lease and completes when the timer fires", async () => {
    const plan = planOf({
      nodes: [
        start,
        { id: "w", kind: "wait", name: "w", until: { type: "delay", ms: 60_000 } },
        out("out", lit(1)),
      ],
      edges: [edge("e0", "start", "done", "w"), edge("e1", "w", "done", "out")],
    });
    const sim = await simulate({ plan, input });
    expect(sim.status).toBe("waiting");
    expect(sim.effects.map((e) => e.type)).toContain("release_lease");
    await sim.advance(60_000);
    expect(sim.status).toBe("completed");
  });

  it("wait for an event receives its payload, or times out", async () => {
    const plan = planOf({
      nodes: [
        start,
        {
          id: "w",
          kind: "wait",
          name: "w",
          until: { type: "event", eventName: "payment.received", timeoutMs: 30_000 },
        },
        out("paid", ref("w", "payload"), { outcome: "paid" }),
        out("late", lit(null), { outcome: "late" }),
      ],
      edges: [
        edge("e0", "start", "done", "w"),
        edge("e1", "w", "done", "paid"),
        edge("e2", "w", "timeout", "late"),
      ],
    });
    const a = await simulate({ plan, input });
    await a.sendEvent("payment.received", { amount: 10 });
    expect(a.of("RUN_COMPLETED")[0]).toMatchObject({ outcome: "paid", output: { amount: 10 } });
    const b = await simulate({ plan, input });
    await b.advance(30_000);
    expect(b.of("RUN_COMPLETED")[0]?.outcome).toBe("late");
    await b.sendEvent("payment.received", {});
    expect(b.of("EVENT_RECEIVED")).toHaveLength(0);
  });
});

describe("human tasks", () => {
  const human = (extra: Record<string, unknown> = {}) =>
    planOf({
      nodes: [
        start,
        {
          id: "h",
          kind: "human",
          name: "h",
          mode: { type: "approval" },
          title: lit("Approve?"),
          assignees: ["role:lead"],
          ...extra,
        },
        out("yes", lit("approved"), { outcome: "approved" }),
        out("no", lit("rejected"), { outcome: "rejected" }),
        out("late", lit("expired"), { outcome: "expired" }),
      ],
      edges: [
        edge("e0", "start", "done", "h"),
        edge("e1", "h", "approved", "yes"),
        edge("e2", "h", "rejected", "no"),
        ...(extra.onExpire === "route" ? [edge("e3", "h", "expired", "late")] : []),
      ],
      // Human tasks outlive the default 15-minute run deadline.
      execution: { timeoutMs: 24 * 3_600_000 },
    });

  it("approve and reject route by the response", async () => {
    const a = await simulate({ plan: human(), input });
    expect(a.status).toBe("waiting_for_human");
    await a.respond("h", { action: "approve", comment: "ok" });
    expect(a.of("RUN_COMPLETED")[0]?.outcome).toBe("approved");
    const decision = a.of("NODE_COMPLETED").find((e) => e.nodeId === "h")?.output as {
      decision: { action: string; by: string; comment: string };
    };
    expect(decision.decision).toMatchObject({
      action: "approve",
      by: "user:tester",
      comment: "ok",
    });
    const r = await simulate({ plan: human(), input });
    await r.respond("h", { action: "reject" });
    expect(r.of("RUN_COMPLETED")[0]?.outcome).toBe("rejected");
  });

  it("expiry routes, fails or escalates per onExpire", async () => {
    const routed = await simulate({
      plan: human({ expiresInMs: 3_600_000, onExpire: "route" }),
      input,
    });
    await routed.advance(3_600_000);
    expect(routed.of("RUN_COMPLETED")[0]?.outcome).toBe("expired");
    const failed = await simulate({
      plan: human({ expiresInMs: 3_600_000, onExpire: "fail" }),
      input,
    });
    await failed.advance(3_600_000);
    expect(failed.of("RUN_FAILED")[0]?.error.code).toBe("HUMAN_TASK_EXPIRED");
    const esc = await simulate({
      plan: human({
        expiresInMs: 1000,
        onExpire: "escalate",
        escalation: { afterMs: 500, to: ["role:director"] },
      }),
      input,
    });
    await esc.advance(1000);
    expect(esc.of("HUMAN_TASK_ESCALATED").map((e) => e.to)).toEqual([
      ["role:director"],
      ["role:director"],
    ]);
    expect(esc.status).toBe("waiting_for_human");
    await esc.respond("h", { action: "approve" });
    expect(esc.status).toBe("completed");
  });

  it("an escalate response reassigns and keeps the task open", async () => {
    const sim = await simulate({ plan: human(), input });
    await sim.respond("h", { action: "escalate", to: ["user:boss"] });
    expect(sim.status).toBe("waiting_for_human");
    expect(sim.of("HUMAN_TASK_ESCALATED")[0]).toMatchObject({
      to: ["user:boss"],
      reason: "reviewer",
    });
    await sim.respond("h", { action: "approve" });
    expect(sim.status).toBe("completed");
  });

  it("task suspension re-enters execute with the response", async () => {
    const plan = planOf({
      nodes: [start, transform("agent", "start.x"), out("out", ref("agent", "result"))],
    });
    const sim = await simulate({
      plan,
      input,
      executors: {
        agent: (c: FakeCall): ExecutorOutcome =>
          c.resume?.kind === "human"
            ? okResult({ result: { approved: c.resume.response.action, state: c.resume.state } })
            : {
                kind: "suspend",
                wait: {
                  kind: "human",
                  request: {
                    title: "Run the refund tool?",
                    context: {},
                    mode: { type: "approval" },
                    assignees: [],
                    expiresAt: null,
                    externalReview: false,
                  },
                },
                state: { step: 3 },
                latencyMs: 2,
              },
      },
    });
    expect(sim.status).toBe("waiting_for_human");
    expect([...sim.humanTasks.values()][0]?.request.origin).toBe("task_suspend");
    await sim.respond("agent", { action: "approve" });
    expect(sim.of("RUN_COMPLETED")[0]?.output).toEqual({ approved: "approve", state: { step: 3 } });
  });

  it("a decision failover suspension is tagged decision_failover", async () => {
    const plan = planOf({
      nodes: [start, transform("agent", "start.x"), out("out", ref("agent", "result"))],
    });
    const sim = await simulate({
      plan,
      input,
      executors: {
        agent: (c: FakeCall): ExecutorOutcome =>
          c.resume?.kind === "human"
            ? okResult({ result: { approved: c.resume.response.action, state: c.resume.state } })
            : {
                kind: "suspend",
                wait: {
                  kind: "human",
                  request: {
                    title: "Run the refund tool?",
                    context: {},
                    mode: { type: "approval" },
                    assignees: [],
                    expiresAt: null,
                    externalReview: false,
                  },
                },
                state: { step: 3 },
                failover: true,
                latencyMs: 2,
              },
      },
    });
    expect(sim.status).toBe("waiting_for_human");
    expect([...sim.humanTasks.values()][0]?.request.origin).toBe("decision_failover");
    await sim.respond("agent", { action: "approve" });
    expect(sim.of("RUN_COMPLETED")[0]?.output).toEqual({ approved: "approve", state: { step: 3 } });
  });
});

describe("cancellation, deadlines and early exit", () => {
  const plan = planOf({
    nodes: [
      start,
      transform("a", "start.x"),
      { id: "h", kind: "human", name: "h", mode: { type: "approval" }, title: lit("t") },
      out("out", { kind: "object", fields: { a: ref("a", "result"), h: ref("h", "decision") } }),
    ],
    edges: [edge("e0", "start", "done", "h")],
  });

  it("cancels running and waiting nodes, timers and the run", async () => {
    const sim = await simulate({ plan, input, manual: true });
    await sim.cancel("user:ops", "wrong input");
    expect(sim.status).toBe("cancelled");
    expect(
      sim
        .of("NODE_CANCELLED")
        .map((e) => [e.nodeId, e.reason])
        .sort(),
    ).toEqual([
      ["a", "run_cancelled"],
      ["h", "run_cancelled"],
    ]);
    expect(sim.aborted.size).toBe(1);
    await sim.runPending();
    expect(sim.of("NODE_COMPLETED").filter((e) => e.nodeId === "a")).toHaveLength(0); // late result ignored
    expect(sim.types().at(-1)).toBe("RUN_CANCELLED");
  });

  it("times out a waiting run at its deadline", async () => {
    const timed = planOf({
      nodes: [
        start,
        { id: "h", kind: "human", name: "h", mode: { type: "approval" }, title: lit("t") },
        out("out", ref("h", "decision")),
      ],
      edges: [edge("e0", "start", "done", "h")],
      execution: { timeoutMs: 60_000 },
    });
    const sim = await simulate({ plan: timed, input });
    await sim.advance(60_000);
    expect(sim.status).toBe("timed_out");
    expect(sim.of("RUN_TIMED_OUT")[0]?.timeoutMs).toBe(60_000);
  });

  it("early exit completes the run and cancels siblings", async () => {
    const early = planOf({
      nodes: [
        start,
        transform("slow", "start.x"),
        transform("quick", "start.x"),
        out("fast", ref("quick", "result"), { earlyExit: true, outcome: "early" }),
        out("late", ref("slow", "result")),
      ],
    });
    const sim = await simulate({ plan: early, input, manual: true });
    await sim.runPending((e) => e.nodeId === "quick");
    expect(sim.status).toBe("completed");
    expect(sim.of("RUN_COMPLETED")[0]?.outcome).toBe("early");
    expect(sim.of("NODE_CANCELLED")).toMatchObject([{ nodeId: "slow", reason: "early_exit" }]);
  });
});

describe("foreach", () => {
  const fe = (failurePolicy: string, concurrency = 2) =>
    planOf({
      nodes: [
        start,
        {
          id: "each",
          kind: "foreach",
          name: "each",
          items: expr("[1, 2, 3, 4]"),
          concurrency,
          failurePolicy,
          bounds: { maxIterations: 10 },
          collect: ref("work", "result"),
        },
        { ...transform("work", "$scope.item * 10"), parent: "each" },
        out("out", ref("each", "results")),
      ],
      edges: [edge("e0", "start", "done", "each"), edge("e1", "each", "done", "out")],
    });

  it("runs at most `concurrency` items at once and collects results in index order", async () => {
    const sim = await simulate({
      plan: fe("collect"),
      input,
      manual: true,
      executors: { work: (c) => okResult({ result: c.scope }) },
    });
    expect(sim.pending.map((p) => p.scope)).toEqual(["each#0", "each#1"]);
    await sim.runPending((p) => p.scope === "each#1");
    expect(sim.pending.map((p) => p.scope)).toEqual(["each#0", "each#2"]);
    await sim.runPending();
    await sim.runPending();
    expect(sim.status).toBe("completed");
    expect(sim.of("RUN_COMPLETED")[0]?.output).toEqual(["each#0", "each#1", "each#2", "each#3"]);
  });

  it("collect records failures and continues; fail_fast stops the rest", async () => {
    const work = (c: FakeCall) => (c.scope === "each#1" ? err(false) : okResult({ result: 1 }));
    const collect = await simulate({ plan: fe("collect", 1), input, executors: { work } });
    expect(collect.status).toBe("completed");
    const done = collect.of("NODE_COMPLETED").find((e) => e.nodeId === "each")?.output as {
      results: unknown[];
      errors: ({ code: string } | null)[];
    };
    expect(done.results).toEqual([1, null, 1, 1]);
    expect(done.errors.map((e) => e?.code ?? null)).toEqual([null, "NETWORK_ERROR", null, null]);
    const fast = await simulate({ plan: fe("fail_fast", 1), input, executors: { work } });
    expect(fast.status).toBe("failed");
    expect(fast.calls.filter((c) => c.nodeId === "work")).toHaveLength(2);
  });

  it("several iterations can wait for people at once", async () => {
    const plan = planOf({
      nodes: [
        start,
        {
          id: "each",
          kind: "foreach",
          name: "each",
          items: expr("[1, 2]"),
          concurrency: 2,
          failurePolicy: "collect",
          bounds: { maxIterations: 5 },
          collect: ref("h", "value"),
        },
        {
          id: "h",
          kind: "human",
          name: "h",
          parent: "each",
          mode: { type: "form", schema: { type: "object" } },
          title: lit("fill"),
        },
        out("out", ref("each", "results")),
      ],
      edges: [edge("e0", "start", "done", "each"), edge("e1", "each", "done", "out")],
    });
    const sim = await simulate({ plan, input });
    expect(sim.status).toBe("waiting_for_human");
    expect(sim.humanTasks.size).toBe(2);
    const [first, second] = [...sim.humanTasks.keys()];
    await sim.trigger({
      type: "human_response",
      humanTaskId: second ?? "",
      response: { action: "submit", value: { n: 2 } },
      by: "u",
    });
    expect(sim.status).toBe("waiting_for_human");
    await sim.trigger({
      type: "human_response",
      humanTaskId: first ?? "",
      response: { action: "submit", value: { n: 1 } },
      by: "u",
    });
    expect(sim.of("RUN_COMPLETED")[0]?.output).toEqual([{ n: 1 }, { n: 2 }]);
  });
});

describe("subflows", () => {
  const plan = planOf({
    nodes: [
      start,
      {
        id: "child",
        kind: "subflow",
        name: "child",
        workflowId: "00000000-0000-4000-8000-00000000c0de",
        inputs: { x: ref("start", "x") },
        timeoutMs: 10_000,
      },
      out("ok", ref("child", "output"), { outcome: "ok" }),
      out("bad", lit("child failed"), { outcome: "bad" }),
    ],
    edges: [edge("e1", "child", "done", "ok"), edge("e2", "child", "failed", "bad")],
  });
  const context = { subflowVersion: () => "00000000-0000-4000-8000-00000000c0d1" };

  it("starts a child run, waits, and completes with its output", async () => {
    const sim = await simulate({ plan, input, context });
    expect(sim.childRuns).toMatchObject([
      { input: { x: 1 }, depth: 1, versionId: "00000000-0000-4000-8000-00000000c0d1" },
    ]);
    expect(sim.status).toBe("waiting");
    await sim.finishChild(sim.childRuns[0]?.childRunId ?? "", "completed", { y: 2 });
    expect(sim.of("RUN_COMPLETED")[0]).toMatchObject({ outcome: "ok", output: { y: 2 } });
  });

  it("refuses to nest deeper than maxSubflowDepth", async () => {
    const sim = await simulate({ plan, input, context: { ...context, depth: 4 } });
    expect(sim.of("NODE_FAILED")[0]?.error.code).toBe("BOUNDS_EXCEEDED");
  });

  it("times the child out", async () => {
    const sim = await simulate({ plan, input, context });
    await sim.advance(10_000);
    expect(sim.effects.map((e) => e.type)).toContain("cancel_child_run");
    expect(sim.status).toBe("failed");
  });
});

describe("recorded replay", () => {
  const plan = planOf({
    nodes: [
      start,
      transform("a", "start.x"),
      transform("b", "a.result"),
      out("out", ref("b", "result")),
    ],
    edges: [],
  });

  it("reuses nodes whose inputs match and re-executes the rest", async () => {
    const first = await simulate({
      plan,
      input,
      executors: { a: () => okResult({ result: 5 }), b: () => okResult({ result: 50 }) },
    });
    const recorded = new Map(
      first.of("NODE_SCHEDULED").map((e) => {
        const done = first.of("NODE_COMPLETED").find((c) => c.nodeRunId === e.nodeRunId);
        return [
          `${e.scope}|${e.nodeId}|${e.inputHash}`,
          {
            nodeRunId: e.nodeRunId,
            output: done?.output ?? null,
            firedPorts: done?.firedPorts ?? [],
            decision: null,
          },
        ];
      }),
    );
    const replay = await simulate({
      plan,
      input,
      context: { recorded },
      executors: { a: () => okResult({ result: 999 }) },
    });
    expect(replay.calls).toHaveLength(0);
    expect(
      replay
        .of("NODE_COMPLETED")
        .filter((e) => e.reused)
        .map((e) => e.nodeId),
    ).toEqual(["a", "b"]);
    expect(replay.of("RUN_COMPLETED")[0]?.output).toBe(50);
    const restart = await simulate({
      plan,
      input,
      context: { recorded, neverReuse: new Set(["b"]) },
      executors: { b: () => okResult({ result: 51 }) },
    });
    expect(restart.calls.map((c) => c.nodeId)).toEqual(["b"]);
    expect(restart.of("RUN_COMPLETED")[0]?.output).toBe(51);
  });
});

describe("bounds", () => {
  it("fails the run when spend crosses maxCostUsd, after the crossing node completes", async () => {
    const plan = planOf({
      nodes: [
        start,
        transform("a", "start.x"),
        transform("b", "a.result"),
        out("out", ref("b", "result")),
      ],
      execution: { maxCostUsd: 0.05 },
    });
    const sim = await simulate({
      plan,
      input,
      executors: {
        a: () => okResult({ result: 1 }, { costUsd: 0.06 }),
        b: () => okResult({ result: 2 }),
      },
    });
    expect(sim.status).toBe("failed");
    expect(sim.of("RUN_FAILED")[0]?.error).toMatchObject({
      code: "BOUNDS_EXCEEDED",
      details: { bound: "maxCostUsd" },
    });
    expect(sim.statuses().a).toBe("completed");
    expect(sim.calls.map((c) => c.nodeId)).toEqual(["a"]);
  });
});

describe("delegation", () => {
  it("delegates nodes of another pool and resumes on their result", async () => {
    const plan = planOf({
      nodes: [start, transform("a", "start.x"), out("out", ref("a", "result"))],
    });
    const sim = await simulate({
      plan,
      input,
      context: { pool: "code" },
      executors: { a: () => okResult({ result: 3 }) },
    });
    expect(sim.types()).toContain("NODE_DELEGATED");
    expect(sim.of("RUN_COMPLETED")[0]?.output).toBe(3);
  });
});

describe("input hashes", () => {
  it("differ when inputs or config differ and match when they are equal", async () => {
    const { inputHashOf } = await import("./step.js");
    const a = inputHashOf({ x: 1, y: [1, 2] }, { url: "u" }, "1.0.0");
    expect(inputHashOf({ y: [1, 2], x: 1 }, { url: "u" }, "1.0.0")).toBe(a); // key order does not matter
    expect(inputHashOf({ x: 2, y: [1, 2] }, { url: "u" }, "1.0.0")).not.toBe(a);
    expect(inputHashOf({ x: 1, y: [1, 2] }, { url: "v" }, "1.0.0")).not.toBe(a);
    expect(inputHashOf({ x: 1, y: [1, 2] }, { url: "u" }, "1.0.1")).not.toBe(a);
  });

  it("recorded replay re-executes a node whose input changed", async () => {
    const plan = planOf({
      nodes: [start, transform("a", "start.x * 2"), out("out", ref("a", "result"))],
    });
    const first = await simulate({ plan, input: { x: 1 } });
    const recorded = new Map(
      first.of("NODE_SCHEDULED").map((e) => {
        const done = first.of("NODE_COMPLETED").find((c) => c.nodeRunId === e.nodeRunId);
        return [
          `${e.scope}|${e.nodeId}|${e.inputHash}`,
          {
            nodeRunId: e.nodeRunId,
            output: done?.output ?? null,
            firedPorts: done?.firedPorts ?? [],
            decision: null,
          },
        ];
      }),
    );
    const changed = await simulate({ plan, input: { x: 5 }, context: { recorded } });
    expect(changed.of("NODE_COMPLETED").find((e) => e.nodeId === "a")?.reused).toBe(false);
    expect(changed.of("RUN_COMPLETED")[0]?.output).toBe(10);
  });
});

describe("run deadline timer id", () => {
  it("is derived from the run id (the database's RUN_STARTED projection uses the same vector)", async () => {
    const { deadlineTimerId } = await import("./step.js");
    expect(deadlineTimerId("00000000-0000-4000-8000-00000000abcd")).toBe(
      "315da7c8-fbc3-4d1b-8837-18ee2f31547b",
    );
  });
});
