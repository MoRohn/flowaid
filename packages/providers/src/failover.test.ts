import {
  CredentialError,
  NetworkError,
  ProviderError,
  ProviderOverloadedError,
  ProviderRateLimitedError,
  TimeoutError,
  type ProviderHop,
} from "@flowaid/workflow-core";
import { describe, expect, it, vi } from "vitest";
import { FailoverChain, advancesChain, hopLabel } from "./failover.js";
import { HealthTracker } from "./health.js";
import { CircuitOpenError, HumanFallbackSignal } from "./signals.js";
import { FakeClock, ctx, scriptedDecider } from "./test/fakes.js";

const Q = { kind: "boolean" as const, instructions: "Is it urgent?" };
const TS: ProviderHop = { provider: "typesafe", model: "jev-latest" };
const LLM: ProviderHop = { provider: "llm", model: { provider: "openai", model: "gpt-4.1-mini" } };

describe("advancesChain", () => {
  it.each([
    [new ProviderError("x", true, "p"), true],
    [new ProviderRateLimitedError("p"), true],
    [new ProviderOverloadedError("p"), true],
    [new TimeoutError("t"), true],
    [new NetworkError("n"), true],
    [new CircuitOpenError("p", 0), true],
    [new ProviderError("x", false, "p"), false],
    [new CredentialError("401"), false],
  ])("%s → %s", (error, advances) => {
    expect(advancesChain(error)).toBe(advances);
  });
});

describe("FailoverChain", () => {
  it("returns the primary's answer with one ok attempt", async () => {
    const clock = new FakeClock();
    const primary = scriptedDecider("typesafe", [0.9], clock, 15);
    const chain = new FailoverChain([{ hop: TS, provider: primary }], { clock });
    const result = await chain.decideBoolean("s", Q, ctx());
    expect(result.value).toBe(true);
    expect(result.attempts).toEqual([
      { provider: "typesafe", model: "typesafe-model", outcome: "ok", latencyMs: 15 },
    ]);
  });

  it.each([
    ["retryable provider error", new ProviderError("down", true, "typesafe")],
    ["rate limit", new ProviderRateLimitedError("typesafe", 1000)],
    ["overload", new ProviderOverloadedError("typesafe")],
    ["timeout", new TimeoutError("slow")],
    ["network", new NetworkError("reset")],
  ])("hands over to the next hop on a %s and records both attempts", async (_label, error) => {
    const clock = new FakeClock();
    const onFailover = vi.fn();
    const chain = new FailoverChain(
      [
        { hop: TS, provider: scriptedDecider("typesafe", [error], clock, 25) },
        { hop: LLM, provider: scriptedDecider("llm", [0.2], clock, 40) },
      ],
      { clock, onFailover },
    );
    const result = await chain.decideBoolean("s", Q, ctx());
    expect(result.provider).toBe("llm");
    expect(result.attempts.map((a) => [a.provider, a.outcome, a.errorCode, a.latencyMs])).toEqual([
      ["typesafe", "error", error.code, 25],
      ["llm", "ok", undefined, 40],
    ]);
    expect(onFailover).toHaveBeenCalledWith({
      from: "typesafe/jev-latest",
      to: "llm/openai/gpt-4.1-mini",
      error,
    });
  });

  it.each([
    ["an invalid credential", new CredentialError("401")],
    ["a rejected request", new ProviderError("422 invalid criteria", false, "typesafe")],
  ])("fails fast on %s and never calls the next hop", async (_label, error) => {
    const next = scriptedDecider("llm", [0.2]);
    const chain = new FailoverChain([
      { hop: TS, provider: scriptedDecider("typesafe", [error]) },
      { hop: LLM, provider: next },
    ]);
    await expect(chain.decideBoolean("s", Q, ctx())).rejects.toBe(error);
    expect(next.calls).toBe(0);
  });

  it("skips a hop whose circuit is open as skipped_unhealthy", async () => {
    const clock = new FakeClock();
    const health = new HealthTracker(clock);
    for (let i = 0; i < 5; i += 1)
      health.record("typesafe/typesafe-model", {
        ok: false,
        latencyMs: 1,
        code: "PROVIDER_ERROR",
        retryable: true,
      });
    const primary = scriptedDecider("typesafe", [0.9]);
    const chain = new FailoverChain(
      [
        { hop: TS, provider: primary },
        { hop: LLM, provider: scriptedDecider("llm", [0.1]) },
      ],
      { health, clock },
    );
    const result = await chain.decideBoolean("s", Q, ctx());
    expect(primary.calls).toBe(0);
    expect(result.attempts.map((a) => a.outcome)).toEqual(["skipped_unhealthy", "ok"]);
  });

  it("warns and skips a rule hop without rules and an unconfigured hop", async () => {
    const warn = vi.fn();
    const chain = new FailoverChain(
      [
        { hop: { provider: "rule" }, skipReason: "the node has no rules" },
        { hop: LLM },
        { hop: TS, provider: scriptedDecider("typesafe", [0.7]) },
      ],
      { warn },
    );
    expect((await chain.decideBoolean("s", Q, ctx())).provider).toBe("typesafe");
    expect(warn.mock.calls.map((c) => c[0])).toEqual([
      "Skipping decision hop rule: the node has no rules",
      "Skipping decision hop llm/openai/gpt-4.1-mini: not configured",
    ]);
  });

  it("hands the decision to a person when every provider failed", async () => {
    const chain = new FailoverChain([
      { hop: TS, provider: scriptedDecider("typesafe", [new ProviderOverloadedError("typesafe")]) },
      { hop: { provider: "human" } },
    ]);
    const signal = await chain.decideBoolean("s", Q, ctx()).catch((e: unknown) => e);
    expect(signal).toBeInstanceOf(HumanFallbackSignal);
    expect((signal as HumanFallbackSignal).attempts.map((a) => a.outcome)).toEqual(["error"]);
  });

  it("throws the last error when the whole chain failed", async () => {
    const last = new NetworkError("second");
    const chain = new FailoverChain([
      { hop: TS, provider: scriptedDecider("typesafe", [new NetworkError("first")]) },
      { hop: LLM, provider: scriptedDecider("llm", [last]) },
    ]);
    await expect(chain.decideBoolean("s", Q, ctx())).rejects.toBe(last);
  });

  it("attaches the walked attempts to every answer of a batch", async () => {
    const chain = new FailoverChain([
      { hop: TS, provider: scriptedDecider("typesafe", [new NetworkError("x")]) },
      { hop: LLM, provider: scriptedDecider("llm", [0.6, 0.3]) },
    ]);
    const { answers } = await chain.batch("s", { a: Q, b: Q }, ctx());
    for (const answer of Object.values(answers))
      expect(answer.attempts.map((a) => a.outcome)).toEqual(["error", "ok"]);
  });

  it("labels every hop kind", () => {
    expect(
      [
        TS,
        LLM,
        { provider: "rule" },
        { provider: "human" },
        { provider: "custom", id: "acme" },
      ].map((h) => hopLabel(h as ProviderHop)),
    ).toEqual(["typesafe/jev-latest", "llm/openai/gpt-4.1-mini", "rule", "human", "custom/acme"]);
  });
});
