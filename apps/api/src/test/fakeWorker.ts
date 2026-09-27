/**
 * A stand-in for the worker in API tests: consumes `run.start`/`run.resume` from the real queue and
 * appends fenced events through the real run store, following a script per run input.
 */
import { desc, eq } from "drizzle-orm";
import { PgQueueDriver, PgRunStore, humanTasks, type Database } from "@flowaid/database";
import { fixture } from "@flowaid/database/testing";
import { uuidv7 } from "@flowaid/shared";
import type { DurableRunEvent, Job, JsonValue } from "@flowaid/workflow-core";

export type Script = "complete" | "fail" | "human" | "hang";

type Append = Omit<DurableRunEvent, "seq" | "runId" | "at">;

export class FakeWorker {
  readonly jobs: Job[] = [];
  private stopper: { stop(): Promise<void> } | null = null;
  private readonly queue: PgQueueDriver;

  constructor(
    private readonly db: Database,
    private readonly script: (input: JsonValue) => Script,
  ) {
    this.queue = new PgQueueDriver(db.sql, { pollMs: 25, workerId: "fake-worker" });
  }

  async start(): Promise<void> {
    this.stopper = await this.queue.consume("run:general", (job) => this.handle(job), {
      concurrency: 4,
    });
  }

  async stop(): Promise<void> {
    await this.stopper?.stop();
    await this.queue.close();
  }

  private async append(runId: string, events: Append[]): Promise<void> {
    const store = new PgRunStore(this.db);
    const lease = await store.acquireLease(runId, "fake-worker", 30_000);
    const run = await store.getRun(runId);
    if (!lease || !run) throw new Error(`cannot lease ${runId}`);
    await store.appendEvents(runId, events, {
      leaseOwner: "fake-worker",
      expectedSeq: run.lastSeq,
    });
    await store.releaseLease(runId, "fake-worker");
  }

  readonly errors: unknown[] = [];

  private async handle(job: Job): Promise<void> {
    try {
      await this.handleInner(job);
    } catch (error) {
      this.errors.push(error);
      throw error;
    }
  }

  private async handleInner(job: Job): Promise<void> {
    this.jobs.push(job);
    if (job.type !== "run.start" && job.type !== "run.resume") return;
    const run = await new PgRunStore(this.db).getRun(job.runId);
    if (!run) return;
    const now = new Date();
    const started = {
      ...fixture("RUN_STARTED"),
      workerId: "fake-worker",
      leaseUntil: new Date(now.getTime() + 30_000).toISOString(),
      deadlineAt: new Date(now.getTime() + 600_000).toISOString(),
    };
    if (job.type === "run.resume") {
      const [task] = await this.db.system((tx) =>
        tx
          .select({ nodeRunId: humanTasks.nodeRunId })
          .from(humanTasks)
          .where(eq(humanTasks.runId, job.runId))
          .orderBy(desc(humanTasks.createdAt))
          .limit(1),
      );
      await this.append(job.runId, [
        { ...fixture("RUN_RESUMED"), nodeRunId: task?.nodeRunId as string } as Append,
        {
          ...fixture("RUN_COMPLETED"),
          output: { message: "approved" },
          outcome: "human_approved",
          durationMs: 10,
        } as Append,
      ]);
      return;
    }
    const kind = this.script(run.input);
    if (kind === "hang") return;
    if (kind === "complete")
      return this.append(job.runId, [
        started,
        {
          ...fixture("RUN_COMPLETED"),
          output: { message: `echo: ${JSON.stringify(run.input)}` },
          outcome: null,
          usage: { inputTokens: 3, outputTokens: 2 },
          costUsd: 0.001,
          durationMs: 42,
        } as Append,
      ]);
    if (kind === "fail")
      return this.append(job.runId, [
        started,
        {
          ...fixture("RUN_FAILED"),
          error: {
            code: "NODE_EXECUTION_ERROR",
            message: "the model refused",
            retryable: false,
            nodeId: "draft",
          },
        } as Append,
      ]);
    const nodeRunId = uuidv7();
    const humanTaskId = uuidv7();
    const request = {
      title: "Approve the reply",
      context: {},
      mode: { type: "approval" },
      assignees: [],
      expiresAt: null,
      externalReview: false,
      origin: "human_node",
    };
    await this.append(job.runId, [
      started,
      {
        ...fixture("NODE_SCHEDULED"),
        nodeRunId,
        nodeId: "approve",
        scope: "",
        attempt: 1,
      } as Append,
      { ...fixture("NODE_STARTED"), nodeRunId, nodeId: "approve", scope: "", attempt: 1 } as Append,
      {
        ...fixture("HUMAN_APPROVAL_REQUESTED"),
        nodeRunId,
        nodeId: "approve",
        scope: "",
        attempt: 1,
        humanTaskId,
        request,
      } as Append,
      {
        ...fixture("NODE_WAITING"),
        nodeRunId,
        nodeId: "approve",
        scope: "",
        attempt: 1,
        reason: "human",
        ref: humanTaskId,
      } as Append,
      { ...fixture("RUN_WAITING"), nodeRunIds: [nodeRunId] } as Append,
    ]);
  }
}
