/**
 * Provider-layer signals and the clock abstraction every timing-sensitive component takes, so
 * failover, health and rate limiting are tested exactly with a fake clock.
 */
import { ProviderError, type ProviderAttempt } from "@flowaid/workflow-core";

/** Time source: `now()` in epoch ms and a cancellable `sleep`. */
export interface ProviderClock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const systemClock: ProviderClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason instanceof Error ? signal.reason : new Error("aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
};

/**
 * Thrown by a failover chain that reached its `human` hop after every provider failed. The
 * decision node turns it into `NodeResult.suspend` (ARCHITECTURE.md §3.2); `attempts` is the
 * chain walked so far, for the trace.
 */
export class HumanFallbackSignal extends Error {
  override readonly name = "HumanFallbackSignal";
  constructor(readonly attempts: readonly ProviderAttempt[]) {
    super("Every decision provider failed; a person decides");
  }
}

/** A provider's circuit is open: the chain skips the hop (`skipped_unhealthy`) without calling it. */
export class CircuitOpenError extends ProviderError {
  constructor(
    provider: string,
    readonly reopensAt: number,
  ) {
    super(`${provider} is unhealthy; its circuit is open`, true, provider);
  }
}
