/**
 * `compare` and the regression report (ARCHITECTURE.md §10.4): deltas of the scalar summary fields,
 * per-case flips (pass/fail and each check), the publish-gate verdict and `W_REGRESSION` warnings
 * (pass rate, p95 latency +30 %, cost +20 %).
 *
 * A pass-rate drop over paired cases (the same case ids in both runs) is judged with an exact
 * McNemar test on the discordant pairs (passed → failed vs failed → passed): it warns when the drop
 * is significant (p < 0.05), or when it exceeds 2 pt over at least 100 paired cases, where a drop
 * that size is real evidence even if the flips happen to be balanced enough to miss p < 0.05. One
 * flip in 20 cases (5 pt, p = 1) is noise and does not warn. Without paired results the fixed 2 pt
 * threshold applies.
 */
import type { CaseResult, EvaluationSummary, RegressionReport } from "./types.js";

export const REGRESSION_THRESHOLDS = {
  passRateDropPt: 0.02,
  /** a pass-rate drop must reach this McNemar p-value, or the threshold with `minPairedCases` */
  significance: 0.05,
  minPairedCases: 100,
  p95Increase: 0.3,
  costIncrease: 0.2,
} as const;

const SCALARS = [
  "passRate",
  "completionRate",
  "branchCorrectness",
  "schemaSuccess",
  "toolSuccess",
  "humanReviewRate",
] as const;

export function deltas(
  current: EvaluationSummary,
  baseline: EvaluationSummary,
): RegressionReport["deltas"] {
  const out: RegressionReport["deltas"] = {};
  for (const k of SCALARS) out[k] = current[k] - baseline[k];
  out.cases = current.cases - baseline.cases;
  out.passed = current.passed - baseline.passed;
  return out;
}

export function flips(
  current: readonly CaseResult[],
  baseline: readonly CaseResult[],
): RegressionReport["flips"] {
  const before = new Map(baseline.map((r) => [r.caseId, r]));
  const out: RegressionReport["flips"] = [];
  for (const r of current) {
    const b = before.get(r.caseId);
    if (!b) continue;
    if (b.passed !== r.passed)
      out.push({ caseId: r.caseId, field: "passed", before: b.passed, after: r.passed });
    const checks = new Map(b.checks.map((c) => [c.id, c]));
    for (const c of r.checks) {
      const prev = checks.get(c.id);
      if (prev && prev.passed !== c.passed)
        out.push({
          caseId: r.caseId,
          field: c.id,
          before: prev.actual ?? prev.passed,
          after: c.actual ?? c.passed,
        });
    }
    for (const [node, d] of Object.entries(r.metrics.decisions)) {
      const prev = b.metrics.decisions[node];
      if (prev && JSON.stringify(prev.value) !== JSON.stringify(d.value))
        out.push({
          caseId: r.caseId,
          field: `decisions.${node}`,
          before: prev.value,
          after: d.value,
        });
    }
  }
  return out;
}

/**
 * Two-sided exact McNemar p-value for `regressed` (passed → failed) and `improved` (failed →
 * passed) pairs: under no change each discordant pair is a fair coin, so
 * p = min(1, 2 · P[Binomial(n, ½) ≤ min(regressed, improved)]) with n = regressed + improved.
 */
export function mcnemarExactP(regressed: number, improved: number): number {
  const n = regressed + improved;
  if (n === 0) return 1;
  const k = Math.min(regressed, improved);
  // Σ C(n, i) / 2^n in log space, so large n does not overflow
  let logC = 0;
  let tail = 0;
  for (let i = 0; i <= k; i += 1) {
    if (i > 0) logC += Math.log((n - i + 1) / i);
    tail += Math.exp(logC - n * Math.LN2);
  }
  return Math.min(1, 2 * tail);
}

/** Passed → failed and failed → passed counts over the cases present in both runs. */
function discordant(
  current: readonly CaseResult[],
  baseline: readonly CaseResult[],
): { n: number; regressed: number; improved: number } {
  const before = new Map(baseline.map((r) => [r.caseId, r.passed]));
  let n = 0;
  let regressed = 0;
  let improved = 0;
  for (const r of current) {
    const b = before.get(r.caseId);
    if (b === undefined) continue;
    n += 1;
    if (b && !r.passed) regressed += 1;
    else if (!b && r.passed) improved += 1;
  }
  return { n, regressed, improved };
}

export function regressionWarnings(
  current: EvaluationSummary,
  baseline: EvaluationSummary,
  paired?: { current: readonly CaseResult[]; baseline: readonly CaseResult[] },
): RegressionReport["warnings"] {
  const out: RegressionReport["warnings"] = [];
  const t = REGRESSION_THRESHOLDS;
  const drop = baseline.passRate - current.passRate;
  const dropText = `pass rate dropped ${(drop * 100).toFixed(1)} pt (${(baseline.passRate * 100).toFixed(1)}% → ${(current.passRate * 100).toFixed(1)}%)`;
  const pairs = paired ? discordant(paired.current, paired.baseline) : null;
  if (pairs && pairs.n > 0) {
    const p = mcnemarExactP(pairs.regressed, pairs.improved);
    const significant = pairs.regressed > pairs.improved && p < t.significance;
    const large = pairs.n >= t.minPairedCases && drop > t.passRateDropPt;
    if (drop > 0 && (significant || large))
      out.push({
        code: "W_REGRESSION",
        message: `${dropText}; n = ${pairs.n} paired cases, ${pairs.regressed} regressed, ${pairs.improved} improved, McNemar exact p = ${p.toFixed(3)}`,
      });
  } else if (drop > t.passRateDropPt) out.push({ code: "W_REGRESSION", message: dropText });
  if (baseline.latency.p95 > 0 && current.latency.p95 > baseline.latency.p95 * (1 + t.p95Increase))
    out.push({
      code: "W_REGRESSION",
      message: `p95 latency rose ${(((current.latency.p95 - baseline.latency.p95) / baseline.latency.p95) * 100).toFixed(0)}% (${baseline.latency.p95} → ${current.latency.p95} ms)`,
    });
  if (
    baseline.costUsd.perCase > 0 &&
    current.costUsd.perCase > baseline.costUsd.perCase * (1 + t.costIncrease)
  )
    out.push({
      code: "W_REGRESSION",
      message: `cost per case rose ${(((current.costUsd.perCase - baseline.costUsd.perCase) / baseline.costUsd.perCase) * 100).toFixed(0)}%`,
    });
  return out;
}

export interface CompareInput {
  versionId: string;
  results: readonly CaseResult[];
  summary: EvaluationSummary;
  baseline?: {
    versionId: string;
    results: readonly CaseResult[];
    summary: EvaluationSummary;
  } | null;
  gate?: { minPassRate: number } | null;
}

export function compare(i: CompareInput): RegressionReport {
  const b = i.baseline ?? null;
  const gate = i.gate ?? null;
  const failsGate = gate !== null && i.summary.passRate < gate.minPassRate;
  return {
    versionId: i.versionId,
    baselineVersionId: b?.versionId ?? null,
    summary: i.summary,
    baseline: b?.summary ?? null,
    deltas: b ? deltas(i.summary, b.summary) : {},
    flips: b ? flips(i.results, b.results) : [],
    verdict: failsGate ? "fail" : "pass",
    gate,
    warnings: b
      ? regressionWarnings(i.summary, b.summary, { current: i.results, baseline: b.results })
      : [],
  };
}
