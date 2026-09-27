/**
 * Run actions (ARCHITECTURE.md §5.9): retry-node reopens a failed run in place; restart-from-node
 * and fork are recorded replays that never reuse the target and what follows it, optionally with
 * the target's inputs overridden.
 */
import { describe, expect, it } from "vitest";
import type { DurableRunEvent, JsonObject } from "@flowaid/workflow-core";
import { downstreamOf, recordedKey, type ExecutorOutcome, type RecordedOutput } from "./step.js";
import { okResult, simulate, type FakeCall } from "./testing/harness.js";
import { planOf, ref, transform } from "./test/plans.js";

const input = { x: 1 };
const start = { id: "start", kind: "input", name: "in" };
const out = (id: string, value: unknown) => ({ id, kind: "output", name: id, value });
const edge = (id: string, from: string, port: string, to: string) => ({
  id,
  from: { node: from, port },
  to: { node: to },
});
const fail: ExecutorOutcome = {
  kind: "error",
  error: { code: "NODE_EXECUTION_ERROR", message: "boom", retryable: false },
  latencyMs: 3,
};

// start → a → b → out, and start → c (a side branch that nothing after b reads)
const plan = planOf({
  nodes: [
    start,
    transform("a", "start.x"),
    {
      id: "b",
      kind: "task",
      name: "b",
      type: "flowaid.decision.boolean",
      typeVersion: "1.0.0",
      config: { instructions: "Is it big?" },
      inputs: { state: { kind: "object", fields: { v: ref("a", "result") } } },
      credentials: { typesafe: "TYPESAFE_API_KEY" },
    },
    transform("c", "start.x"),
    out("out", { kind: "object", fields: { y: ref("b", "decision"), z: ref("c", "result") } }),
  ],
  edges: [
    edge("e1", "start", "done", "a"),
    edge("e2", "a", "done", "b"),
    edge("e3", "start", "done", "c"),
    edge("e4", "b", "done", "out"),
    edge("e5", "c", "done", "out"),
  ],
  secrets: [{ name: "TYPESAFE_API_KEY", credentialType: "typesafe.api_key" }],
});

/** The recorded outputs of a finished run, as `PgRunStore.recordedOutputs` builds them. */
function recordedOf(events: DurableRunEvent[]): Map<string, RecordedOutput> {
  const hashes = new Map<string, { nodeId: string; scope: string; inputHash: string }>();
  const out = new Map<string, RecordedOutput>();
  for (const e of events) {
    if (e.type === "NODE_SCHEDULED")
      hashes.set(e.nodeRunId, { nodeId: e.nodeId, scope: e.scope, inputHash: e.inputHash });
    if (e.type === "NODE_COMPLETED") {
      const h = hashes.get(e.nodeRunId);
      if (h)
        out.set(recordedKey(h.nodeId, h.scope, h.inputHash), {
          nodeRunId: e.nodeRunId,
          output: e.output,
          firedPorts: e.firedPorts,
          decision: null,
        });
    }
  }
  return out;
}

/** A transform's value is its evaluated `config.expr`; the decision node reads `state.v`. */
const valueOf = (call: FakeCall): number =>
  ((call.config.expr ?? (call.input.state as { v?: number } | undefined)?.v) as
    number | undefined) ?? 0;
const plus = (n: number) => (call: FakeCall) =>
  okResult(call.nodeId === "b" ? { decision: valueOf(call) + n } : { result: valueOf(call) + n });

describe("downstreamOf", () => {
  it("is the node and everything it activates or feeds, never what came before", () => {
    expect([...downstreamOf(plan, "b")].sort()).toEqual(["b", "out"]);
    expect([...downstreamOf(plan, "a")].sort()).toEqual(["a", "b", "out"]);
    expect(downstreamOf(plan, "a").has("c")).toBe(false);
  });
});

describe("retry-node", () => {
  it("reopens a failed run: the failed node runs again and the run completes", async () => {
    let calls = 0;
    const sim = await simulate({
      plan,
      input,
      executors: {
        a: plus(1),
        b: (call) => (++calls === 1 ? fail : plus(10)(call)),
        c: plus(100),
      },
    });
    expect(sim.status).toBe("failed");
    // Much later than the original deadline: the retry brings its own.
    await sim.advance(10 * 24 * 3600_000);
    await sim.trigger({ type: "manual_retry", by: "user:owner" });
    expect(sim.status).toBe("completed");
    // b failed; c was running and the failure cancelled it: both run again.
    const retried = sim.of("NODE_RETRIED");
    expect(retried.map((e) => e.nodeId).sort()).toEqual(["b", "c"]);
    const b = retried.find((e) => e.nodeId === "b");
    expect(b).toMatchObject({ nextAttempt: 2, delayMs: 0 });
    expect(b?.error).toMatchObject({ code: "NODE_EXECUTION_ERROR" });
    expect(b?.error.details).toMatchObject({ manualRetry: { by: "user:owner" } });
    expect(retried.find((e) => e.nodeId === "c")?.error.code).toBe("CANCELLED_ERROR");
    expect(sim.of("RUN_COMPLETED")[0]?.output).toEqual({ y: 12, z: 101 });
    expect(sim.effects.some((e) => e.type === "set_timer" && e.timer.purpose === "run_deadline"));
  });

  it("does nothing to a run that did not fail", async () => {
    const sim = await simulate({ plan, input, executors: { a: plus(1), b: plus(1), c: plus(1) } });
    expect(sim.status).toBe("completed");
    const before = sim.events.length;
    await sim.trigger({ type: "manual_retry", by: "user:owner" });
    expect(sim.events.length).toBe(before);
    expect(sim.status).toBe("completed");
  });
});

describe("restart from node", () => {
  it("reuses what came before the target, executes the target and what follows", async () => {
    const first = await simulate({
      plan,
      input,
      executors: { a: plus(1), b: plus(10), c: plus(100) },
    });
    expect(first.status).toBe("completed");
    const executed: string[] = [];
    const track = (n: number) => (call: FakeCall) => {
      executed.push(call.nodeId);
      return plus(n)(call);
    };
    const restart = await simulate({
      plan,
      input,
      runId: "00000000-0000-4000-8000-00000000abce",
      executors: { a: track(1), b: track(20), c: track(100) },
      context: { recorded: recordedOf(first.events), neverReuse: downstreamOf(plan, "b") },
    });
    expect(restart.status).toBe("completed");
    expect(executed).toEqual(["b"]);
    const reused = restart
      .of("NODE_COMPLETED")
      .filter((e) => e.reused)
      .map((e) => e.nodeId);
    expect(reused.sort()).toEqual(["a", "c"]);
    expect(restart.of("NODE_SCHEDULED").find((e) => e.nodeId === "a")?.reusedFromNodeRunId).toBe(
      first.of("NODE_SCHEDULED").find((e) => e.nodeId === "a")?.nodeRunId,
    );
    expect(restart.of("RUN_COMPLETED")[0]?.output).toEqual({ y: 22, z: 101 });
  });

  it("overrides the target's resolved input ports", async () => {
    const first = await simulate({
      plan,
      input,
      executors: { a: plus(1), b: plus(10), c: plus(100) },
    });
    const seen: JsonObject[] = [];
    const restart = await simulate({
      plan,
      input,
      runId: "00000000-0000-4000-8000-00000000abcf",
      executors: {
        a: plus(1),
        b: (call) => {
          seen.push(call.input);
          return plus(10)(call);
        },
        c: plus(100),
      },
      context: {
        recorded: recordedOf(first.events),
        neverReuse: downstreamOf(plan, "b"),
        inputOverrides: [{ nodeId: "b", input: { state: { v: 5 } } }],
      },
    });
    expect(seen[0]).toEqual({ state: { v: 5 } });
    expect(restart.of("RUN_COMPLETED")[0]?.output).toEqual({ y: 15, z: 101 });
  });
});
