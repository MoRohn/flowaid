/**
 * The statistics behind change detection. Classical tests only: the samples are small (one
 * workflow, one window) and every result has to be explainable to the person reading it.
 *
 * - `fisherExactGreater`: one-sided Fisher's exact test on a 2×2 table (is the recent failure
 *   proportion higher than the baseline's?). Exact, so valid for small counts.
 * - `mannWhitney`: the Mann–Whitney U test with the normal approximation, tie correction and
 *   continuity correction (distribution-free: latency and cost are heavy-tailed).
 * - `benjaminiHochberg`: q-values controlling the false discovery rate across every test made in
 *   one request.
 * - `wilson`: the Wilson score interval for a proportion.
 */

/** ln Γ(x) for x > 0 (Lanczos, g = 7, n = 9; relative error below 1e-13). */
export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const c = [
    0, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  const z = x - 1;
  const t = z + 7.5;
  let a = 0.99999999999980993;
  c.forEach((ci, i) => {
    if (i > 0) a += ci / (z + i);
  });
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** ln C(n, k). */
export function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/**
 * One-sided Fisher's exact test for the table
 *
 * |          | failed | not failed |
 * | -------- | ------ | ---------- |
 * | recent   | a      | b          |
 * | baseline | c      | d          |
 *
 * P(X ≥ a) under the hypergeometric distribution with the margins fixed: the probability of a
 * recent failure count at least this high if recent and baseline runs fail at the same rate.
 */
export function fisherExactGreater(a: number, b: number, c: number, d: number): number {
  for (const v of [a, b, c, d])
    if (!Number.isInteger(v) || v < 0) throw new RangeError("counts must be non-negative integers");
  const n = a + b; // recent runs
  const k = a + c; // failures overall
  const total = a + b + c + d;
  if (n === 0 || k === 0) return 1;
  const denom = logChoose(total, n);
  const hi = Math.min(k, n);
  let p = 0;
  for (let x = a; x <= hi; x++)
    p += Math.exp(logChoose(k, x) + logChoose(total - k, n - x) - denom);
  return Math.min(1, p);
}

/** Φ(z), the standard normal CDF. */
export function normalCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

/** erfc(x) with relative error below 1.2e-7 everywhere (Numerical Recipes `erfcc`). */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

export type Alternative = "greater" | "less" | "two-sided";

export interface MannWhitneyResult {
  /** U for the first sample: the number of (x, y) pairs with x > y, ties counting ½ */
  u: number;
  z: number;
  p: number;
  /** U / (n₁·n₂): the probability that a random x exceeds a random y (common-language effect) */
  auc: number;
}

/**
 * Mann–Whitney U test of `x` against `y`. `greater` asks whether `x` tends to be larger.
 * Normal approximation with tie and continuity corrections; both samples should have at least
 * 8 values (callers here require 20).
 */
export function mannWhitney(
  x: readonly number[],
  y: readonly number[],
  alternative: Alternative = "two-sided",
): MannWhitneyResult {
  const n1 = x.length;
  const n2 = y.length;
  if (n1 === 0 || n2 === 0) throw new RangeError("both samples must be non-empty");
  const all = [...x.map((v) => ({ v, g: 0 })), ...y.map((v) => ({ v, g: 1 }))].sort(
    (p, q) => p.v - q.v,
  );
  const n = all.length;
  let rankSumX = 0;
  let tieTerm = 0;
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && all[j + 1]?.v === all[i]?.v) j++;
    const rank = (i + j + 2) / 2; // average of ranks i+1 … j+1
    const t = j - i + 1;
    if (t > 1) tieTerm += t * t * t - t;
    for (let k = i; k <= j; k++) if (all[k]?.g === 0) rankSumX += rank;
    i = j + 1;
  }
  const u = rankSumX - (n1 * (n1 + 1)) / 2;
  const mean = (n1 * n2) / 2;
  const variance = ((n1 * n2) / 12) * (n + 1 - tieTerm / (n * (n - 1)));
  const auc = u / (n1 * n2);
  if (variance <= 0) return { u, z: 0, p: 1, auc };
  const sd = Math.sqrt(variance);
  const diff = u - mean;
  let z: number;
  let p: number;
  if (alternative === "greater") {
    z = (diff - 0.5) / sd;
    p = 1 - normalCdf(z);
  } else if (alternative === "less") {
    z = (diff + 0.5) / sd;
    p = normalCdf(z);
  } else {
    z = (Math.abs(diff) - 0.5) / sd;
    p = Math.min(1, 2 * (1 - normalCdf(Math.max(z, 0))));
  }
  return { u, z, p: Math.min(1, Math.max(0, p)), auc };
}

/**
 * Benjamini–Hochberg adjusted p-values (q-values), in the input order. Rejecting every
 * hypothesis with q ≤ α controls the false discovery rate at α for independent or positively
 * dependent tests.
 */
export function benjaminiHochberg(pValues: readonly number[]): number[] {
  const m = pValues.length;
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const q = new Array<number>(m);
  let running = 1;
  for (let r = m - 1; r >= 0; r--) {
    const entry = order[r];
    if (!entry) continue;
    running = Math.min(running, (entry.p * m) / (r + 1));
    q[entry.i] = Math.min(1, running);
  }
  return q;
}

/** The Wilson score interval for k successes out of n (z = 1.96 → 95%). */
export function wilson(k: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 1 };
  const p = k / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/** The median (mean of the middle two for an even count); NaN for an empty sample. */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const hi = s[mid] ?? Number.NaN;
  return s.length % 2 ? hi : ((s[mid - 1] ?? Number.NaN) + hi) / 2;
}
