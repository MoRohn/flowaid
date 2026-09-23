/**
 * `QueueDriver` on BullMQ (ARCHITECTURE.md §5.11), used when `REDIS_URL` is set: one BullMQ queue
 * per `QueueName`, deterministic job ids for dedupe, `attempts: 1` (retries are the runtime's
 * job, so behaviour is identical with and without Redis) and delayed `timer.fire` jobs as an
 * accelerator for the authoritative `run_timers` rows.
 */
import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { Job, QueueDriver, QueueName, RunTimer } from "@flowaid/workflow-core";

/** BullMQ reserves ':' in queue names; `run:general` becomes `run-general`. */
export const bullQueueName = (queue: QueueName): string => queue.replace(/:/g, "-");

export interface BullMqQueueDriverOptions {
  connection: ConnectionOptions;
  /** Redis key prefix (default `flowaid`). */
  prefix?: string;
}

export class BullMqQueueDriver implements QueueDriver {
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Set<Worker>();

  constructor(private readonly options: BullMqQueueDriverOptions) {}

  private queue(name: QueueName): Queue {
    const key = bullQueueName(name);
    let q = this.queues.get(key);
    if (!q) {
      q = new Queue(key, {
        connection: this.options.connection,
        prefix: this.options.prefix ?? "flowaid",
      });
      this.queues.set(key, q);
    }
    return q;
  }

  async enqueue(
    queue: QueueName,
    job: Job,
    opts: { delayMs?: number; jobId?: string; priority?: number } = {},
  ): Promise<void> {
    await this.queue(queue).add(job.type, job, {
      ...(opts.jobId ? { jobId: opts.jobId.replace(/:/g, "-") } : {}),
      ...(opts.delayMs ? { delay: opts.delayMs } : {}),
      // BullMQ: 0 = no priority, 1 is the highest. The contract: lower numbers run first.
      ...(opts.priority !== undefined ? { priority: Math.max(1, opts.priority + 1) } : {}),
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: { age: 7 * 24 * 3600 },
    });
  }

  async consume(
    queue: QueueName,
    handler: (job: Job) => Promise<void>,
    opts: { concurrency: number },
  ): Promise<{ stop(): Promise<void> }> {
    const worker = new Worker(bullQueueName(queue), (j) => handler(j.data as Job), {
      connection: this.options.connection,
      prefix: this.options.prefix ?? "flowaid",
      concurrency: Math.max(1, opts.concurrency),
    });
    this.workers.add(worker);
    await worker.waitUntilReady();
    return {
      stop: async () => {
        this.workers.delete(worker);
        await worker.close();
      },
    };
  }

  async scheduleTimer(timer: RunTimer): Promise<void> {
    const delay = Math.max(0, Date.parse(timer.fireAt) - Date.now());
    await this.enqueue(
      "run:control",
      { type: "timer.fire", runId: timer.runId, timerId: timer.id },
      { jobId: `timer:${timer.id}`, delayMs: delay },
    );
  }

  async cancelTimer(timerId: string): Promise<void> {
    await this.queue("run:control").remove(`timer-${timerId}`);
  }

  async close(): Promise<void> {
    await Promise.all([...this.workers].map((w) => w.close()));
    this.workers.clear();
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.queues.clear();
  }
}
