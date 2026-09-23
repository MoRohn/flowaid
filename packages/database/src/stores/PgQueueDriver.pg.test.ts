import { afterAll, beforeAll, expect, it } from "vitest";
import type { Job } from "@flowaid/workflow-core";
import { createTestDatabase, describeDb, type TestDatabase } from "../test/pg.js";
import { PgQueueDriver } from "./PgQueueDriver.js";

const start = (runId: string): Job => ({ type: "run.start", runId });

describeDb("PgQueueDriver", () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => {
    await t?.drop();
  });

  it("delivers every job exactly once to 10 concurrent consumers", async () => {
    const producer = new PgQueueDriver(t.app.sql);
    const seen: string[] = [];
    const consumers = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        new PgQueueDriver(t.app.sql, { workerId: `c${i}`, pollMs: 20 }).consume(
          "run:general",
          async (job) => {
            if (job.type === "run.start") seen.push(job.runId);
            await new Promise((r) => setTimeout(r, Math.random() * 3));
          },
          { concurrency: 2 },
        ),
      ),
    );
    await Promise.all(
      Array.from({ length: 200 }, (_, i) => producer.enqueue("run:general", start(`r${i}`))),
    );
    await expect.poll(() => seen.length, { timeout: 20_000 }).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    await Promise.all(consumers.map((c) => c.stop()));
    expect(new Set(seen).size).toBe(200);
    expect(seen).toHaveLength(200);
  });

  it("deduplicates by job id while pending and re-arms finished jobs", async () => {
    const q = new PgQueueDriver(t.app.sql);
    await q.enqueue(
      "trace_review",
      { type: "trace_review.run", runId: "a" },
      { jobId: "review:a" },
    );
    await q.enqueue(
      "trace_review",
      { type: "trace_review.run", runId: "a" },
      { jobId: "review:a" },
    );
    const runs: string[] = [];
    const c = await q.consume(
      "trace_review",
      (job) => {
        if (job.type === "trace_review.run") runs.push(job.runId);
        return Promise.resolve();
      },
      { concurrency: 1 },
    );
    await expect.poll(() => runs.length).toBe(1);
    await q.enqueue(
      "trace_review",
      { type: "trace_review.run", runId: "a" },
      { jobId: "review:a" },
    );
    await expect.poll(() => runs.length).toBe(2);
    await c.stop();
  });

  it("honours delays and priorities", async () => {
    const q = new PgQueueDriver(t.app.sql, { pollMs: 20 });
    await q.enqueue(
      "schedule",
      { type: "schedule.tick", scheduleId: "late", at: "x" },
      { delayMs: 400 },
    );
    await q.enqueue(
      "schedule",
      { type: "schedule.tick", scheduleId: "low", at: "x" },
      { priority: 5 },
    );
    await q.enqueue(
      "schedule",
      { type: "schedule.tick", scheduleId: "high", at: "x" },
      { priority: 1 },
    );
    const order: string[] = [];
    const began = Date.now();
    let lateAt = 0;
    const c = await q.consume(
      "schedule",
      (job) => {
        if (job.type === "schedule.tick") {
          order.push(job.scheduleId);
          if (job.scheduleId === "late") lateAt = Date.now() - began;
        }
        return Promise.resolve();
      },
      { concurrency: 1 },
    );
    await expect.poll(() => order.length, { timeout: 5_000 }).toBe(3);
    await c.stop();
    expect(order).toEqual(["high", "low", "late"]);
    expect(lateAt).toBeGreaterThanOrEqual(300);
  });

  it("retries with backoff and dead-letters after max attempts", async () => {
    const q = new PgQueueDriver(t.app.sql, { pollMs: 10, backoffBaseMs: 10, maxAttempts: 3 });
    await q.enqueue("ingest", { type: "ingest.source", sourceId: "flaky" }, { jobId: "flaky" });
    await q.enqueue("ingest", { type: "ingest.source", sourceId: "broken" }, { jobId: "broken" });
    const attempts: Record<string, number> = {};
    const errors: unknown[] = [];
    const c = await q.consume(
      "ingest",
      (job) => {
        if (job.type !== "ingest.source") return Promise.resolve();
        attempts[job.sourceId] = (attempts[job.sourceId] ?? 0) + 1;
        if (job.sourceId === "broken" || attempts[job.sourceId] === 1)
          return Promise.reject(new Error(`boom ${job.sourceId}`));
        return Promise.resolve();
      },
      { concurrency: 2 },
    );
    await expect
      .poll(
        async () =>
          (
            await t.admin<
              { n: number }[]
            >`select count(*)::int as n from queue_jobs where id in ('flaky','broken') and done_at is not null`
          )[0]?.n,
        { timeout: 10_000 },
      )
      .toBe(2);
    await c.stop();
    expect(attempts).toEqual({ flaky: 2, broken: 3 });
    const [broken] = await t.admin`select attempts, last_error from queue_jobs where id = 'broken'`;
    expect(broken).toEqual({ attempts: 3, last_error: "boom broken" });
    expect(errors).toEqual([]);
  });

  it("makes a job claimable again when its consumer vanished", async () => {
    const q = new PgQueueDriver(t.app.sql, { pollMs: 10 });
    await q.enqueue(
      "evaluation",
      { type: "evaluation.run", evaluationRunId: "e1" },
      { jobId: "e1" },
    );
    await t.admin`update queue_jobs set locked_by = 'dead', locked_until = now() - interval '1 second', attempts = 1 where id = 'e1'`;
    const got: string[] = [];
    const c = await q.consume(
      "evaluation",
      (job) => {
        if (job.type === "evaluation.run") got.push(job.evaluationRunId);
        return Promise.resolve();
      },
      { concurrency: 1 },
    );
    await expect.poll(() => got).toEqual(["e1"]);
    await c.stop();
    await q.close();
    await q.scheduleTimer({ id: "t", runId: "r", nodeRunId: null, purpose: "retry", fireAt: "x" });
    await q.cancelTimer("t");
  });
});
