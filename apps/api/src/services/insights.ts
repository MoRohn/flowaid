/**
 * Insights (FLOWAID_V2_ROADMAP 4.1, 3.2): what needs attention now, and what changed per workflow
 * in a recent window against the baseline before it. The SQL loads per-workflow aggregates and
 * capped samples; the statistics are `@flowaid/insights`. Only production traffic counts
 * (`PRODUCTION_ORIGINS`): evaluations, replays, restarts and forks would distort the baseline.
 */
import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@flowaid/database";
import { detectChanges, type Insight, type WindowData } from "@flowaid/insights";
import { PRODUCTION_ORIGINS } from "./metrics.js";

export const INSIGHT_WINDOWS = {
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
} as const;
export type InsightWindow = keyof typeof INSIGHT_WINDOWS;
/** the baseline is the span of this many windows right before the recent one */
export const BASELINE_WINDOWS = 4;
/** newest samples kept per workflow and window for the rank tests */
const SAMPLE_CAP = 1000;
const FAILING_LIMIT = 5;

export interface InsightsFilter {
  workspaceId: string;
  now: Date;
  window: InsightWindow;
  workflowId?: string | undefined;
  environmentId?: string | undefined;
  /** API keys pinned to workflows see only those */
  workflowIds?: readonly string[] | null;
}

export interface InsightsReport {
  computedAt: string;
  window: { from: string; to: string };
  baseline: { from: string; to: string };
  attention: {
    openApprovals: { count: number; oldestAt: string | null; expiringSoon: number };
    failingWorkflows: {
      workflowId: string;
      workflowName: string;
      failed: number;
      finished: number;
    }[];
  };
  insights: (Omit<Insight, "attribution"> & {
    attribution?: { versionId: string; version: number | null; share: number };
  })[];
}

const FINISHED = sql`('completed','failed','timed_out')`;
const FAILED = sql`('failed','timed_out')`;

function runScope(f: InsightsFilter, from: Date): SQL {
  const parts: SQL[] = [
    sql`r.workspace_id = ${f.workspaceId}`,
    sql`r.created_at >= ${from.toISOString()}::timestamptz`,
    sql`r.created_at < ${f.now.toISOString()}::timestamptz`,
    sql`r.origin in (${sql.join(
      PRODUCTION_ORIGINS.map((o) => sql`${o}`),
      sql`, `,
    )})`,
  ];
  if (f.workflowId) parts.push(sql`r.workflow_id = ${f.workflowId}`);
  if (f.environmentId) parts.push(sql`r.environment_id = ${f.environmentId}`);
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

const emptyWindow = (): {
  finished: number;
  failed: number;
  durationsMs: number[];
  costsUsd: number[];
  confidences: number[];
  errorCodes: Record<string, number>;
  versions: Record<string, number>;
} => ({
  finished: 0,
  failed: 0,
  durationsMs: [],
  costsUsd: [],
  confidences: [],
  errorCodes: {},
  versions: {},
});

export async function insightsReport(tx: Tx, f: InsightsFilter): Promise<InsightsReport> {
  const span = INSIGHT_WINDOWS[f.window];
  const recentFrom = new Date(f.now.getTime() - span);
  const baselineFrom = new Date(recentFrom.getTime() - BASELINE_WINDOWS * span);
  const scope = runScope(f, baselineFrom);
  const isRecent = sql`(r.created_at >= ${recentFrom.toISOString()}::timestamptz)`;

  const [counts, codes, versions, samples, confidences, tasks] = await Promise.all([
    tx.execute<{ workflow_id: string; recent: boolean; finished: number; failed: number }>(sql`
      select r.workflow_id, ${isRecent} as recent,
             count(*) filter (where r.status in ${FINISHED})::int as finished,
             count(*) filter (where r.status in ${FAILED})::int as failed
      from runs r where ${scope}
      group by 1, 2`),
    tx.execute<{ workflow_id: string; recent: boolean; code: string; n: number }>(sql`
      select r.workflow_id, ${isRecent} as recent,
             coalesce(r.error->>'code', 'UNKNOWN') as code, count(*)::int as n
      from runs r where ${scope} and r.status in ${FAILED}
      group by 1, 2, 3`),
    tx.execute<{ workflow_id: string; recent: boolean; version_id: string; n: number }>(sql`
      select r.workflow_id, ${isRecent} as recent, r.workflow_version_id as version_id,
             count(*)::int as n
      from runs r where ${scope} and r.workflow_version_id is not null
      group by 1, 2, 3`),
    tx.execute<{ workflow_id: string; recent: boolean; d: unknown; cost: unknown }>(sql`
      select workflow_id, recent, d, cost from (
        select r.workflow_id, ${isRecent} as recent,
               case when r.status = 'completed' and r.started_at is not null and r.ended_at is not null
                         and not exists (select 1 from human_tasks h where h.run_id = r.id)
                    then extract(epoch from (r.ended_at - r.started_at)) * 1000 end as d,
               coalesce(r.cost_usd, 0)::float8 as cost,
               row_number() over (partition by r.workflow_id, ${isRecent} order by r.created_at desc) as rn
        from runs r where ${scope} and r.status in ${FINISHED}
      ) t where rn <= ${SAMPLE_CAP}`),
    tx.execute<{ workflow_id: string; recent: boolean; c: unknown }>(sql`
      select workflow_id, recent, c from (
        select r.workflow_id, ${isRecent} as recent, n.decision_confidence::float8 as c,
               row_number() over (partition by r.workflow_id, ${isRecent} order by n.started_at desc nulls last) as rn
        from node_runs n join runs r on r.id = n.run_id
        where ${scope} and n.decision_confidence is not null
      ) t where rn <= ${SAMPLE_CAP}`),
    tx.execute<{ n: number; oldest: Date | string | null; soon: number }>(sql`
      select count(*)::int as n, min(h.created_at) as oldest,
             count(*) filter (where h.expires_at is not null
                              and h.expires_at < ${new Date(f.now.getTime() + 86_400_000).toISOString()}::timestamptz)::int as soon
      from human_tasks h
      where h.workspace_id = ${f.workspaceId} and h.status = 'open'
        ${f.workflowId ? sql`and h.workflow_id = ${f.workflowId}` : sql``}
        ${
          f.workflowIds
            ? f.workflowIds.length
              ? sql`and h.workflow_id in (${sql.join(
                  f.workflowIds.map((id) => sql`${id}::uuid`),
                  sql`, `,
                )})`
              : sql`and false`
            : sql``
        }`),
  ]);

  const byWorkflow = new Map<string, { recent: WindowData; baseline: WindowData }>();
  const windowOf = (workflowId: string, recent: boolean) => {
    let w = byWorkflow.get(workflowId);
    if (!w) {
      w = { recent: emptyWindow(), baseline: emptyWindow() };
      byWorkflow.set(workflowId, w);
    }
    return (recent ? w.recent : w.baseline) as ReturnType<typeof emptyWindow>;
  };
  for (const row of counts) {
    const w = windowOf(row.workflow_id, row.recent);
    w.finished = row.finished;
    w.failed = row.failed;
  }
  for (const row of codes) windowOf(row.workflow_id, row.recent).errorCodes[row.code] = row.n;
  for (const row of versions)
    windowOf(row.workflow_id, row.recent).versions[row.version_id] = row.n;
  for (const row of samples) {
    const w = windowOf(row.workflow_id, row.recent);
    const d = row.d === null ? null : Number(row.d);
    if (d !== null && Number.isFinite(d)) w.durationsMs.push(d);
    const cost = Number(row.cost);
    if (Number.isFinite(cost)) w.costsUsd.push(cost);
  }
  for (const row of confidences) {
    const c = Number(row.c);
    if (Number.isFinite(c)) windowOf(row.workflow_id, row.recent).confidences.push(c);
  }

  const ids = [...byWorkflow.keys()];
  const names = new Map<string, string>();
  if (ids.length)
    for (const row of await tx.execute<{ id: string; name: string }>(
      sql`select id, name from workflows where workspace_id = ${f.workspaceId} and id in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    ))
      names.set(row.id, row.name);

  const detected = detectChanges(
    ids.map((workflowId) => {
      const w = byWorkflow.get(workflowId) ?? { recent: emptyWindow(), baseline: emptyWindow() };
      return { workflowId, workflowName: names.get(workflowId) ?? "Workflow", ...w };
    }),
  );

  const attributed = [
    ...new Set(detected.flatMap((i) => (i.attribution ? [i.attribution.versionId] : []))),
  ];
  const versionNumbers = new Map<string, number | null>();
  if (attributed.length)
    for (const row of await tx.execute<{ id: string; version: number | null }>(
      sql`select id, version from workflow_versions where workspace_id = ${f.workspaceId} and id in (${sql.join(
        attributed.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    ))
      versionNumbers.set(row.id, row.version);

  const failingWorkflows = ids
    .map((workflowId) => {
      const r = byWorkflow.get(workflowId)?.recent;
      return {
        workflowId,
        workflowName: names.get(workflowId) ?? "Workflow",
        failed: r?.failed ?? 0,
        finished: r?.finished ?? 0,
      };
    })
    .filter((w) => w.failed > 0)
    .sort((a, b) => b.failed - a.failed || a.workflowName.localeCompare(b.workflowName))
    .slice(0, FAILING_LIMIT);

  const task = [...tasks][0];
  return {
    computedAt: f.now.toISOString(),
    window: { from: recentFrom.toISOString(), to: f.now.toISOString() },
    baseline: { from: baselineFrom.toISOString(), to: recentFrom.toISOString() },
    attention: {
      openApprovals: {
        count: task?.n ?? 0,
        oldestAt: task?.oldest ? new Date(task.oldest).toISOString() : null,
        expiringSoon: task?.soon ?? 0,
      },
      failingWorkflows,
    },
    insights: detected.map(({ attribution, ...i }) =>
      attribution
        ? {
            ...i,
            attribution: {
              ...attribution,
              version: versionNumbers.get(attribution.versionId) ?? null,
            },
          }
        : i,
    ),
  };
}
