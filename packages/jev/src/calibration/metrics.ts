/**
 * Calibration metrics (JEV_ENGINEERING.md §7.2).
 *
 * Every aggregate over labeled receipts is weighted by `1/π` (Horvitz–Thompson), where `π` is the
 * inclusion probability with which the receipt reached a labeler, so oversampling rare,
 * consequential and near-threshold cases sharpens the boundary without biasing the totals.
 * Operational rates (route shares, escapes, overrides) are over all decisions, unweighted.
 */
import type { JevRoute } from "../wire.js";
import type { CalibrationMetrics, ReliabilityBin } from "./schemas.js";

/** One decision as calibration sees it: the receipt facts plus its agreed label, if any. */
export interface CalibrationObservation {
  kind: "boolean" | "choice" | "score";
  /** Routing confidence `c_i` in [0,1]. */
  confidence: number;
  /** Predicted outcome (option key | 'true'/'false' | band port | level index). */
  outcome: string | null;
  /** Full distribution. Boolean: `{ true: pYes, false: 1 − pYes }`; score: keys "0".."n−1". */
  distribution: Readonly<Record<string, number>>;
  route: JevRoute;
  /** Agreed label; `null`/absent = unlabeled. Disputed receipts must be passed unlabeled (see `adjudicate`). */
  label?: string | null;
  /** Dual label: the route the case should have taken. */
  permittedRoute?: JevRoute | null;
  /** Inclusion probability `π` when the label came through sampling; absent/null = 1. */
  inclusionProbability?: number | null;
  escape?: boolean;
  override?: boolean;
  staleOption?: boolean;
  blindRetryBlocked?: boolean;
}

export interface CalibrationOptions {
  /** Automation threshold of the segment, for near-threshold mass. */
  autoAt?: number | null;
  /** δ of §7.2 (default 0.03). */
  nearThresholdBand?: number;
  /** Baseline 10-bin confidence histogram counts, for PSI. */
  baselineHistogram?: readonly number[] | null;
  /** Monotonicity result from the latest contract test (fixture ladders). */
  monotonicity?: { ladders: number; violations: number } | null;
  /** Inter-rater disagreement from `interRaterDisagreement`. */
  interRaterDisagreement?: number | null;
}

const BINS = 10;
const PSI_EPSILON = 1e-4;
const MCE_MIN_LABELS = 10;

interface Weighted {
  c: number;
  y: number;
  w: number;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function binIndex(c: number): number {
  return Math.min(BINS - 1, Math.floor(clamp01(c) * BINS));
}

function weightOf(o: CalibrationObservation): number {
  const pi = o.inclusionProbability;
  if (pi === undefined || pi === null) return 1;
  if (!(pi > 0)) throw new RangeError("inclusionProbability must be > 0 for a labeled receipt");
  return 1 / pi;
}

function isLabeled(o: CalibrationObservation): o is CalibrationObservation & { label: string } {
  return typeof o.label === "string";
}

/** Probability the observation assigned to `key` (0 when absent). */
function prob(o: CalibrationObservation, key: string): number {
  return clamp01(o.distribution[key] ?? 0);
}

/**
 * The pair calibration scores for one labeled observation. Noul is measured on raw `pYes` against
 * `label = true` (§V.D); choice and score on the routing confidence against top-label correctness.
 */
function scored(o: CalibrationObservation & { label: string }): Weighted {
  if (o.kind === "boolean") {
    return { c: prob(o, "true"), y: o.label === "true" ? 1 : 0, w: weightOf(o) };
  }
  return { c: clamp01(o.confidence), y: o.outcome === o.label ? 1 : 0, w: weightOf(o) };
}

/** 10 equal-width reliability bins over [0,1]: weighted mean confidence and accuracy per bin. */
export function reliabilityBins(points: readonly Weighted[]): ReliabilityBin[] {
  const acc = Array.from({ length: BINS }, (_, i) => ({
    lo: i / BINS,
    hi: (i + 1) / BINS,
    w: 0,
    n: 0,
    wc: 0,
    wy: 0,
  }));
  for (const p of points) {
    const b = acc[binIndex(p.c)];
    if (b === undefined) continue;
    b.w += p.w;
    b.n += 1;
    b.wc += p.w * p.c;
    b.wy += p.w * p.y;
  }
  return acc.map((b) => ({
    lo: b.lo,
    hi: b.hi,
    weight: b.w,
    labeled: b.n,
    meanConfidence: b.w > 0 ? b.wc / b.w : null,
    accuracy: b.w > 0 ? b.wy / b.w : null,
  }));
}

/** Expected calibration error over bins: `Σ (n_b / N_w) · |acc_b − conf_b|`. */
export function eceOf(bins: readonly ReliabilityBin[]): number | null {
  const total = bins.reduce((s, b) => s + b.weight, 0);
  if (total <= 0) return null;
  let e = 0;
  for (const b of bins) {
    if (b.meanConfidence === null || b.accuracy === null) continue;
    e += (b.weight / total) * Math.abs(b.accuracy - b.meanConfidence);
  }
  return e;
}

/** Maximum calibration error over bins with at least 10 labels. */
export function mceOf(bins: readonly ReliabilityBin[]): number | null {
  let m: number | null = null;
  for (const b of bins) {
    if (b.labeled < MCE_MIN_LABELS || b.meanConfidence === null || b.accuracy === null) continue;
    const gap = Math.abs(b.accuracy - b.meanConfidence);
    m = m === null ? gap : Math.max(m, gap);
  }
  return m;
}

/** Adaptive calibration error: ECE over 10 equal-mass bins (by weight, confidence-ordered). */
export function aceOf(points: readonly Weighted[]): number | null {
  const total = points.reduce((s, p) => s + p.w, 0);
  if (total <= 0) return null;
  const sorted = [...points].sort((a, b) => a.c - b.c);
  const target = total / BINS;
  let e = 0;
  let w = 0;
  let wc = 0;
  let wy = 0;
  let filled = 0;
  const flush = (): void => {
    if (w > 0) e += (w / total) * Math.abs(wy / w - wc / w);
    w = 0;
    wc = 0;
    wy = 0;
    filled += 1;
  };
  for (const p of sorted) {
    w += p.w;
    wc += p.w * p.c;
    wy += p.w * p.y;
    if (w >= target && filled < BINS - 1) flush();
  }
  if (w > 0) flush();
  return e;
}

/** Wilson score lower bound at 95 % (z = 1.96). */
export function wilsonLower(p: number, n: number, z = 1.96): number {
  if (n <= 0) return 0;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.max(0, (centre - margin) / (1 + z2 / n));
}

/** 10-bin histogram of routing confidence over all decisions. */
export function confidenceHistogram(
  confidences: readonly number[],
): Array<{ lo: number; hi: number; count: number }> {
  const counts = new Array<number>(BINS).fill(0);
  for (const c of confidences) counts[binIndex(c)] = (counts[binIndex(c)] ?? 0) + 1;
  return counts.map((count, i) => ({ lo: i / BINS, hi: (i + 1) / BINS, count }));
}

/** Population stability index between two 10-bin histograms, ε-smoothed. `null` when either is empty. */
export function psi(window: readonly number[], baseline: readonly number[]): number | null {
  const tw = window.reduce((s, x) => s + x, 0);
  const tb = baseline.reduce((s, x) => s + x, 0);
  if (tw <= 0 || tb <= 0 || window.length !== baseline.length) return null;
  let v = 0;
  for (let i = 0; i < window.length; i += 1) {
    const a = Math.max(PSI_EPSILON, (window[i] ?? 0) / tw);
    const e = Math.max(PSI_EPSILON, (baseline[i] ?? 0) / tb);
    v += (a - e) * Math.log(a / e);
  }
  return v;
}

/** Ranked probability score for one ordered-level observation with levels "0".."K−1". */
export function rankedProbabilityScore(
  distribution: Readonly<Record<string, number>>,
  labelLevel: number,
  levels: number,
): number {
  if (levels < 2) return 0;
  let F = 0;
  let s = 0;
  for (let j = 0; j < levels - 1; j += 1) {
    F += clamp01(distribution[String(j)] ?? 0);
    const O = labelLevel <= j ? 1 : 0;
    s += (F - O) * (F - O);
  }
  return s / (levels - 1);
}

function levelsOf(o: CalibrationObservation): number {
  let max = -1;
  for (const k of Object.keys(o.distribution)) {
    const n = Number(k);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max + 1;
}

/** Computes the full `CalibrationMetrics` for one segment (§7.2). */
export function calibrationMetrics(
  observations: readonly CalibrationObservation[],
  options: CalibrationOptions = {},
): CalibrationMetrics {
  const decisions = observations.length;
  const labeled = observations.filter(isLabeled);
  const points = labeled.map(scored);
  const bins = reliabilityBins(points);
  const totalW = points.reduce((s, p) => s + p.w, 0);

  // Top-label accuracy (for boolean: the predicted outcome against the label, not pYes).
  let accW = 0;
  for (const o of labeled) accW += weightOf(o) * (o.outcome === o.label ? 1 : 0);
  const accuracy = totalW > 0 ? accW / totalW : null;

  // Brier (boolean on raw pYes; choice multiclass) and RPS (score).
  let brierSum = 0;
  let brierW = 0;
  let rpsSum = 0;
  let rpsW = 0;
  for (const o of labeled) {
    const w = weightOf(o);
    if (o.kind === "boolean") {
      const y = o.label === "true" ? 1 : 0;
      brierSum += w * (prob(o, "true") - y) ** 2;
      brierW += w;
    } else if (o.kind === "choice") {
      const keys = new Set([...Object.keys(o.distribution), o.label]);
      let s = 0;
      for (const k of keys) s += (prob(o, k) - (k === o.label ? 1 : 0)) ** 2;
      brierSum += w * s;
      brierW += w;
    } else {
      const level = Number(o.label);
      const K = levelsOf(o);
      if (Number.isInteger(level) && K >= 2) {
        rpsSum += w * rankedProbabilityScore(o.distribution, level, K);
        rpsW += w;
      }
    }
  }

  // Classwise ECE for choice contracts.
  let classwise: CalibrationMetrics["classwise"] = null;
  const choice = labeled.filter((o) => o.kind === "choice");
  if (choice.length > 0) {
    const keys = new Set<string>();
    for (const o of choice) {
      for (const k of Object.keys(o.distribution)) keys.add(k);
      keys.add(o.label);
    }
    classwise = {};
    for (const k of [...keys].sort()) {
      const pts = choice.map((o) => ({ c: prob(o, k), y: o.label === k ? 1 : 0, w: weightOf(o) }));
      const predicted = choice.filter((o) => o.outcome === k);
      const pw = predicted.reduce((s, o) => s + weightOf(o), 0);
      classwise[k] = {
        support: choice.filter((o) => o.label === k).length,
        ece: eceOf(reliabilityBins(pts)),
        accuracy:
          pw > 0
            ? predicted.reduce((s, o) => s + weightOf(o) * (o.label === k ? 1 : 0), 0) / pw
            : null,
        meanConfidence:
          pw > 0 ? predicted.reduce((s, o) => s + weightOf(o) * prob(o, k), 0) / pw : null,
      };
    }
  }

  // Routing.
  const count = (r: JevRoute): number => observations.filter((o) => o.route === r).length;
  const share = (n: number): number => (decisions > 0 ? n / decisions : 0);
  const autoCount = count("auto");
  const autoLabeled = labeled.filter((o) => o.route === "auto");
  let autoPrecision: CalibrationMetrics["autoPrecision"] = null;
  if (autoLabeled.length > 0) {
    const w = autoLabeled.reduce((s, o) => s + weightOf(o), 0);
    const p =
      autoLabeled.reduce((s, o) => s + weightOf(o) * (o.outcome === o.label ? 1 : 0), 0) / w;
    autoPrecision = {
      value: p,
      lower95: wilsonLower(p, autoLabeled.length),
      n: autoLabeled.length,
    };
  }
  const dual = labeled.filter((o) => o.permittedRoute !== undefined && o.permittedRoute !== null);
  const dualW = dual.reduce((s, o) => s + weightOf(o), 0);
  const routeCorrectness =
    dualW > 0
      ? dual.reduce((s, o) => s + weightOf(o) * (o.route === o.permittedRoute ? 1 : 0), 0) / dualW
      : null;

  // Near-threshold mass.
  const band = options.nearThresholdBand ?? 0.03;
  const autoAt = options.autoAt ?? null;
  let above = 0;
  let below = 0;
  if (autoAt !== null) {
    for (const o of observations) {
      const c = clamp01(o.confidence);
      if (c >= autoAt && c < autoAt + band) above += 1;
      else if (c >= autoAt - band && c < autoAt) below += 1;
    }
  }

  const histogram = confidenceHistogram(observations.map((o) => o.confidence));
  const baseline = options.baselineHistogram ?? null;

  return {
    decisions,
    labeled: labeled.length,
    accuracy,
    ece: eceOf(bins),
    ace: aceOf(points),
    mce: mceOf(bins),
    brier: brierW > 0 ? brierSum / brierW : null,
    rps: rpsW > 0 ? rpsSum / rpsW : null,
    classwise,
    bins,
    routeShare: {
      auto: share(autoCount),
      improve: share(count("improve")),
      human: share(count("human")),
    },
    autoPrecision,
    routeCorrectness,
    nearThreshold: { band, above: share(above), below: share(below) },
    confidenceHistogram: histogram,
    psi:
      baseline === null
        ? null
        : psi(
            histogram.map((h) => h.count),
            baseline,
          ),
    monotonicity: options.monotonicity ?? null,
    rates: {
      escape: share(observations.filter((o) => o.escape === true).length),
      override:
        autoCount > 0 ? observations.filter((o) => o.override === true).length / autoCount : 0,
      staleOption: share(observations.filter((o) => o.staleOption === true).length),
      blindRetryBlocked: share(observations.filter((o) => o.blindRetryBlocked === true).length),
      interRaterDisagreement: options.interRaterDisagreement ?? null,
    },
  };
}
