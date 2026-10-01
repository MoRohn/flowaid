/** `summarize`: the EvaluationSummary of a set of case results (ARCHITECTURE.md §10.4). */
import type { CalibrationBin, CaseResult, EvaluationSummary } from "./types.js";

/** Rates over an empty population are 1 ("nothing failed"); the counts say how much was checked. */
const rate = (ok: number, total: number) => (total === 0 ? 1 : ok / total);

/** Nearest-rank percentile. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1] ?? 0;
}

/**
 * Expected calibration error over equal-width confidence bins:
 * `ECE = Σ (nᵦ / n) · |accuracyᵦ − confidenceᵦ|`. Confidence 1 falls in the last bin.
 */
export function calibration(
  points: readonly { confidence: number; correct: boolean }[],
  binCount = 10,
): { ece: number; bins: CalibrationBin[] } {
  const bins: CalibrationBin[] = Array.from({ length: binCount }, (_, i) => ({
    lo: i / binCount,
    hi: (i + 1) / binCount,
    count: 0,
    accuracy: 0,
    confidence: 0,
  }));
  for (const p of points) {
    const c = Math.min(1, Math.max(0, p.confidence));
    const bin = bins[Math.min(binCount - 1, Math.floor(c * binCount))];
    if (!bin) continue;
    bin.count++;
    bin.accuracy += p.correct ? 1 : 0;
    bin.confidence += c;
  }
  let ece = 0;
  for (const b of bins) {
    if (b.count === 0) continue;
    b.accuracy /= b.count;
    b.confidence /= b.count;
    ece += (b.count / points.length) * Math.abs(b.accuracy - b.confidence);
  }
  return { ece, bins };
}

export function summarize(results: readonly CaseResult[]): EvaluationSummary {
  const n = results.length;
  const passed = results.filter((r) => r.passed).length;
  const accuracyCounts = new Map<string, { ok: number; total: number }>();
  const calibrationPoints = new Map<string, { confidence: number; correct: boolean }[]>();
  let branchOk = 0;
  let branchTotal = 0;
  let schemaOk = 0;
  let schemaTotal = 0;
  let toolOk = 0;
  let toolTotal = 0;
  for (const r of results) {
    for (const check of r.checks) {
      if (check.kind === "decision") {
        const node = check.id.slice("decision:".length);
        const a = accuracyCounts.get(node) ?? { ok: 0, total: 0 };
        a.total++;
        if (check.passed) a.ok++;
        accuracyCounts.set(node, a);
        const d = r.metrics.decisions[node];
        if (d)
          calibrationPoints.set(node, [
            ...(calibrationPoints.get(node) ?? []),
            { confidence: d.confidence, correct: check.passed },
          ]);
      } else if (check.kind === "branch") {
        branchTotal++;
        if (check.passed) branchOk++;
      } else if (check.kind === "output" && check.id.endsWith(":schema")) {
        schemaTotal++;
        if (check.passed) schemaOk++;
      }
    }
    // Node output-schema mismatches count against schema success too.
    if (r.metrics.schemaErrors > 0) schemaTotal += r.metrics.schemaErrors;
    toolTotal += r.metrics.toolCalls.total;
    toolOk += r.metrics.toolCalls.ok;
  }
  const launched = results.filter((r) => r.runId !== null);
  const latencies = launched.map((r) => r.metrics.latencyMs);
  const cost = results.reduce((a, r) => a + r.metrics.costUsd, 0);
  const judgeCost = results.reduce((a, r) => a + (r.metrics.judgeCostUsd ?? 0), 0);
  return {
    cases: n,
    passed,
    passRate: n === 0 ? 0 : passed / n,
    completionRate: n === 0 ? 0 : results.filter((r) => r.status === "completed").length / n,
    accuracy: Object.fromEntries([...accuracyCounts].map(([k, v]) => [k, v.ok / v.total])),
    calibration: Object.fromEntries(
      [...calibrationPoints].map(([k, pts]) => [k, calibration(pts)]),
    ),
    branchCorrectness: rate(branchOk, branchTotal),
    schemaSuccess: rate(schemaOk, schemaTotal),
    toolSuccess: rate(toolOk, toolTotal),
    humanReviewRate: n === 0 ? 0 : results.filter((r) => r.metrics.humanRequested).length / n,
    latency: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
    },
    costUsd: { total: cost + judgeCost, perCase: n === 0 ? 0 : cost / n, judge: judgeCost },
  };
}
