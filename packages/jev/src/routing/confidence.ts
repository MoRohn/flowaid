/**
 * Routing confidence per primitive (JEV_ENGINEERING.md §6.2, handbook §II, §V.A).
 *
 * | Primitive          | Outcome                                  | Confidence `c`            | Margin `m`         |
 * |--------------------|------------------------------------------|---------------------------|--------------------|
 * | Choice             | option key                               | provider confidence       | p(1) − p(2)        |
 * | Boolean (Noul)     | `true` iff pYes ≥ yesAt                  | max(pYes, 1 − pYes)       | —                  |
 * | Score with bands   | band with the largest mass Σ p_l         | M_selected                | M(1) − M(2)        |
 * | Score without bands| level = round(value) (a measurement)     | provider confidence       | —                  |
 *
 * `ScoreDecision.normalized` is a display position only (§II.B): nothing here reads it.
 */
import type { DecisionResult } from "@flowaid/workflow-core";
import { escapeOf, type DecisionContractBody, type EscapeKind } from "../contract.js";

/** The routable reading of one decision under a contract. */
export interface RoutingSignal {
  /** Option key | band port | 'true' | 'false' | level index (unbanded score). */
  outcome: string;
  escape: EscapeKind | null;
  /** Routing confidence `c` in [0, 1]. */
  confidence: number;
  /** Top-1 minus top-2 probability (or band mass); null when not defined. */
  margin: number | null;
  /** Full distribution keyed as the provider answered (option keys, 'true'/'false', '0'..'n-1'). */
  distribution: Record<string, number>;
  /** Band masses for banded scores, else null. */
  bandMass: Record<string, number> | null;
  /** True when the outcome is a measurement that cannot fire an auto port (unbanded score). */
  measurement: boolean;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Top-1 minus top-2 of a set of probabilities (0 when fewer than two entries … the single mass). */
export function topMargin(probabilities: Record<string, number>): number {
  const sorted = Object.values(probabilities).sort((a, b) => b - a);
  const first = sorted[0] ?? 0;
  const second = sorted[1] ?? 0;
  return clamp01(first - second);
}

/** Mass per score band: `M_b = Σ_{l ∈ b} p_l` (probabilities keyed "0".."n-1"). */
export function bandMasses(
  probabilities: Record<string, number>,
  bands: ReadonlyArray<{ port: string; minLevel: number; maxLevel: number }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const band of bands) {
    let mass = 0;
    for (let level = band.minLevel; level <= band.maxLevel; level += 1)
      mass += probabilities[String(level)] ?? 0;
    out[band.port] = clamp01(mass);
  }
  return out;
}

/**
 * Reads a `DecisionResult` under a contract (§6.2). Throws when the decision's kind does not
 * match the contract's question kind (the runtime validates that before routing).
 */
export function routingSignal(body: DecisionContractBody, decision: DecisionResult): RoutingSignal {
  const q = body.question;
  if (q.kind !== decision.kind) {
    throw new TypeError(
      `${body.key}@${body.version} is a ${q.kind} contract but the decision is ${decision.kind}`,
    );
  }
  switch (decision.kind) {
    case "choice":
      return {
        outcome: decision.value,
        escape: escapeOf(body, decision.value),
        confidence: clamp01(decision.confidence),
        margin: topMargin(decision.probabilities),
        distribution: { ...decision.probabilities },
        bandMass: null,
        measurement: false,
      };
    case "boolean": {
      const yesAt = q.kind === "boolean" ? q.yesAt : 0.5;
      const pYes = clamp01(decision.pYes);
      return {
        outcome: pYes >= yesAt ? "true" : "false",
        escape: null,
        confidence: Math.max(pYes, 1 - pYes),
        margin: null,
        distribution: { true: pYes, false: clamp01(1 - pYes) },
        bandMass: null,
        measurement: false,
      };
    }
    case "score": {
      const bands = q.kind === "score" ? q.bands : undefined;
      if (!bands) {
        return {
          outcome: String(Math.round(decision.value)),
          escape: null,
          confidence: clamp01(decision.confidence),
          margin: null,
          distribution: { ...decision.probabilities },
          bandMass: null,
          measurement: true,
        };
      }
      const mass = bandMasses(decision.probabilities, bands);
      let best = bands[0]?.port ?? "";
      for (const band of bands) if ((mass[band.port] ?? 0) > (mass[best] ?? 0)) best = band.port;
      return {
        outcome: best,
        escape: null,
        confidence: mass[best] ?? 0,
        margin: topMargin(mass),
        distribution: { ...decision.probabilities },
        bandMass: mass,
        measurement: false,
      };
    }
  }
}
