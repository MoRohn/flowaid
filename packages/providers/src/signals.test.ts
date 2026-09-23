import { ProviderError, type ProviderHop } from "@flowaid/workflow-core";
import { describe, expect, it } from "vitest";
import { choiceDecision, scoreDecision } from "./decisionMath.js";
import { FailoverChain } from "./failover.js";
import { HealthTracker } from "./health.js";
import { CircuitOpenError, HumanFallbackSignal, systemClock } from "./signals.js";
import { FakeClock, HEALTHY, ctx, scriptedDecider } from "./test/fakes.js";

describe("systemClock", () => {
  it("sleeps and can be cancelled before or during the wait", async () => {
    const before = systemClock.now();
    await systemClock.sleep(5);
    expect(systemClock.now() - before).toBeGreaterThanOrEqual(4);
    const aborted = new AbortController();
    aborted.abort(new Error("stop"));
    await expect(systemClock.sleep(1000, aborted.signal)).rejects.toThrow("stop");
    const later = new AbortController();
    const pending = systemClock.sleep(10_000, later.signal);
    later.abort();
    await expect(pending).rejects.toThrow();
  });
});

describe("signals", () => {
  it("carry their context", () => {
    expect(new HumanFallbackSignal([]).name).toBe("HumanFallbackSignal");
    expect(new CircuitOpenError("typesafe", 42)).toMatchObject({
      reopensAt: 42,
      retryable: true,
      code: "PROVIDER_ERROR",
    });
  });
});

describe("FailoverChain choice, score and health", () => {
  const TS: ProviderHop = { provider: "typesafe", model: "jev-latest" };
  const meta = { provider: "typesafe", model: "jev-1", latencyMs: 1, costUsd: 0 };
  const choiceQ = { kind: "choice" as const, instructions: "Which?", options: { a: "A", b: "B" } };
  const scoreQ = { kind: "score" as const, instructions: "How much?", levels: ["low", "high"] };

  it("walks the chain for choice and score questions", async () => {
    const provider = {
      ...scriptedDecider("typesafe", [0.5]),
      decideChoice: () => Promise.resolve(choiceDecision({ a: 0.9, b: 0.1 }, meta)),
      decideScore: () => Promise.resolve(scoreDecision([0.2, 0.8], ["low", "high"], meta)),
    };
    const chain = new FailoverChain([{ hop: TS, provider }]);
    expect((await chain.decideChoice("s", choiceQ, ctx())).value).toBe("a");
    expect((await chain.decideScore("s", scoreQ, ctx())).level).toBe(1);
  });

  it("reports health from the tracker, the provider, or healthy", () => {
    const clock = new FakeClock();
    const health = new HealthTracker(clock);
    const provider = scriptedDecider("typesafe", [0.5]);
    expect(new FailoverChain([{ hop: TS, provider }], { health, clock }).health().status).toBe(
      "healthy",
    );
    expect(new FailoverChain([{ hop: TS, provider }]).health()).toEqual(HEALTHY);
    expect(new FailoverChain([{ hop: { provider: "human" } }], { clock }).health().status).toBe(
      "healthy",
    );
    expect(() => new FailoverChain([])).toThrow(RangeError);
  });

  it("fails clearly when no hop is configured", async () => {
    const chain = new FailoverChain([{ hop: TS }]);
    await expect(
      chain.decideBoolean("s", { kind: "boolean", instructions: "?" }, ctx()),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
