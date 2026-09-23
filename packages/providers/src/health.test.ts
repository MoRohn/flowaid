import { describe, expect, it } from "vitest";
import { HEALTH_WINDOW_MS, HealthTracker, OPEN_FOR_MS } from "./health.js";
import { RateLimiter, TokenBucket } from "./rateLimit.js";
import { FakeClock } from "./test/fakes.js";

const fail = {
  ok: false as const,
  latencyMs: 100,
  code: "PROVIDER_ERROR" as const,
  retryable: true,
};
const ok = (latencyMs = 50) => ({ ok: true as const, latencyMs });

describe("HealthTracker", () => {
  it("is healthy, then degraded at 5 % errors", () => {
    const h = new HealthTracker(new FakeClock());
    for (let i = 0; i < 19; i += 1) h.record("k", ok());
    expect(h.health("k").status).toBe("healthy");
    h.record("k", fail);
    expect(h.health("k")).toMatchObject({
      status: "degraded",
      errorRate1m: 0.05,
      lastErrorCode: "PROVIDER_ERROR",
    });
  });

  it("opens the circuit after 5 consecutive retryable failures, for 30 s", () => {
    const clock = new FakeClock();
    const h = new HealthTracker(clock);
    for (let i = 0; i < 4; i += 1) h.record("k", fail);
    expect(h.allow("k").allowed).toBe(true);
    h.record("k", fail);
    expect(h.health("k").status).toBe("down");
    expect(h.allow("k")).toEqual({ allowed: false, reopensAt: clock.now() + OPEN_FOR_MS });
    clock.advance(OPEN_FOR_MS - 1);
    expect(h.allow("k").allowed).toBe(false);
  });

  it("ignores non-retryable failures for the circuit", () => {
    const h = new HealthTracker(new FakeClock());
    for (let i = 0; i < 10; i += 1)
      h.record("k", { ...fail, code: "CREDENTIAL_ERROR", retryable: false });
    expect(h.allow("k").allowed).toBe(true);
    expect(h.health("k").consecutiveFailures).toBe(0);
  });

  it("opens when more than half of at least 10 calls failed", () => {
    const h = new HealthTracker(new FakeClock());
    for (let i = 0; i < 4; i += 1) h.record("k", ok());
    for (let i = 0; i < 4; i += 1) h.record("k", fail);
    h.record("k", ok());
    for (let i = 0; i < 4; i += 1) h.record("k", fail);
    expect(h.health("k").status).toBe("down");
  });

  it("lets exactly one half-open probe through; success closes, failure reopens", () => {
    const clock = new FakeClock();
    const h = new HealthTracker(clock);
    for (let i = 0; i < 5; i += 1) h.record("k", fail);
    clock.advance(OPEN_FOR_MS);
    expect(h.allow("k").allowed).toBe(true);
    expect(h.allow("k").allowed).toBe(false);
    h.record("k", fail);
    expect(h.allow("k").allowed).toBe(false);
    clock.advance(OPEN_FOR_MS);
    expect(h.allow("k").allowed).toBe(true);
    h.record("k", ok());
    expect(h.allow("k").allowed).toBe(true);
    expect(h.allow("k").allowed).toBe(true);
  });

  it("forgets samples older than the window and reports p95 latency", () => {
    const clock = new FakeClock();
    const h = new HealthTracker(clock);
    for (let i = 1; i <= 20; i += 1) h.record("k", ok(i * 10));
    expect(h.health("k").p95LatencyMs).toBe(190);
    clock.advance(HEALTH_WINDOW_MS + 1);
    expect(h.health("k")).toMatchObject({ errorRate1m: 0, p95LatencyMs: 0 });
  });

  it("mirrors every change", () => {
    const seen: string[] = [];
    const h = new HealthTracker(new FakeClock(), (key, health) =>
      seen.push(`${key}:${health.status}`),
    );
    h.record("k", ok());
    expect(seen).toEqual(["k:healthy"]);
  });
});

describe("TokenBucket", () => {
  it("allows a burst of one minute's rate, then waits for refill", async () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket(60, clock);
    for (let i = 0; i < 60; i += 1) await bucket.take();
    const before = clock.now();
    await bucket.take();
    expect(clock.now() - before).toBe(1000);
  });

  it("stops waiting when cancelled", async () => {
    const bucket = new TokenBucket(1, {
      now: () => 0,
      sleep: () => Promise.reject(new Error("aborted")),
    });
    await bucket.take();
    await expect(bucket.take(new AbortController().signal)).rejects.toMatchObject({
      code: "CANCELLED_ERROR",
    });
    const aborted = new AbortController();
    aborted.abort();
    await expect(bucket.take(aborted.signal)).rejects.toMatchObject({ code: "CANCELLED_ERROR" });
  });

  it("rejects a non-positive rate and reuses buckets per key", () => {
    expect(() => new TokenBucket(0)).toThrow(RangeError);
    const limiter = new RateLimiter(new FakeClock());
    expect(limiter.bucket("a", 10)).toBe(limiter.bucket("a", 10));
    expect(limiter.bucket("a", 10).available()).toBe(10);
  });
});
