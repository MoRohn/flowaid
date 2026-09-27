/** Pure helpers of the dashboard (P6-04): time ranges, buckets and chart inputs. */
import { TIME_RANGE_PRESETS, type TimeRangePreset } from "@flowaid/ui/observability";

export type Bucket = "1m" | "1h" | "1d";

export interface DashboardMetrics {
  from: string;
  to: string;
  runs: { total: number; byStatus: Record<string, number> };
  successRate: number | null;
  errorRate: number | null;
  latencyMs: { p50: number | null; p95: number | null; p99: number | null };
  aiCostUsd: number;
  tokens: { input: number; output: number };
  toolLatencyMs: { p50: number | null; p95: number | null };
  decisionConfidence: {
    histogram: { lo: number; hi: number; count: number }[];
    mean: number | null;
  };
  humanReviewRate: number | null;
  retryRate: number | null;
  providerFailures: { provider: string; code: string; count: number }[];
}

export interface MetricsSeries {
  bucket: Bucket;
  timestamps: string[];
  series: {
    runs: number[];
    failed: number[];
    costUsd: number[];
    p95LatencyMs: (number | null)[];
    humanReviews: number[];
  };
}

/** The time window and a bucket that keeps charts at 24–90 points. */
export function rangeFor(
  preset: TimeRangePreset,
  now: number,
): { from: string; to: string; bucket: Bucket } {
  const ms = TIME_RANGE_PRESETS.find((p) => p.id === preset)?.ms ?? 86_400_000;
  const bucket: Bucket = ms <= 3_600_000 ? "1m" : ms <= 7 * 86_400_000 ? "1h" : "1d";
  // round `to` up to the next minute so the query key is stable within a minute
  const to = Math.ceil(now / 60_000) * 60_000;
  return { from: new Date(to - ms).toISOString(), to: new Date(to).toISOString(), bucket };
}

/** Confidence samples at bin midpoints (≤ `cap`), for `ConfidenceHistogram`. */
export function confidenceSamples(
  histogram: DashboardMetrics["decisionConfidence"]["histogram"],
  cap = 2000,
): number[] {
  const total = histogram.reduce((s, b) => s + b.count, 0);
  if (total === 0) return [];
  const scale = total > cap ? cap / total : 1;
  const out: number[] = [];
  for (const b of histogram) {
    const n = Math.round(b.count * scale);
    const mid = Math.min(0.999, (b.lo + b.hi) / 2);
    for (let i = 0; i < n; i++) out.push(mid);
  }
  return out;
}

/** A series with nulls replaced by the previous value (sparklines need a number per point). */
export function carryForward(values: readonly (number | null)[]): number[] {
  let last = 0;
  return values.map((v) => (v === null ? last : (last = v)));
}

export function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}
