/**
 * `compare` and the regression report (ARCHITECTURE.md §10.4): deltas of the scalar summary fields,
 * per-case flips (pass/fail and each check), the publish-gate verdict and `W_REGRESSION` warnings
 * (pass rate −2 pt, p95 latency +30 %, cost +20 %).
 */
import type { CaseResult, EvaluationSummary, RegressionReport } from "./types.js";

export const REGRESSION_THRESHOLDS = {
  passRateDropPt: 0.02,
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

export function regressionWarnings(
  current: EvaluationSummary,
  baseline: EvaluationSummary,
): RegressionReport["warnings"] {
  const out: RegressionReport["warnings"] = [];
  const t = REGRESSION_THRESHOLDS;
  if (baseline.passRate - current.passRate > t.passRateDropPt)
    out.push({
      code: "W_REGRESSION",
      message: `pass rate dropped ${((baseline.passRate - current.passRate) * 100).toFixed(1)} pt (${(baseline.passRate * 100).toFixed(1)}% → ${(current.passRate * 100).toFixed(1)}%)`,
    });
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
    warnings: b ? regressionWarnings(i.summary, b.summary) : [],
  };
}
