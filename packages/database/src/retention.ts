/**
 * The retention sweep (DATABASE.md, "Retention"; job `retention.sweep` on the maintenance queue).
 * Every step is a bounded batch in the system scope, so a large backlog is worked off over
 * several runs instead of one long lock.
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
  stateEntries: number;
  idempotencyKeys: number;
  jobs: number;
  userTokens: number;
  reviewTokens: number;
  partitionsCreated: number;
}

/** Runs one `… returning` statement and counts the rows it touched. */
const count = async (tx: Tx, query: ReturnType<typeof sql>): Promise<number> =>
  (await tx.execute(query)).length;

export async function sweepRetention(
  database: Database,
  options: SweepOptions = {},
): Promise<SweepResult> {
  const batch = options.batch ?? 1_000;
  const piiDays = options.sensitiveIoDays ?? 7;
  return database.system(async (tx) => ({
    // Expired runs keep their row (metrics) with I/O nulled; their history goes. Artifacts are
    // marked expired so the artifact sweep deletes their bytes before the rows.
    expiredRuns: await count(
      tx,
      sql`with expired as (
            select id from runs where expires_at is not null and expires_at <= now()
            order by expires_at limit ${batch} for update skip locked
          ),
          e as (delete from run_events where run_id in (select id from expired)),
          n as (delete from node_runs where run_id in (select id from expired)),
          c as (delete from run_checkpoints where run_id in (select id from expired)),
          t as (delete from run_timers where run_id in (select id from expired)),
          h as (delete from human_tasks where run_id in (select id from expired)),
          a as (update artifacts set expires_at = now() where run_id in (select id from expired)
                  and (expires_at is null or expires_at > now()))
          update runs set input = 'null'::jsonb, output = null, variables = '{}'::jsonb, expires_at = null
          where id in (select id from expired)
          returning id`,
    ),
    // Sensitive or PII node I/O after 7 days unless the workspace persists PII.
    sensitiveNodeRuns: await count(
      tx,
      sql`update node_runs n set input = null, output = null
          from runs r join workspaces w on w.id = r.workspace_id
          where n.run_id = r.id and r.data_class in ('sensitive', 'pii')
            and coalesce((w.settings->'privacy'->>'persistPII')::boolean, false) = false
            and n.ended_at < now() - ${piiDays} * interval '1 day'
            and (n.input is not null or n.output is not null)
            and n.id in (select id from node_runs where ended_at < now() - ${piiDays} * interval '1 day' limit ${batch})
          returning n.id`,
    ),
    // Active runs keep their last two checkpoints; finished runs keep the final one.
    checkpoints: await count(
      tx,
      sql`delete from run_checkpoints c using (
            select run_id, seq, row_number() over (partition by c.run_id order by seq desc) as rank,
                   (select ended_at is not null from runs where id = c.run_id) as finished
            from run_checkpoints c
          ) ranked
          where c.run_id = ranked.run_id and c.seq = ranked.seq
            and ranked.rank > case when ranked.finished then 1 else 2 end
          returning c.run_id`,
    ),
    humanContexts: await count(
      tx,
      sql`update human_tasks set request = request - 'context'
          where status = 'responded' and responded_at < now() - interval '30 days' and request ? 'context'
          returning id`,
    ),
    draftVersions: await count(
      tx,
      sql`delete from workflow_versions v
          where v.kind = 'draft' and v.created_at < now() - interval '7 days'
            and not exists (select 1 from runs r where r.workflow_version_id = v.id)
            and not exists (select 1 from evaluation_runs e where e.workflow_version_id = v.id)
          returning v.id`,
    ),
    webhookDeliveries: await count(
      tx,
      sql`delete from webhook_deliveries where created_at < now() - interval '30 days' returning id`,
    ),
    stateEntries: await count(
      tx,
      sql`delete from state_entries where expires_at is not null and expires_at <= now() returning key`,
    ),
    // runs_idem_uq must match the API's 24 h idempotency window.
    idempotencyKeys: await count(
      tx,
      sql`update runs set idempotency_key = null, idempotency_hash = null
          where idempotency_key is not null and created_at < now() - interval '24 hours'
          returning id`,
    ),
    jobs: await count(
      tx,
      sql`delete from jobs where created_at < now() - interval '7 days' returning id`,
    ),
    userTokens: await count(
      tx,
      sql`delete from user_tokens where expires_at < now() - interval '7 days' returning id`,
    ),
    reviewTokens: await count(
      tx,
      sql`delete from human_task_review_tokens where expires_at < now() - interval '7 days' returning id`,
    ),
    partitionsCreated:
      (await tx.execute<{ n: number }>(sql`select flowaid_ensure_run_events_partitions(3) as n`))[0]
        ?.n ?? 0,
  }));
}
