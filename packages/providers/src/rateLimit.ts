/**
 * Token bucket per credential (ARCHITECTURE.md §6.2). When the bucket is empty a call waits for
 * the next token (up to its signal) instead of hitting the provider's 429.
 */
import { CancelledError } from "@flowaid/workflow-core";
import { systemClock, type ProviderClock } from "./signals.js";

export class TokenBucket {
  private tokens: number;
  private updatedAt: number;
  private readonly perMs: number;

  constructor(
    /** Requests per minute; also the burst size. */
    readonly ratePerMinute: number,
    private readonly clock: ProviderClock = systemClock,
  ) {
    if (!(ratePerMinute > 0)) throw new RangeError("ratePerMinute must be positive");
    this.tokens = ratePerMinute;
    this.updatedAt = clock.now();
    this.perMs = ratePerMinute / 60_000;
  }

  private refill(): void {
    const now = this.clock.now();
    this.tokens = Math.min(this.ratePerMinute, this.tokens + (now - this.updatedAt) * this.perMs);
    this.updatedAt = now;
  }

  /** Takes one token, waiting for it when necessary. */
  async take(signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted)
        throw new CancelledError("Cancelled while waiting for the provider rate limit");
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil((1 - this.tokens) / this.perMs);
      try {
        await this.clock.sleep(waitMs, signal);
      } catch {
        throw new CancelledError("Cancelled while waiting for the provider rate limit");
      }
    }
  }

  /** Tokens available right now (for health endpoints). */
  available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

/** One bucket per key (credential id), created on first use. */
export class RateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(private readonly clock: ProviderClock = systemClock) {}

  bucket(key: string, ratePerMinute: number): TokenBucket {
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.ratePerMinute !== ratePerMinute) {
      bucket = new TokenBucket(ratePerMinute, this.clock);
      this.buckets.set(key, bucket);
    }
    return bucket;
  }
}
