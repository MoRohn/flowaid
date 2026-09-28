/**
 * The `maintenance` queue (RFC-0001; DATABASE.md, "Retention"): `retention.sweep` on the
 * `RETENTION_SWEEP_CRON` schedule, plus `partition.ensure` and `draft_versions.gc` on demand.
 * Every orchestrating worker schedules the sweep; the job id is the fire time, so replicas firing
 * together enqueue it once (a duplicate is harmless: the sweep is idempotent).
 */
import { Cron } from "croner";
import {
  PgArtifactIndex,
  ensureRunEventPartitions,
  sweepDraftVersions,
  sweepRetentionUntilDone,
  type Database,
  type SweepResult,
} from "@flowaid/database";
import type { ArtifactStorage } from "@flowaid/storage";
import type { Job, QueueDriver } from "@flowaid/workflow-core";
import type { WorkerLogger } from "../worker.js";

export interface MaintenanceDeps {
  db: Database;
  storage: ArtifactStorage;
  log: WorkerLogger;
  /** rows per sweep step (default 1 000) */
  batch?: number;
}

/** What the last `retention.sweep` did (the worker heartbeat carries it). */
export interface RetentionSweepReport {
  at: string;
  durationMs: number;
  /** false when the sweep stopped at its round limit with backlog left */
  done: boolean;
  rounds: number;
  result: SweepResult & { artifacts: number };
}

/**
 * Deletes the bytes, then the rows, of expired artifacts; returns how many went. An artifact
 * whose bytes cannot be deleted (its storage is not configured any more) keeps its row and is
 * reported, so the next sweep tries again.
 */
export async function sweepExpiredArtifacts(
  db: Database,
  storage: ArtifactStorage,
  log: WorkerLogger,
  batch = 500,
  maxRounds = 20,
): Promise<number> {
  const index = new PgArtifactIndex(db);
  let deleted = 0;
  for (let round = 0; round < maxRounds; round++) {
    const expired = await index.expired(new Date(), batch);
    let failed = 0;
    for (const row of expired) {
      try {
        await storage.forKind(row.storage).delete(row.storageKey);
        await index.delete(row.workspaceId, row.id);
        deleted += 1;
      } catch (error) {
        failed += 1;
        log.warn({ artifactId: row.id, err: String(error) }, "expired artifact not deleted");
      }
    }
    if (expired.length < batch || failed === expired.length) break;
  }
  return deleted;
}

export type MaintenanceJob = Extract<
  Job,
  { type: "retention.sweep" | "partition.ensure" | "draft_versions.gc" }
>;

export const isMaintenanceJob = (job: Job): job is MaintenanceJob =>
  job.type === "retention.sweep" ||
  job.type === "partition.ensure" ||
  job.type === "draft_versions.gc";

/** Runs one maintenance job; returns the sweep report for `retention.sweep`. */
export async function runMaintenanceJob(
  deps: MaintenanceDeps,
  job: MaintenanceJob,
): Promise<RetentionSweepReport | null> {
  switch (job.type) {
    case "retention.sweep": {
      const started = Date.now();
      const { result, rounds, done } = await sweepRetentionUntilDone(deps.db, {
        ...(deps.batch ? { batch: deps.batch } : {}),
      });
      const artifacts = await sweepExpiredArtifacts(deps.db, deps.storage, deps.log);
      const report: RetentionSweepReport = {
        at: new Date(started).toISOString(),
        durationMs: Date.now() - started,
        done,
        rounds,
        result: { ...result, artifacts },
      };
      deps.log.info(
        { ...report.result, rounds, done, durationMs: report.durationMs },
        "retention sweep",
      );
      if (!done)
        deps.log.warn(
          { rounds },
          "retention sweep stopped with backlog left; the next one continues",
        );
      return report;
    }
    case "partition.ensure": {
      const created = await ensureRunEventPartitions(deps.db, job.monthsAhead);
      deps.log.info({ created, monthsAhead: job.monthsAhead }, "run_events partitions ensured");
      return null;
    }
    case "draft_versions.gc": {
      const batch = deps.batch ?? 1_000;
      let deleted = 0;
      for (let round = 0; round < 100; round++) {
        const n = await sweepDraftVersions(deps.db, batch);
        deleted += n;
        if (n < batch) break;
      }
      deps.log.info({ deleted }, "draft versions collected");
      return null;
    }
  }
}

/** Enqueues `retention.sweep` on the cron schedule; returns the stop function. */
export function scheduleRetentionSweep(opts: {
  queue: QueueDriver;
  cron: string;
  onError?: (error: unknown) => void;
}): () => void {
  const job = new Cron(opts.cron, { protect: true }, async () => {
    const at = new Date().toISOString();
    // one job per fire minute however many workers fire it
    await opts.queue
      .enqueue(
        "maintenance",
        { type: "retention.sweep", at },
        { jobId: `retention.sweep:${at.slice(0, 16)}` },
      )
      .catch((error: unknown) => opts.onError?.(error));
  });
  return () => job.stop();
}
