/**
 * The retention sweep (DATABASE.md, "Retention"; job `retention.sweep` on the maintenance queue).
 * Every step is one bounded batch in its own system-scope transaction: a materialized `picked`
 * CTE carries the step's whole filter (so rows a step cannot change never fill its batch) and a
 * step that returns `batch` rows has more to do. A large backlog is worked off by sweeping again
 * (`sweepRetentionUntilDone`) instead of holding one long lock.
 *
 * Tables the retention table does not list: `queue_jobs` keep finished jobs 7 days (like `jobs`)
 * and `alert_deliveries` 30 days (like `webhook_deliveries`). Expired `runs` keep their row
 * (metrics); the sweep never deletes runs.
 */
import { sql } from "drizzle-orm";
import type { Database, Tx } from "./db.js";

export interface SweepOptions {
  /** Rows per step (default 1 000). */
  batch?: number;
  /** Days before sensitive node I/O is nulled when the workspace does not persist PII (default 7). */
  sensitiveIoDays?: number;
}

export interface SweepResult {
  expiredRuns: number;
  sensitiveNodeRuns: number;
  checkpoints: number;
  humanContexts: number;
  draftVersions: number;
  webhookDeliveries: number;
  alertDeliveries: number;
  stateEntries: number;
  idempotencyKeys: number;
  jobs: number;
  queueJobs: number;
  userTokens: number;
  reviewTokens: number;
  partitionsCreated: number;
}

type Step = Exclude<keyof SweepResult, "partitionsCreated">;

/** Runs one `… returning` statement in its own transaction and counts the rows it touched. */
const count = (database: Database, query: ReturnType<typeof sql>): Promise<number> =>
  database.system(async (tx: Tx) => (await tx.execute(query)).length);

/** Unreferenced drafts older than 7 days (also the `draft_versions.gc` job). */
export function sweepDraftVersions(database: Database, batch = 1_000): Promise<number> {
  return count(
    database,
    sql`with picked as materialized (
          select v.id from workflow_versions v
          where v.kind = 'draft' and v.created_at < now() - interval '7 days'
            and not exists (select 1 from runs r where r.workflow_version_id = v.id)
            and not exists (select 1 from evaluation_runs e where e.workflow_version_id = v.id)
          order by v.created_at limit ${batch}
          for update of v skip locked
        )
        delete from workflow_versions v using picked where v.id = picked.id
        returning v.id`,
  );
}

/** Creates the `run_events` partitions `monthsAhead` months ahead (partitioned mode; else 0). */
export async function ensureRunEventPartitions(
  database: Database,
  monthsAhead = 3,
): Promise<number> {
  const [row] = await database.system((tx) =>
    tx.execute<{ n: number }>(
      sql`select flowaid_ensure_run_events_partitions(${monthsAhead}) as n`,
    ),
  );
  return row?.n ?? 0;
}

/** `delete from <table>` of the rows `picked` selects by `id`. */
const deletePicked = (database: Database, table: string, picked: ReturnType<typeof sql>) =>
  count(
    database,
    sql`with picked as materialized (${picked})
        delete from ${sql.identifier(table)} x using picked where x.id = picked.id
        returning x.id`,
  );

export async function sweepRetention(
  database: Database,
  options: SweepOptions = {},
): Promise<SweepResult> {
  const batch = options.batch ?? 1_000;
  const piiDays = options.sensitiveIoDays ?? 7;
  const steps: Record<Step, () => Promise<number>> = {
    // Expired runs keep their row (metrics) with I/O nulled; their history goes, with their
    // `run:<id>` state. Artifacts are marked expired so the artifact sweep deletes their bytes
    // before the rows.
    expiredRuns: () =>
      count(
        database,
        sql`with expired as materialized (
              select id from runs where expires_at is not null and expires_at <= now()
              order by expires_at limit ${batch} for update skip locked
            ),
            e as (delete from run_events where run_id in (select id from expired)),
            n as (delete from node_runs where run_id in (select id from expired)),
            c as (delete from run_checkpoints where run_id in (select id from expired)),
            t as (delete from run_timers where run_id in (select id from expired)),
            h as (delete from human_tasks where run_id in (select id from expired)),
            s as (delete from state_entries
                  where namespace in (select 'run:' || id::text from expired)),
            a as (update artifacts set expires_at = now() where run_id in (select id from expired)
                    and (expires_at is null or expires_at > now()))
            update runs set input = 'null'::jsonb, output = null, variables = '{}'::jsonb, expires_at = null
            where id in (select id from expired)
            returning id`,
      ),
    // Sensitive or PII node I/O after 7 days unless the workspace persists PII.
    sensitiveNodeRuns: () =>
      count(
        database,
        sql`with picked as materialized (
              select n.id from node_runs n
              join runs r on r.id = n.run_id
              join workspaces w on w.id = r.workspace_id
              where r.data_class in ('sensitive', 'pii')
                and coalesce((w.settings->'privacy'->>'persistPII')::boolean, false) = false
                and n.ended_at < now() - ${piiDays} * interval '1 day'
                and (n.input is not null or n.output is not null)
              order by n.ended_at limit ${batch}
              for update of n skip locked
            )
            update node_runs n set input = null, output = null from picked where n.id = picked.id
            returning n.id`,
      ),
    // Active runs keep their last two checkpoints; finished runs keep the final one.
    checkpoints: () =>
      count(
        database,
        sql`with doomed as materialized (
              select c.run_id, c.seq from run_checkpoints c
              join runs r on r.id = c.run_id
              where (select count(*) from (
                      select 1 from run_checkpoints newer
                      where newer.run_id = c.run_id and newer.seq > c.seq limit 2
                    ) kept) >= case when r.ended_at is not null then 1 else 2 end
              limit ${batch}
            )
            delete from run_checkpoints c using doomed d
            where c.run_id = d.run_id and c.seq = d.seq
            returning c.run_id`,
      ),
    humanContexts: () =>
      count(
        database,
        sql`with picked as materialized (
              select id from human_tasks
              where status = 'responded' and responded_at < now() - interval '30 days'
                and request ? 'context'
              limit ${batch} for update skip locked
            )
            update human_tasks h set request = h.request - 'context' from picked
            where h.id = picked.id
            returning h.id`,
      ),
    draftVersions: () => sweepDraftVersions(database, batch),
    webhookDeliveries: () =>
      deletePicked(
        database,
        "webhook_deliveries",
        sql`select id from webhook_deliveries where created_at < now() - interval '30 days'
            order by created_at limit ${batch}`,
      ),
    alertDeliveries: () =>
      deletePicked(
        database,
        "alert_deliveries",
        sql`select id from alert_deliveries where created_at < now() - interval '30 days'
            order by created_at limit ${batch}`,
      ),
    stateEntries: () =>
      count(
        database,
        sql`with picked as materialized (
              select workspace_id, namespace, key from state_entries
              where expires_at is not null and expires_at <= now()
              order by expires_at limit ${batch}
            )
            delete from state_entries s using picked
            where s.workspace_id = picked.workspace_id and s.namespace = picked.namespace
              and s.key = picked.key
            returning s.key`,
      ),
    // runs_idem_uq must match the API's 24 h idempotency window.
    idempotencyKeys: () =>
      count(
        database,
        sql`with picked as materialized (
              select id from runs
              where idempotency_key is not null and created_at < now() - interval '24 hours'
              limit ${batch} for update skip locked
            )
            update runs r set idempotency_key = null, idempotency_hash = null from picked
            where r.id = picked.id
            returning r.id`,
      ),
    jobs: () =>
      deletePicked(
        database,
        "jobs",
        sql`select id from jobs where created_at < now() - interval '7 days'
            order by created_at limit ${batch}`,
      ),
    queueJobs: () =>
      deletePicked(
        database,
        "queue_jobs",
        sql`select id from queue_jobs
            where done_at is not null and done_at < now() - interval '7 days'
            limit ${batch} for update skip locked`,
      ),
    userTokens: () =>
      deletePicked(
        database,
        "user_tokens",
        sql`select id from user_tokens where expires_at < now() - interval '7 days'
            limit ${batch}`,
      ),
    reviewTokens: () =>
      deletePicked(
        database,
        "human_task_review_tokens",
        sql`select id from human_task_review_tokens where expires_at < now() - interval '7 days'
            limit ${batch}`,
      ),
  };
  const result = { partitionsCreated: 0 } as SweepResult;
  for (const [name, step] of Object.entries(steps) as [Step, () => Promise<number>][])
    result[name] = await step();
  result.partitionsCreated = await ensureRunEventPartitions(database, 3);
  return result;
}

/**
 * Sweeps until no step fills its batch, or `maxRounds` sweeps ran; returns the summed counts
 * and whether the backlog is worked off (`done`).
 */
export async function sweepRetentionUntilDone(
  database: Database,
  options: SweepOptions & { maxRounds?: number } = {},
): Promise<{ result: SweepResult; rounds: number; done: boolean }> {
  const batch = options.batch ?? 1_000;
  const total = {} as SweepResult;
  for (let round = 1; ; round++) {
    const r = await sweepRetention(database, options);
    for (const [k, v] of Object.entries(r) as [keyof SweepResult, number][])
      total[k] = (total[k] ?? 0) + v;
    const more = (Object.entries(r) as [keyof SweepResult, number][]).some(
      ([k, v]) => k !== "partitionsCreated" && v >= batch,
    );
    if (!more) return { result: total, rounds: round, done: true };
    if (round >= (options.maxRounds ?? 100)) return { result: total, rounds: round, done: false };
  }
}
