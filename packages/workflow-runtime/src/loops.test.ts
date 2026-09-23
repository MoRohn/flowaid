import type { JsonValue } from "@flowaid/workflow-core";
import { describe, expect, it } from "vitest";
import { okResult, simulate, type FakeCall } from "./testing/harness.js";
import { goldenPlan } from "./test/plans.js";

const plan = goldenPlan("research-agent");
const d = (kind: string, value: JsonValue, confidence = 0.9) => ({
  kind,
  value,
  confidence,
  provider: "typesafe",
  model: "jev-1.13.0",
  latencyMs: 100,
  costUsd: 0.01,
  usage: { inputTokens: 200, outputTokens: 0 },
  attempts: [],
  ...(kind === "boolean"
    ? {
        pYes: value ? confidence : 1 - confidence,
        probabilities: {
          true: value ? confidence : 1 - confidence,
          false: value ? 1 - confidence : confidence,
        },
      }
    : {}),
});

function executors(completeOnRound: number) {
  let round = -1;
  return {
    planner: () => {
      round += 1;
      return okResult({
        structured: {
          queries: [
            { query: `q${round}a`, source: "web" },
            { query: `q${round}b`, source: "papers" },
            { query: `q${round}c`, source: "web" },
          ],
        },
        usage: {},
      });
    },
    web: (c: FakeCall) =>
      okResult({
        status: 200,
        headers: {},
        body: {
          url: c.config.url ?? null,
          results: [
            {
              title: "Rayleigh scattering",
              snippet: typeof c.config.url === "string" ? c.config.url : "",
            },
          ],
        },
      }),
    // The third query of each round is judged irrelevant, so it is filtered out of the evidence.
    judge: (c: FakeCall) =>
      okResult({
        answers: {
          relevant: d("score", JSON.stringify(c.input.state).includes("c&source") ? 1 : 3),
          reliable: d("score", 3),
        },
      }),
    store: () => okResult({ result: [{ fact: "x" }] }),
    synthesis: () => okResult({ structured: { answer: `answer after round ${round}` }, usage: {} }),
    completeness: () =>
      okResult(
        {
          answers: {
            complete: d("boolean", round >= completeOnRound),
            gap: d("choice", round >= completeOnRound ? "none" : "missing_data"),
          },
        },
        { costUsd: 0.01, usage: { inputTokens: 500, outputTokens: 0 } },
      ),
  };
}

describe("research agent (loop with a foreach body)", () => {
  it("iterates until the exit condition holds and carries evidence", async () => {
    const sim = await simulate({
      plan,
      input: { question: "Why is the sky blue?", max_rounds: 4 },
      executors: executors(1),
    });
    expect(sim.status).toBe("completed");
    expect(sim.of("LOOP_ITERATION_STARTED").map((e) => e.childScope)).toEqual([
      "research#0",
      "research#1",
    ]);
    expect(sim.of("LOOP_ITERATION_COMPLETED").map((e) => e.exit)).toEqual([false, true]);
    expect(sim.of("LOOP_EXITED")).toMatchObject([{ reason: "exit_condition", iterations: 2 }]);
    // Three foreach items per round, each in its own nested scope.
    expect(sim.of("FOREACH_ITEM_COMPLETED").map((e) => e.childScope)).toEqual([
      "research#0/search_all#0",
      "research#0/search_all#1",
      "research#0/search_all#2",
      "research#1/search_all#0",
      "research#1/search_all#1",
      "research#1/search_all#2",
    ]);
    expect(sim.calls.filter((c) => c.nodeId === "web").map((c) => c.config.url)).toContain(
      "https://search.example.com/v1?q=q0b&source=papers",
    );
    const done = sim.of("RUN_COMPLETED")[0];
    expect(done?.output).toMatchObject({ answer: "answer after round 1", complete: true });
    // carry.next is evaluated in each iteration's scope.
    expect(sim.of("LOOP_ITERATION_COMPLETED").map((e) => (e.carry as { gap: string }).gap)).toEqual(
      ["missing_data", "none"],
    );
    // Loop spend accumulates over its iterations; the run total includes it once.
    expect(sim.of("LOOP_ITERATION_COMPLETED").map((e) => e.costUsd)).toEqual([0.01, 0.02]);
    expect(done?.costUsd).toBeCloseTo(0.02);
  });

  it("stops at the workflow's own round limit", async () => {
    const sim = await simulate({
      plan,
      input: { question: "q", max_rounds: 2 },
      executors: executors(99),
    });
    expect(sim.of("LOOP_EXITED")).toMatchObject([{ reason: "exit_condition", iterations: 2 }]);
    expect(sim.statuses()).toMatchObject({ out_done: "completed" });
  });

  it("routes to the partial output when the bounds are exhausted", async () => {
    const sim = await simulate({
      plan,
      input: { question: "q", max_rounds: 50 },
      executors: executors(99),
    });
    expect(sim.status).toBe("completed");
    const exited = sim.of("LOOP_EXITED")[0];
    expect(exited).toMatchObject({ reason: "max_iterations", iterations: 5 });
    expect(sim.of("RUN_COMPLETED")[0]?.outcome).toBe(
      plan.nodes.out_partial?.op.kind === "output" ? plan.nodes.out_partial.op.outcome : null,
    );
    expect(sim.statuses()).toMatchObject({ out_done: "skipped", out_partial: "completed" });
  });
});
