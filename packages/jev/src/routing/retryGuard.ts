/**
 * The blind-retry guard (JEV_ENGINEERING.md §6.5, handbook §IV.D, §V.B, §X.E): *"repeating the
 * same uncertain question against the same state is not learning"*. A decision whose key —
 * `sha256Json({ contractHash, packetHash, optionSetVersion })` — was already evaluated in its
 * lineage makes no provider call and routes human with `blind_retry_blocked`.
 *
 * Transport retries (rate limits, overload, timeouts) obtained no answer and are not semantic
 * retries: they may repeat the same key.
 */
import { lineageOf } from "../ids.js";
import { hashJson } from "../json.js";

/** What makes two evaluations the same question over the same evidence. */
export interface BlindRetryKeyInput {
  contractHash: string;
  packetHash: string;
  /** Option-set version for dynamic menus; null for static menus, scores and booleans. */
  optionSetVersion: string | null;
}

/** `sha256Json({ contractHash, packetHash, optionSetVersion })`. */
export function blindRetryKey(input: BlindRetryKeyInput): string {
  return hashJson({
    contractHash: input.contractHash,
    packetHash: input.packetHash,
    optionSetVersion: input.optionSetVersion,
  });
}

/** An earlier evaluation recorded in a lineage. */
export interface PriorEvaluation<T> {
  key: string;
  /** The earlier result (distribution) reused on a blocked retry. */
  result: T;
}

/**
 * In-memory guard over lineages (the runtime keeps the same map in `SchedulerState.jev`).
 * `check` before calling the provider; `record` after a semantic answer.
 */
export class BlindRetryGuard<T> {
  readonly #seen = new Map<string, Map<string, T>>();

  /** The earlier result when `key` was already evaluated in the lineage of (nodeId, scope). */
  check(nodeId: string, scope: string, key: string): PriorEvaluation<T> | null {
    const lineage = this.#seen.get(lineageOf(nodeId, scope));
    if (!lineage?.has(key)) return null;
    const result = lineage.get(key);
    return result === undefined ? null : { key, result };
  }

  /** Records a semantic evaluation (never a transport failure). */
  record(nodeId: string, scope: string, key: string, result: T): void {
    const id = lineageOf(nodeId, scope);
    const lineage = this.#seen.get(id) ?? new Map<string, T>();
    lineage.set(key, result);
    this.#seen.set(id, lineage);
  }

  /** Number of distinct evaluations recorded in a lineage. */
  rounds(nodeId: string, scope: string): number {
    return this.#seen.get(lineageOf(nodeId, scope))?.size ?? 0;
  }
}
