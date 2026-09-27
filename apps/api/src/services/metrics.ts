/**
 * Dashboard metrics (API.md §3, `DashboardMetrics`): SQL aggregates over `runs`, `node_runs`,
 * `human_tasks` and `run_events` for one workspace and time range (`percentile_cont`,
 * `date_trunc`). Runs are counted by `created_at` in `[from, to)`; latency and success rates are
 * over the runs that finished.
 */
import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@flowaid/database";

export interface MetricsFilter {
  workspaceId: string;
  from: Date;
  to: Date;
  workflowId?: string | undefined;
  environmentId?: string | undefined;
  versionId?: string | undefined;
  /** API keys pinned to workflows see only those */
  workflowIds?: readonly string[] | null;
}

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

export const BUCKETS = { "1m": "minute", "1h": "hour", "1d": "day" } as const;
export type Bucket = keyof typeof BUCKETS;
const STEP_MS: Record<Bucket, number> = { "1m": 60_000, "1h": 3_600_000, "1d": 86_400_000 };

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

const TERMINAL = sql`('completed','failed','cancelled','timed_out')`;

/** WHERE clause over the `runs` table aliased `r`. */
function runFilter(f: MetricsFilter): SQL {
  const parts: SQL[] = [
    sql`r.workspace_id = ${f.workspaceId}`,
    sql`r.created_at >= ${f.from.toISOString()}::timestamptz`,
    sql`r.created_at < ${f.to.toISOString()}::timestamptz`,
  ];
  if (f.workflowId) parts.push(sql`r.workflow_id = ${f.workflowId}`);
  if (f.environmentId) parts.push(sql`r.environment_id = ${f.environmentId}`);
  if (f.versionId) parts.push(sql`r.workflow_version_id = ${f.versionId}`);
  if (f.workflowIds)
    parts.push(
      f.workflowIds.length
        ? sql`r.workflow_id in (${sql.join(
            f.workflowIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`
        : sql`false`,
    );
  return sql.join(parts, sql` and `);
}

const num = (v: unknown): number | null =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const round = (v: number | null, d = 1): number | null =>
  v === null ? null : Number(v.toFixed(d));

export async function dashboardMetrics(tx: Tx, f: MetricsFilter): Promise<DashboardMetrics> {
  const where = runFilter(f);
  const [statusRows, runAgg, nodeAgg, conf, human, failovers] = await Promise.all([
    tx.execute<{ status: string; n: number }>(
      sql`select r.status, count(*)::int as n from runs r where ${where} group by r.status`,
    ),
    tx.execute<{
      p50: unknown;
      p95: unknown;
      p99: unknown;
      cost: unknown;
      tin: unknown;
      tout: unknown;
    }>(sql`
      select
        percentile_cont(0.5) within group (order by d) filter (where d is not null) as p50,
        percentile_cont(0.95) within group (order by d) filter (where d is not null) as p95,
        percentile_cont(0.99) within group (order by d) filter (where d is not null) as p99,
        coalesce(sum(cost), 0) as cost,
        coalesce(sum(tin), 0) as tin,
        coalesce(sum(tout), 0) as tout
      from (
        select
          case when r.status in ${TERMINAL} and r.started_at is not null and r.ended_at is not null
               then extract(epoch from (r.ended_at - r.started_at)) * 1000 end as d,
          r.cost_usd as cost,
          coalesce((r.usage->>'inputTokens')::bigint, 0) as tin,
          coalesce((r.usage->>'outputTokens')::bigint, 0) as tout
        from runs r where ${where}
      ) t`),
    tx.execute<{ tp50: unknown; tp95: unknown; retried: number; runs: number }>(sql`
      select
        percentile_cont(0.5) within group (order by n.latency_ms)
          filter (where n.node_type like 'flowaid.tools.%' and n.latency_ms is not null) as tp50,
        percentile_cont(0.95) within group (order by n.latency_ms)
          filter (where n.node_type like 'flowaid.tools.%' and n.latency_ms is not null) as tp95,
        count(distinct n.run_id) filter (where n.attempt > 1)::int as retried,
        count(distinct n.run_id)::int as runs
      from node_runs n join runs r on r.id = n.run_id
      where ${where}`),
    tx.execute<{ bin: number; n: number; total: unknown }>(sql`
      select least(greatest(width_bucket(n.decision_confidence::float8, 0, 1, 10), 1), 10)::int as bin,
             count(*)::int as n,
             sum(n.decision_confidence::float8) as total
      from node_runs n join runs r on r.id = n.run_id
      where ${where} and n.decision_confidence is not null
      group by 1`),
    tx.execute<{ n: number }>(sql`
      select count(distinct h.run_id)::int as n
      from human_tasks h join runs r on r.id = h.run_id
      where ${where}`),
    tx.execute<{ provider: string; code: string; n: number }>(sql`
      select coalesce(e.payload->>'from', 'unknown') as provider,
             coalesce(e.payload->'error'->>'code', 'UNKNOWN') as code,
             count(*)::int as n
      from run_events e join runs r on r.id = e.run_id
      where ${where} and e.type = 'PROVIDER_FAILOVER'
      group by 1, 2 order by 3 desc limit 20`),
  ]);

  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of statusRows) {
    byStatus[row.status] = row.n;
    total += row.n;
  }
  const finished =
    (byStatus.completed ?? 0) +
    (byStatus.failed ?? 0) +
    (byStatus.cancelled ?? 0) +
    (byStatus.timed_out ?? 0);
  const agg = [...runAgg][0];
  const nodes = [...nodeAgg][0];
  const histogram = Array.from({ length: 10 }, (_, i) => ({
    lo: Number((i / 10).toFixed(1)),
    hi: Number(((i + 1) / 10).toFixed(1)),
    count: 0,
  }));
  let confN = 0;
  let confSum = 0;
  for (const row of conf) {
    const bucket = histogram[row.bin - 1];
    if (bucket) bucket.count += row.n;
    confN += row.n;
    confSum += num(row.total) ?? 0;
  }
  return {
    from: f.from.toISOString(),
    to: f.to.toISOString(),
    runs: { total, byStatus },
    successRate: ratio(byStatus.completed ?? 0, finished),
    errorRate: ratio((byStatus.failed ?? 0) + (byStatus.timed_out ?? 0), finished),
    latencyMs: {
      p50: round(num(agg?.p50)),
      p95: round(num(agg?.p95)),
      p99: round(num(agg?.p99)),
    },
    aiCostUsd: Number((num(agg?.cost) ?? 0).toFixed(6)),
    tokens: { input: num(agg?.tin) ?? 0, output: num(agg?.tout) ?? 0 },
    toolLatencyMs: { p50: round(num(nodes?.tp50)), p95: round(num(nodes?.tp95)) },
    decisionConfidence: {
      histogram,
      mean: confN > 0 ? Number((confSum / confN).toFixed(4)) : null,
    },
    humanReviewRate: ratio([...human][0]?.n ?? 0, total),
    retryRate: ratio(nodes?.retried ?? 0, nodes?.runs ?? 0),
    providerFailures: [...failovers].map((r) => ({
      provider: r.provider,
      code: r.code,
      count: r.n,
    })),
  };
}

export async function metricsTimeseries(
  tx: Tx,
  f: MetricsFilter,
  bucket: Bucket,
): Promise<MetricsSeries> {
  const unit = sql.raw(`'${BUCKETS[bucket]}'`);
  const where = runFilter(f);
  const [rows, humans] = await Promise.all([
    tx.execute<{ t: Date | string; runs: number; failed: number; cost: unknown; p95: unknown }>(
      sql`
      select date_trunc(${unit}, r.created_at, 'UTC') as t,
             count(*)::int as runs,
             count(*) filter (where r.status in ('failed','timed_out'))::int as failed,
             coalesce(sum(r.cost_usd), 0) as cost,
             percentile_cont(0.95) within group (order by extract(epoch from (r.ended_at - r.started_at)) * 1000)
               filter (where r.ended_at is not null and r.started_at is not null) as p95
      from runs r
      where ${where}
      group by 1 order by 1`,
    ),
    tx.execute<{ t: Date | string; n: number }>(sql`
      select date_trunc(${unit}, r.created_at, 'UTC') as t, count(distinct h.run_id)::int as n
      from human_tasks h join runs r on r.id = h.run_id
      where ${where}
      group by 1`),
  ]);
  const step = STEP_MS[bucket];
  const byT = new Map<number, { runs: number; failed: number; cost: unknown; p95: unknown }>();
  for (const row of rows) byT.set(new Date(row.t).getTime(), row);
  const humansByT = new Map<number, number>();
  for (const row of humans) humansByT.set(new Date(row.t).getTime(), row.n);
  const out: MetricsSeries = {
    bucket,
    timestamps: [],
    series: { runs: [], failed: [], costUsd: [], p95LatencyMs: [], humanReviews: [] },
  };
  // A dense axis: every bucket from `from` to `to`, zero where nothing ran.
  const end = f.to.getTime();
  for (
    let t = Math.floor(f.from.getTime() / step) * step;
    t < end && out.timestamps.length < 2000;
    t += step
  ) {
    const row = byT.get(t);
    out.timestamps.push(new Date(t).toISOString());
    out.series.runs.push(row?.runs ?? 0);
    out.series.failed.push(row?.failed ?? 0);
    out.series.costUsd.push(Number((num(row?.cost) ?? 0).toFixed(6)));
    out.series.p95LatencyMs.push(round(num(row?.p95)));
    out.series.humanReviews.push(humansByT.get(t) ?? 0);
  }
  return out;
}
