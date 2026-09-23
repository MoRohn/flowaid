/**
 * `QueueDriver` on Postgres (`queue_jobs`), used when Redis is not configured.
 *
 * - Enqueue: one row per job; `jobId` deduplicates while the job is pending (a finished job with
 *   the same id is re-armed). `delayMs` sets `run_at`. A NOTIFY on `flowaid_queue` wakes idle
 *   consumers immediately; otherwise they poll every `pollMs`.
 * - Claim: `FOR UPDATE SKIP LOCKED` over the ready index, lowest `priority` first (BullMQ order),
 *   then `run_at`. A claim holds a visibility lease (`locked_until`) that a heartbeat extends
 *   while the handler runs; a crashed consumer's job becomes claimable again when it lapses.
 * - Completion sets `done_at`; a failure records `last_error` and retries with exponential
 *   backoff until `max_attempts`, after which the job is finished with its error (dead letter).
 * - Timers: `run_timers` rows are authoritative and polled by the runtime, so `scheduleTimer`
 *   and `cancelTimer` are no-ops here (the contract allows it).
 */
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import type { Job, QueueDriver, QueueName, RunTimer } from "@flowaid/workflow-core";

export const QUEUE_CHANNEL = "flowaid_queue";

export interface PgQueueDriverOptions {
  /** Consumer identity recorded in `locked_by` (default: a random id). */
  workerId?: string;
  /** Idle poll interval when no notification arrives (default 1 000 ms). */
  pollMs?: number;
  /** Visibility lease of a claimed job (default 5 min); extended every third of it. */
  visibilityMs?: number;
  /** Attempts before a job is dead-lettered (default 5). */
  maxAttempts?: number;
  /** Retry delay: base × 2^(attempt-1), capped (defaults 1 s and 5 min). */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** Receives handler errors (they never stop the consumer). */
  onError?: (error: unknown, job: Job) => void;
}

interface Claimed {
  id: string;
  payload: Job;
  attempts: number;
  max_attempts: number;
}

export class PgQueueDriver implements QueueDriver {
  private readonly workerId: string;
  private readonly pollMs: number;
  private readonly visibilityMs: number;
  private readonly consumers = new Set<{ stop(): Promise<void> }>();

  constructor(
    private readonly sql: Sql,
    private readonly options: PgQueueDriverOptions = {},
  ) {
    this.workerId = options.workerId ?? `pgq-${randomUUID()}`;
    this.pollMs = options.pollMs ?? 1_000;
    this.visibilityMs = options.visibilityMs ?? 300_000;
  }

  async enqueue(
    queue: QueueName,
    job: Job,
    opts: { delayMs?: number; jobId?: string; priority?: number } = {},
  ): Promise<void> {
    const id = opts.jobId ?? randomUUID();
    const delay = Math.max(0, opts.delayMs ?? 0);
    await this.sql`
      insert into queue_jobs (id, queue, payload, priority, run_at, max_attempts)
      values (${id}, ${queue}, ${JSON.stringify(job)}::jsonb, ${opts.priority ?? 0},
              now() + ${delay} * interval '1 millisecond', ${this.options.maxAttempts ?? 5})
      on conflict (id) do update set
        queue = excluded.queue, payload = excluded.payload, priority = excluded.priority,
        run_at = excluded.run_at, attempts = 0, locked_by = null, locked_until = null,
        last_error = null, done_at = null
      where queue_jobs.done_at is not null`;
    await this.sql`select pg_notify(${QUEUE_CHANNEL}, ${queue})`;
  }

  /** Claims the next ready job of a queue, or null. */
  private async claim(queue: QueueName): Promise<Claimed | null> {
    const rows = await this.sql<Claimed[]>`
      update queue_jobs set
        locked_by = ${this.workerId},
        locked_until = now() + ${this.visibilityMs} * interval '1 millisecond',
        attempts = attempts + 1
      where id = (
        select id from queue_jobs
        where queue = ${queue} and done_at is null and run_at <= now()
          and (locked_until is null or locked_until < now())
        order by priority, run_at
        limit 1
        for update skip locked
      )
      returning id, payload, attempts, max_attempts`;
    return rows[0] ?? null;
  }

  private async complete(id: string): Promise<void> {
    await this.sql`
      update queue_jobs set done_at = now(), locked_by = null, locked_until = null
      where id = ${id} and locked_by = ${this.workerId}`;
  }

  private async fail(job: Claimed, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const base = this.options.backoffBaseMs ?? 1_000;
    const delay = Math.min(this.options.backoffMaxMs ?? 300_000, base * 2 ** (job.attempts - 1));
    const dead = job.attempts >= job.max_attempts;
    await this.sql`
      update queue_jobs set
        last_error = ${message.slice(0, 2_000)}, locked_by = null, locked_until = null,
        run_at = now() + ${delay} * interval '1 millisecond',
        done_at = ${dead ? this.sql`now()` : null}
      where id = ${job.id} and locked_by = ${this.workerId}`;
  }

  async consume(
    queue: QueueName,
    handler: (job: Job) => Promise<void>,
    opts: { concurrency: number },
  ): Promise<{ stop(): Promise<void> }> {
    let stopped = false;
    const wakers = new Set<() => void>();
    const wakeAll = () => {
      for (const w of [...wakers]) w();
    };
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(done, ms);
        function done() {
          clearTimeout(timer);
          wakers.delete(done);
          resolve();
        }
        wakers.add(done);
      });
    const listener = await this.sql.listen(QUEUE_CHANNEL, (name) => {
      if (name === queue) wakeAll();
    });

    const loop = async () => {
      while (!stopped) {
        let job: Claimed | null = null;
        try {
          job = await this.claim(queue);
        } catch (error) {
          if (stopped) return;
          this.options.onError?.(error, { type: "run.start", runId: "" });
          await sleep(this.pollMs);
          continue;
        }
        if (!job) {
          await sleep(this.pollMs);
          continue;
        }
        const claimed = job;
        const heartbeat = setInterval(
          () => {
            void this.sql`
            update queue_jobs set locked_until = now() + ${this.visibilityMs} * interval '1 millisecond'
            where id = ${claimed.id} and locked_by = ${this.workerId}`.catch(() => undefined);
          },
          Math.max(50, Math.floor(this.visibilityMs / 3)),
        );
        try {
          await handler(claimed.payload);
          await this.complete(claimed.id);
        } catch (error) {
          this.options.onError?.(error, claimed.payload);
          await this.fail(claimed, error).catch(() => undefined);
        } finally {
          clearInterval(heartbeat);
        }
      }
    };
    const loops = Array.from({ length: Math.max(1, opts.concurrency) }, () => loop());
    const consumer = {
      stop: async () => {
        if (stopped) return;
        stopped = true;
        wakeAll();
        await Promise.all(loops);
        await listener.unlisten();
        this.consumers.delete(consumer);
      },
    };
    this.consumers.add(consumer);
    return consumer;
  }

  scheduleTimer(_timer: RunTimer): Promise<void> {
    return Promise.resolve();
  }

  cancelTimer(_timerId: string): Promise<void> {
    return Promise.resolve();
  }

  async close(): Promise<void> {
    await Promise.all([...this.consumers].map((c) => c.stop()));
  }
}
