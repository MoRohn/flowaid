import type { JsonValue } from "@flowaid/workflow-core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TERMINAL_EVENT_TYPES, type ExecutionPlan } from "@flowaid/workflow-core";
import { reduceAll } from "./reduce.js";
import { initialState, type SchedulerState } from "./state.js";
import type { ExecutorOutcome } from "./step.js";
import { Simulation, okResult, type FakeCall } from "./testing/harness.js";
import { goldenPlan, planOf, ref, transform } from "./test/plans.js";

const decision = (kind: string, value: JsonValue) => ({
  kind,
  value,
  confidence: 0.9,
  provider: "typesafe",
  model: "m",
  latencyMs: 1,
  costUsd: 0.001,
  attempts: [],
  ...(kind === "boolean" ? { pYes: 0.9, probabilities: { true: 0.9, false: 0.1 } } : {}),
  ...(kind === "score"
    ? { levels: ["a", "b", "c", "d", "e"], level: 1, levelLabel: "b", normalized: 0.25 }
    : {}),
});

/** An executor that fails (transiently or not) or answers, as the random script says. */
function scripted(script: number[], answer: (c: FakeCall) => ExecutorOutcome) {
  let i = 0;
  return (c: FakeCall): ExecutorOutcome => {
    const roll = script[i++ % script.length] ?? 0;
    if (roll < 0.15)
      return {
        kind: "error",
        error: { code: "NETWORK_ERROR", message: "flaky", retryable: true },
        latencyMs: 2,
      };
    if (roll < 0.2)
      return {
        kind: "error",
        error: { code: "SCHEMA_VALIDATION_ERROR", message: "bad", retryable: false },
        latencyMs: 2,
      };
    return answer(c);
  };
}

const retrying = planOf({
  nodes: [
    { id: "start", kind: "input", name: "in" },
    transform("a", "start.x", {
      policy: {
        retry: { maxAttempts: 3, backoff: { type: "fixed", initialMs: 100, jitter: false } },
      },
    }),
    transform("b", "a.result + 1", { policy: { onError: "route" } }),
    {
      id: "each",
      kind: "foreach",
      name: "each",
      items: { kind: "expr", source: "[1, 2, 3]" },
      concurrency: 2,
      failurePolicy: "collect",
      bounds: { maxIterations: 5 },
      collect: ref("w", "result"),
    },
    {
      ...transform("w", "$scope.item", {
        policy: {
          retry: { maxAttempts: 2, backoff: { type: "fixed", initialMs: 50, jitter: false } },
        },
      }),
      parent: "each",
    },
    {
      id: "ok",
      kind: "output",
      name: "ok",
      value: { kind: "object", fields: { b: ref("b", "result"), each: ref("each", "results") } },
      outcome: "ok",
    },
    {
      id: "rescued",
      kind: "output",
      name: "rescued",
      value: { kind: "literal", value: "rescued" },
      outcome: "rescued",
    },
  ],
  edges: [
    { id: "e0", from: { node: "start", port: "done" }, to: { node: "each" } },
    { id: "e1", from: { node: "b", port: "done" }, to: { node: "ok" } },
    { id: "e2", from: { node: "b", port: "failed" }, to: { node: "rescued" } },
  ],
});

async function runScenario(
  plan: ExecutionPlan,
  script: number[],
  seed: number,
): Promise<Simulation> {
  const answer = (c: FakeCall): ExecutorOutcome => {
    switch (c.nodeId) {
      case "judgments":
        return okResult({
          answers: {
            intent: decision("choice", "billing"),
            urgency: decision("score", 1),
            escalate: decision("boolean", false),
          },
        });
      case "safety":
        return okResult({
          answers: { safe: decision("boolean", true), on_topic: decision("boolean", true) },
        });
      case "gate":
        return okResult({ decision: {}, passed: true, outcome: "pass" }, { route: "pass" });
      case "draft":
        return okResult({ text: "t", finish_reason: "stop", usage: {} }, { costUsd: 0.002 });
      default:
        return c.nodeType === "flowaid.data.transform"
          ? okResult({ result: c.config.expr ?? null })
          : okResult({ status: 200, headers: {}, body: {}, result: {} });
    }
  };
  const run = scripted(script, answer);
  const executors = Object.fromEntries(Object.keys(plan.nodes).map((id) => [id, run]));
  const sim = new Simulation({
    plan,
    input: { x: 1, message: "m", customer_id: "c", channel: "email" },
    executors,
    seed,
    context: { vars: { billingBase: "https://b" } },
  });
  await sim.start();
  await sim.advance(10_000);
  return sim;
}

const PLANS: Array<[string, ExecutionPlan]> = [
  ["support-triage", goldenPlan("support-triage")],
  ["retries and foreach", retrying],
];

function freshState(plan: ExecutionPlan, sim: Simulation): SchedulerState {
  const init = initialState(plan, sim.state.run.id, sim.state.run.input);
  return reduceAll(plan, init, sim.events.slice(1));
}

describe.each(PLANS)("determinism: %s", (_name, plan) => {
  it("step's incremental state equals a from-scratch reduction of the log", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 1, max: 1000 }),
        async (script, seed) => {
          const sim = await runScenario(plan, script, seed);
          expect(freshState(plan, sim)).toEqual(sim.state);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("checkpoint (serialised) plus the tail equals the full reduction, for any split", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 12 }),
        fc.nat(),
        async (script, cut) => {
          const sim = await runScenario(plan, script, 7);
          const log = sim.events.slice(1);
          const k = log.length === 0 ? 0 : cut % log.length;
          const init = initialState(plan, sim.state.run.id, sim.state.run.input);
          const checkpoint = JSON.parse(
            JSON.stringify(reduceAll(plan, init, log.slice(0, k))),
          ) as SchedulerState;
          const resumed = reduceAll(plan, checkpoint, log.slice(k));
          expect(JSON.parse(JSON.stringify(resumed))).toEqual(
            JSON.parse(JSON.stringify(sim.state)),
          );
        },
      ),
      { numRuns: 60 },
    );
  });

  it("keeps the log's invariants", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 12 }),
        async (script) => {
          const sim = await runScenario(plan, script, 3);
          const seqs = sim.events.map((e) => e.seq);
          expect(seqs).toEqual(seqs.map((_, i) => i + 1));
          const terminal = sim.events.findIndex((e) => TERMINAL_EVENT_TYPES.has(e.type));
          expect(terminal).toBeGreaterThan(-1);
          expect(terminal).toBe(sim.events.length - 1);
          // Every node run that was scheduled ended one way or another.
          const ended = new Set(
            sim.events
              .filter(
                (e) =>
                  e.type === "NODE_COMPLETED" ||
                  e.type === "NODE_SKIPPED" ||
                  e.type === "NODE_CANCELLED" ||
                  e.type === "NODE_RETRIED" ||
                  (e.type === "NODE_FAILED" && e.terminal),
              )
              .map((e) => ("nodeRunId" in e ? e.nodeRunId : "")),
          );
          for (const s of sim.of("NODE_SCHEDULED"))
            expect(ended.has(s.nodeRunId), `${s.nodeId} ${s.nodeRunId}`).toBe(true);
          // Spend in the terminal event equals the sum of what nodes reported.
          const reported = sim.of("NODE_COMPLETED").reduce((a, e) => a + e.costUsd, 0);
          const last = sim.events.at(-1) as { costUsd?: number };
          expect(last.costUsd ?? 0).toBeCloseTo(reported, 9);
        },
      ),
      { numRuns: 60 },
    );
  });
});
