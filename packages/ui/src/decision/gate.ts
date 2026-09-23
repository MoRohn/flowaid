/**
 * Gate outcome presentation shared by the confidence visualisations. The
 * semantics are ARCHITECTURE.md §6.3 (`pass | review | fail`); the UI's
 * two-threshold model (`review` floor, `auto` = pass threshold) maps onto the
 * runtime's `threshold` / `reviewBand` through `thresholdsFromGate` and
 * `gateFromThresholds` in `@/types`.
 */
import { gateOutcome, type ConfidenceThresholds, type GateOutcome } from "@/types";

export type GateTone = "ok" | "accent" | "warn";

export const GATE_LABEL: Record<GateOutcome, string> = {
  pass: "Pass",
  review: "Review",
  fail: "Fail",
};

/** Pass is green (it goes through), review is cobalt (a second look), fail is amber (the run routes away). */
export const GATE_TONE: Record<GateOutcome, GateTone> = {
  pass: "ok",
  review: "accent",
  fail: "warn",
};

/** Strong colour token for an outcome. */
export function gateColorVar(outcome: GateOutcome): string {
  return outcome === "review" ? "var(--accent)" : `var(--${GATE_TONE[outcome]})`;
}

/** Soft (background) colour token for an outcome. */
export function gateSoftVar(outcome: GateOutcome): string {
  return outcome === "review" ? "var(--accent-soft)" : `var(--${GATE_TONE[outcome]}-soft)`;
}

/** Two-way (no fail zone, `review` floor at 0) or three-way. */
export type GateModel = "two-way" | "three-way";

export function gateModel(t: ConfidenceThresholds): GateModel {
  return t.review > 0 ? "three-way" : "two-way";
}

/** Sentence used in tooltips and aria labels: "0.83 → review (0.60–0.90)". */
export function gateDescription(confidence: number, t: ConfidenceThresholds): string {
  const o = gateOutcome(confidence, t);
  const range =
    o === "pass"
      ? `≥ ${t.auto.toFixed(2)}`
      : o === "review"
        ? `${t.review.toFixed(2)}–${t.auto.toFixed(2)}`
        : `< ${t.review.toFixed(2)}`;
  return `${confidence.toFixed(2)} → ${GATE_LABEL[o].toLowerCase()} (${range})`;
}

/** Outcomes from the bottom of the scale to the top. */
export const GATE_ORDER: GateOutcome[] = ["fail", "review", "pass"];

/** Clamp thresholds into [0, 1] without reordering them. */
export function clampThresholds(t: ConfidenceThresholds): ConfidenceThresholds {
  const c = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
  return { review: c(t.review), auto: c(t.auto) };
}

/** Validation message for a threshold pair, or null when valid. A review floor of 0 (two-way gate) is valid. */
export function validateThresholds(t: ConfidenceThresholds): string | null {
  if (!Number.isFinite(t.review) || !Number.isFinite(t.auto))
    return "Both thresholds are required.";
  if (t.review < 0 || t.review > 1 || t.auto < 0 || t.auto > 1)
    return "Thresholds must be between 0 and 1.";
  if (t.auto <= 0) return "The pass threshold must be above 0.";
  if (t.review >= t.auto) return "The review floor must be below the pass threshold.";
  return null;
}

/** Share of `confidences` that each outcome would receive under `t`. */
export function gateShares(
  confidences: readonly number[],
  t: ConfidenceThresholds,
): Record<GateOutcome, number> {
  const counts: Record<GateOutcome, number> = { pass: 0, review: 0, fail: 0 };
  let n = 0;
  for (const c of confidences) {
    if (!Number.isFinite(c)) continue;
    counts[gateOutcome(c, t)] += 1;
    n += 1;
  }
  if (n === 0) return counts;
  return { pass: counts.pass / n, review: counts.review / n, fail: counts.fail / n };
}

/** Histogram of confidences over [0, 1] in `binCount` equal bins. The last bin is closed at 1. */
export function histogramBins(confidences: readonly number[], binCount = 20): number[] {
  const bins = new Array<number>(Math.max(1, binCount)).fill(0);
  for (const c of confidences) {
    if (!Number.isFinite(c)) continue;
    const v = Math.min(1, Math.max(0, c));
    const i = Math.min(bins.length - 1, Math.floor(v * bins.length));
    bins[i] = (bins[i] ?? 0) + 1;
  }
  return bins;
}
