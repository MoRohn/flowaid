/**
 * Provider health and the circuit breaker (ARCHITECTURE.md §6.2). Per key (provider, model,
 * credential): a sliding 60 s window of outcomes and latencies. `degraded` at ≥ 5 % errors;
 * the circuit opens (`down`) for 30 s after 5 consecutive retryable failures, or when more than
 * half of at least 10 calls in the window failed. After the cool-down one half-open probe is
 * let through: success closes the circuit, failure opens it again.
 */
import type { ErrorCode, ProviderHealth } from "@flowaid/workflow-core";
import { systemClock, type ProviderClock } from "./signals.js";

export const HEALTH_WINDOW_MS = 60_000;
export const DEGRADED_ERROR_RATE = 0.05;
export const OPEN_AFTER_CONSECUTIVE = 5;
export const OPEN_ERROR_RATE = 0.5;
export const OPEN_MIN_SAMPLES = 10;
export const OPEN_FOR_MS = 30_000;

interface Sample {
  at: number;
  ok: boolean;
  latencyMs: number;
}

type Circuit =
  { state: "closed" } | { state: "open"; until: number } | { state: "half-open"; probing: boolean };

export interface HealthSnapshotListener {
  (key: string, health: ProviderHealth): void;
}

class KeyHealth {
  samples: Sample[] = [];
  consecutiveFailures = 0;
  lastErrorCode?: ErrorCode;
  circuit: Circuit = { state: "closed" };
}

export class HealthTracker {
  private readonly keys = new Map<string, KeyHealth>();

  constructor(
    private readonly clock: ProviderClock = systemClock,
    /** Mirror hook (e.g. Redis) so health is cluster-wide. */
    private readonly onChange?: HealthSnapshotListener,
  ) {}

  private entry(key: string): KeyHealth {
    let entry = this.keys.get(key);
    if (!entry) {
      entry = new KeyHealth();
      this.keys.set(key, entry);
    }
    return entry;
  }

  private prune(entry: KeyHealth): void {
    const cutoff = this.clock.now() - HEALTH_WINDOW_MS;
    while (entry.samples.length > 0 && (entry.samples[0]?.at ?? 0) < cutoff) entry.samples.shift();
  }

  /**
   * May a call go out now? Closed: yes. Open: no, until the cool-down ends, when the circuit
   * turns half-open and exactly one probe is allowed.
   */
  allow(key: string): { allowed: true } | { allowed: false; reopensAt: number } {
    const entry = this.entry(key);
    const circuit = entry.circuit;
    if (circuit.state === "open") {
      if (this.clock.now() < circuit.until) return { allowed: false, reopensAt: circuit.until };
      entry.circuit = { state: "half-open", probing: true };
      return { allowed: true };
    }
    if (circuit.state === "half-open") {
      if (circuit.probing) return { allowed: false, reopensAt: this.clock.now() };
      circuit.probing = true;
      return { allowed: true };
    }
    return { allowed: true };
  }

  record(
    key: string,
    outcome:
      | { ok: true; latencyMs: number }
      | { ok: false; latencyMs: number; code: ErrorCode; retryable: boolean },
  ): void {
    const entry = this.entry(key);
    const now = this.clock.now();
    entry.samples.push({ at: now, ok: outcome.ok, latencyMs: outcome.latencyMs });
    this.prune(entry);
    if (outcome.ok) {
      entry.consecutiveFailures = 0;
      entry.circuit = { state: "closed" };
    } else {
      entry.lastErrorCode = outcome.code;
      // Only retryable failures say something about the provider's health; a 401 or 422 is ours.
      if (outcome.retryable) entry.consecutiveFailures += 1;
      const wasProbe = entry.circuit.state === "half-open";
      const errors = entry.samples.filter((s) => !s.ok).length;
      const rateTrips =
        entry.samples.length >= OPEN_MIN_SAMPLES && errors / entry.samples.length > OPEN_ERROR_RATE;
      if (
        outcome.retryable &&
        (wasProbe || entry.consecutiveFailures >= OPEN_AFTER_CONSECUTIVE || rateTrips)
      ) {
        entry.circuit = { state: "open", until: now + OPEN_FOR_MS };
      } else if (wasProbe) {
        entry.circuit = { state: "closed" };
      }
    }
    this.onChange?.(key, this.health(key));
  }

  health(key: string): ProviderHealth {
    const entry = this.entry(key);
    this.prune(entry);
    const total = entry.samples.length;
    const errors = entry.samples.filter((s) => !s.ok).length;
    const errorRate = total === 0 ? 0 : errors / total;
    const latencies = entry.samples.map((s) => s.latencyMs).sort((a, b) => a - b);
    const p95 =
      latencies.length === 0
        ? 0
        : (latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)] ?? 0);
    const open = entry.circuit.state === "open" && this.clock.now() < entry.circuit.until;
    const health: ProviderHealth = {
      status: open ? "down" : errorRate >= DEGRADED_ERROR_RATE ? "degraded" : "healthy",
      errorRate1m: errorRate,
      p95LatencyMs: p95,
      consecutiveFailures: entry.consecutiveFailures,
      checkedAt: new Date(this.clock.now()).toISOString(),
    };
    if (entry.lastErrorCode !== undefined) health.lastErrorCode = entry.lastErrorCode;
    return health;
  }
}
