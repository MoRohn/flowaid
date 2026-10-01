/**
 * Counters behind the login throttles and the webhook replay cache (P3-3). In local mode they
 * live in this process; with `REDIS_URL` they live in Redis, so the limits hold across every api
 * replica. The global request rate limit (`plugins/rateLimit.ts`) uses the same Redis client
 * through `@fastify/rate-limit`'s own Redis store.
 */
import { Redis } from "ioredis";

export interface LimitStore {
  /** `memory` (this process) or `redis` (shared by every replica). */
  readonly kind: "memory" | "redis";
  /** The Redis client and key prefix, for `@fastify/rate-limit`; absent in memory. */
  readonly shared?: { redis: Redis; prefix: string };
  /** Counts a hit in `key`'s fixed window of `windowMs`; returns the hits so far, this one included. */
  hit(key: string, windowMs: number): Promise<number>;
  /** Forgets `key`'s window. */
  reset(key: string): Promise<void>;
  /** Remembers `key` for `ttlMs`; false when it is already remembered (a replay). */
  claimOnce(key: string, ttlMs: number): Promise<boolean>;
  close(): Promise<void>;
}

const MAX_KEYS = 50_000;

export class MemoryLimitStore implements LimitStore {
  readonly kind = "memory" as const;
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly claims = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  hit(key: string, windowMs: number): Promise<number> {
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || w.resetAt <= t) {
      if (this.windows.size > MAX_KEYS)
        for (const [k, v] of this.windows) if (v.resetAt <= t) this.windows.delete(k);
      this.windows.set(key, { count: 1, resetAt: t + windowMs });
      return Promise.resolve(1);
    }
    w.count++;
    return Promise.resolve(w.count);
  }

  reset(key: string): Promise<void> {
    this.windows.delete(key);
    return Promise.resolve();
  }

  claimOnce(key: string, ttlMs: number): Promise<boolean> {
    const t = this.now();
    if (this.claims.size > MAX_KEYS)
      for (const [k, exp] of this.claims) if (exp <= t) this.claims.delete(k);
    const exp = this.claims.get(key);
    if (exp !== undefined && exp > t) return Promise.resolve(false);
    this.claims.set(key, t + ttlMs);
    return Promise.resolve(true);
  }

  close(): Promise<void> {
    this.windows.clear();
    this.claims.clear();
    return Promise.resolve();
  }
}

/** INCR, and start the window on the first hit (atomic, so a crash never leaves a key without a TTL). */
const HIT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 or redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return count
`;

export class RedisLimitStore implements LimitStore {
  readonly kind = "redis" as const;
  readonly shared: { redis: Redis; prefix: string };

  constructor(
    private readonly redis: Redis,
    private readonly prefix = "flowaid:limits:",
  ) {
    this.shared = { redis, prefix };
  }

  /** A client for `url` that fails a command after two retries instead of queueing it forever. */
  static connect(url: string, prefix?: string): RedisLimitStore {
    return new RedisLimitStore(new Redis(url, { maxRetriesPerRequest: 2 }), prefix);
  }

  async hit(key: string, windowMs: number): Promise<number> {
    return Number(await this.redis.eval(HIT, 1, this.prefix + key, String(windowMs)));
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(this.prefix + key);
  }

  async claimOnce(key: string, ttlMs: number): Promise<boolean> {
    return (await this.redis.set(this.prefix + key, "1", "PX", ttlMs, "NX")) === "OK";
  }

  async close(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

/** Fixed-window counters for login throttling, in the shared store when there is one. */
export class Throttle {
  constructor(
    private readonly store: LimitStore,
    private readonly name: string,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Counts a hit; false when the key is over its limit for the current window. */
  async hit(key: string): Promise<boolean> {
    return (await this.store.hit(`throttle:${this.name}:${key}`, this.windowMs)) <= this.limit;
  }

  reset(key: string): Promise<void> {
    return this.store.reset(`throttle:${this.name}:${key}`);
  }
}
