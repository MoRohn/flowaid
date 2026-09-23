/**
 * Threshold recommendation (JEV_ENGINEERING.md §7.6).
 *
 * Recommendations are never applied automatically: accepting one creates a contract draft that
 * goes through review and rollout like any other change. Irreversible consequences never get an
 * automation threshold.
 */
import type { ConsequenceClass } from "../wire.js";
import { calibrationMetrics, wilsonLower, type CalibrationObservation } from "./metrics.js";
import type { ThresholdRecommendation } from "./schemas.js";

const TARGETS: Record<
  Exclude<ConsequenceClass, "irreversible">,
  { precision: number; minLabeled: number }
> = {
  low: { precision: 0.95, minLabeled: 100 },
  medium: { precision: 0.98, minLabeled: 200 },
  high: { precision: 0.995, minLabeled: 400 },
};

const MAX_ECE = 0.05;
const MAX_NEAR_MASS = 0.15;
const NEAR_BAND = 0.03;
const IMPROVE_FLOOR_ACCURACY = 0.6;

export interface RecommendInput {
  observations: readonly CalibrationObservation[];
  consequenceClass: ConsequenceClass;
  current: { autoAt: number | null; improveAt: number | null };
  /** The contract declares improve actions (evidence collection), so an improve zone makes sense. */
  hasImproveActions: boolean;
  /** Overrides of the flowaid defaults. */
  target?: { precision?: number; minLabeled?: number; maxEce?: number };
}

function weight(o: CalibrationObservation): number {
  const pi = o.inclusionProbability;
  return pi === undefined || pi === null ? 1 : 1 / pi;
}

function correct(o: CalibrationObservation): number {
  return o.outcome === o.label ? 1 : 0;
}

const round2 = (t: number): number => Math.round(t * 100) / 100;

/** Recommends `autoAt`/`improveAt` for one contract version, environment and consequence class. */
export function recommendThresholds(input: RecommendInput): ThresholdRecommendation {
  const warnings: string[] = [];
  const labeled = input.observations.filter((o) => typeof o.label === "string");
  const decisions = input.observations.length;
  const basis = { labeled: labeled.length, decisions };

  if (input.consequenceClass === "irreversible") {
    return {
      consequenceClass: input.consequenceClass,
      current: input.current,
      recommended: { autoAt: null, improveAt: null },
      target: { precision: 1, minLabeled: 0, maxEce: 0 },
      achieved: null,
      nearThresholdMass: null,
      basis,
      warnings: [
        "Irreversible actions always route to a human; no automation threshold is recommended.",
      ],
    };
  }

  const defaults = TARGETS[input.consequenceClass];
  const target = {
    precision: input.target?.precision ?? defaults.precision,
    minLabeled: input.target?.minLabeled ?? defaults.minLabeled,
    maxEce: input.target?.maxEce ?? MAX_ECE,
  };

  const ece = calibrationMetrics(input.observations).ece;
  const eceOk = ece !== null && ece <= target.maxEce;
  if (!eceOk) {
    warnings.push(
      ece === null
        ? "No labeled decisions: calibration is unknown."
        : `Segment ECE ${ece.toFixed(3)} exceeds ${target.maxEce}; calibrate before automating.`,
    );
  }

  let chosen: {
    t: number;
    precision: number;
    lower95: number;
    coverage: number;
    n: number;
    near: number;
  } | null = null;
  for (let i = 50; i <= 99 && eceOk; i += 1) {
    const t = i / 100;
    const inRegion = labeled.filter((o) => o.confidence >= t);
    if (inRegion.length < target.minLabeled) continue;
    const w = inRegion.reduce((s, o) => s + weight(o), 0);
    const precision = inRegion.reduce((s, o) => s + weight(o) * correct(o), 0) / w;
    const lower95 = wilsonLower(precision, inRegion.length);
    const near =
      decisions > 0
        ? input.observations.filter((o) => o.confidence >= t && o.confidence < t + NEAR_BAND)
            .length / decisions
        : 0;
    if (lower95 >= target.precision && near <= MAX_NEAR_MASS) {
      const coverage =
        decisions > 0 ? input.observations.filter((o) => o.confidence >= t).length / decisions : 0;
      chosen = { t, precision, lower95, coverage, n: inRegion.length, near };
      break;
    }
  }
  if (chosen === null && eceOk) {
    warnings.push(
      `No threshold reaches precision ${target.precision} (Wilson 95% lower bound) with at least ${target.minLabeled} labeled decisions; recommend no automation.`,
    );
  }

  let improveAt: number | null = null;
  if (chosen !== null && input.hasImproveActions) {
    for (let i = Math.round(chosen.t * 100) - 1; i >= 1; i -= 1) {
      const t = i / 100;
      const below = labeled.filter((o) => o.confidence < t);
      if (below.length === 0) continue;
      const w = below.reduce((s, o) => s + weight(o), 0);
      const acc = below.reduce((s, o) => s + weight(o) * correct(o), 0) / w;
      if (acc < IMPROVE_FLOOR_ACCURACY) {
        improveAt = round2(t);
        break;
      }
    }
  }

  return {
    consequenceClass: input.consequenceClass,
    current: input.current,
    recommended: { autoAt: chosen === null ? null : round2(chosen.t), improveAt },
    target,
    achieved:
      chosen === null
        ? null
        : {
            precision: chosen.precision,
            lower95: chosen.lower95,
            coverage: chosen.coverage,
            n: chosen.n,
          },
    nearThresholdMass: chosen?.near ?? null,
    basis,
    warnings,
  };
}
