import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { testRedisUrl } from "@flowaid/env/testing";
import { MemoryLimitStore, RedisLimitStore, Throttle, type LimitStore } from "./limits.js";

describe("MemoryLimitStore", () => {
  it("counts hits in a fixed window and starts a new one when it ends", async () => {
    let t = 0;
    const store = new MemoryLimitStore(() => t);
    expect(await store.hit("k", 1_000)).toBe(1);
    expect(await store.hit("k", 1_000)).toBe(2);
    t = 1_000;
    expect(await store.hit("k", 1_000)).toBe(1);
    await store.reset("k");
    expect(await store.hit("k", 1_000)).toBe(1);
  });

  it("accepts a claim once until it expires", async () => {
    let t = 0;
    const store = new MemoryLimitStore(() => t);
    expect(await store.claimOnce("sig", 500)).toBe(true);
    expect(await store.claimOnce("sig", 500)).toBe(false);
    t = 500;
    expect(await store.claimOnce("sig", 500)).toBe(true);
  });
});

describe("Throttle", () => {
  it("refuses hits over the limit and forgets a key on reset", async () => {
    const throttle = new Throttle(new MemoryLimitStore(() => 0), "login", 2, 60_000);
    expect(await throttle.hit("a")).toBe(true);
    expect(await throttle.hit("a")).toBe(true);
    expect(await throttle.hit("a")).toBe(false);
    expect(await throttle.hit("b")).toBe(true);
    await throttle.reset("a");
    expect(await throttle.hit("a")).toBe(true);
  });
});

const redisUrl = testRedisUrl();

describe.runIf(Boolean(redisUrl))("RedisLimitStore (two api processes)", () => {
  // Two clients over one prefix stand for two api replicas; the prefix keeps runs apart.
  const prefix = `flowaid:test:${randomBytes(6).toString("hex")}:`;
  const stores: LimitStore[] = [];
  const replica = () => {
    const store = RedisLimitStore.connect(redisUrl as string, prefix);
    stores.push(store);
    return store;
  };
  afterAll(async () => {
    const [first] = stores;
    if (first?.shared) {
      const keys = await first.shared.redis.keys(`${prefix}*`);
      if (keys.length) await first.shared.redis.del(...keys);
    }
    await Promise.all(stores.map((s) => s.close()));
  });

  it("shares one window between replicas", async () => {
    const a = replica();
    const b = replica();
    expect(await a.hit("w", 60_000)).toBe(1);
    expect(await b.hit("w", 60_000)).toBe(2);
    expect(await a.hit("w", 60_000)).toBe(3);
    await b.reset("w");
    expect(await a.hit("w", 60_000)).toBe(1);
  });

  it("expires a window by its TTL", async () => {
    const a = replica();
    expect(await a.hit("short", 500)).toBe(1);
    expect(await a.hit("short", 500)).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(await a.hit("short", 500)).toBe(1);
    const ttl = await a.shared?.redis.pttl(`${prefix}short`);
    expect(ttl).toBeGreaterThan(0);
  });

  it("throttles logins across replicas", async () => {
    const a = new Throttle(replica(), "login-email", 3, 60_000);
    const b = new Throttle(replica(), "login-email", 3, 60_000);
    const results = [
      await a.hit("x@y"),
      await b.hit("x@y"),
      await a.hit("x@y"),
      await b.hit("x@y"),
    ];
    expect(results).toEqual([true, true, true, false]);
  });

  it("accepts a webhook signature on one replica only", async () => {
    const a = replica();
    const b = replica();
    const claims = await Promise.all(
      Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).claimOnce("replay:sig", 60_000)),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
});
