/**
 * The store contract suite (ARCHITECTURE.md §5.11: "both drivers pass the same contract test
 * suite"). Call these from any package's tests with a factory for the implementation under test;
 * the memory stores in this package and the Postgres/Redis ones must all pass.
 */
import { describe, expect, it } from "vitest";
import type {
  DurableRunEvent,
  EventBus,
  Job,
  QueueDriver,
  Run,
  RunEventOf,
  RunStore,
} from "@flowaid/workflow-core";

type Append = Omit<DurableRunEvent, "seq" | "runId" | "at">;

export interface RunStoreFixture {
  store: RunStore;
  /** A run row ready for `createRun` (valid foreign keys for database-backed stores). */
  newRun(): Promise<{ run: Run; created: RunEventOf<"RUN_CREATED"> }>;
  /** Lets lease expiries elapse (real stores: sleep; fake clocks: advance). */
  elapse(ms: number): Promise<void>;
  close?(): Promise<void>;
}

const resumed = (): Append => ({ type: "RUN_RESUMED", reason: "timer", nodeRunId: null }) as Append;

export function runStoreContract(name: string, make: () => Promise<RunStoreFixture>): void {
  describe(`RunStore contract: ${name}`, () => {
    it("appends dense sequence numbers under the lease and fences everyone else", async () => {
      const f = await make();
      const { run, created } = await f.newRun();
      await f.store.createRun(run, created);
      expect(await f.store.acquireLease(run.id, "w1", 30_000)).toMatchObject({
        lastSeq: created.seq,
      });
      expect(await f.store.acquireLease(run.id, "w2", 30_000)).toBeNull();
      const a = await f.store.appendEvents(run.id, [resumed(), resumed()], {
        leaseOwner: "w1",
        expectedSeq: created.seq,
      });
      expect(a).toEqual({ firstSeq: created.seq + 1, lastSeq: created.seq + 2 });
      await expect(
        f.store.appendEvents(run.id, [resumed()], { leaseOwner: "w2", expectedSeq: a.lastSeq }),
      ).rejects.toThrow();
      await expect(
        f.store.appendEvents(run.id, [resumed()], { leaseOwner: "w1", expectedSeq: created.seq }),
      ).rejects.toThrow();
      const events = await f.store.listEvents(run.id, 0, 100);
      expect(events.map((e) => e.seq)).toEqual([created.seq, created.seq + 1, created.seq + 2]);
      expect(await f.store.listEvents(run.id, created.seq, 1)).toHaveLength(1);
      expect(await f.store.listEvents(run.id, 0, 100, ["RUN_CREATED"])).toHaveLength(1);
      await f.close?.();
    });

    it("lets exactly one of two concurrent appends at the same seq win", async () => {
      const f = await make();
      const { run, created } = await f.newRun();
      await f.store.createRun(run, created);
      await f.store.acquireLease(run.id, "w1", 30_000);
      const results = await Promise.allSettled([
        f.store.appendEvents(run.id, [resumed()], { leaseOwner: "w1", expectedSeq: created.seq }),
        f.store.appendEvents(run.id, [resumed()], { leaseOwner: "w1", expectedSeq: created.seq }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      await f.close?.();
    });

    it("expires, renews and releases leases", async () => {
      const f = await make();
      const { run, created } = await f.newRun();
      await f.store.createRun(run, created);
      await f.store.acquireLease(run.id, "w1", 20);
      await f.elapse(40);
      expect((await f.store.expiredLeases(new Date(), 100)).map((l) => l.runId)).toContain(run.id);
      expect(await f.store.acquireLease(run.id, "w2", 30_000)).not.toBeNull();
      expect(await f.store.renewLease(run.id, "w1", 30_000)).toBe(false);
      expect(await f.store.renewLease(run.id, "w2", 30_000)).toBe(true);
      await f.store.releaseLease(run.id, "w2");
      expect(await f.store.acquireLease(run.id, "w3", 30_000)).not.toBeNull();
      await f.close?.();
    });

    it("stores checkpoints and returns the latest at or below a seq", async () => {
      const f = await make();
      const { run, created } = await f.newRun();
      await f.store.createRun(run, created);
      await f.store.saveCheckpoint(run.id, 3, { a: 3 });
      await f.store.saveCheckpoint(run.id, 7, { a: 7 });
      expect(await f.store.latestCheckpoint(run.id, 5)).toEqual({ seq: 3, state: { a: 3 } });
      expect(await f.store.latestCheckpoint(run.id, 100)).toEqual({ seq: 7, state: { a: 7 } });
      expect(await f.store.latestCheckpoint(run.id, 2)).toBeNull();
      await f.close?.();
    });
  });
}

export function queueDriverContract(
  name: string,
  make: () => Promise<{ queue: QueueDriver; close?(): Promise<void> }>,
): void {
  describe(`QueueDriver contract: ${name}`, () => {
    it("delivers every job once across concurrent consumers", async () => {
      const f = await make();
      const { queue } = f;
      const seen: string[] = [];
      const consumer = await queue.consume(
        "run:general",
        (job) => {
          if (job.type === "run.start") seen.push(job.runId);
          return Promise.resolve();
        },
        { concurrency: 4 },
      );
      for (let i = 0; i < 50; i += 1)
        await queue.enqueue("run:general", { type: "run.start", runId: `r${i}` });
      await expect.poll(() => seen.length, { timeout: 10_000 }).toBe(50);
      expect(new Set(seen).size).toBe(50);
      await consumer.stop();
      await f.close?.();
    });

    it("deduplicates pending jobs by id and honours delays", async () => {
      const f = await make();
      const { queue } = f;
      const seen: Job[] = [];
      await queue.enqueue(
        "trace_review",
        { type: "trace_review.run", runId: "x" },
        { jobId: "dup" },
      );
      await queue.enqueue(
        "trace_review",
        { type: "trace_review.run", runId: "x" },
        { jobId: "dup" },
      );
      await queue.enqueue(
        "trace_review",
        { type: "trace_review.run", runId: "later" },
        { delayMs: 150 },
      );
      const began = Date.now();
      let laterAt = 0;
      const consumer = await queue.consume(
        "trace_review",
        (job) => {
          seen.push(job);
          if (job.type === "trace_review.run" && job.runId === "later")
            laterAt = Date.now() - began;
          return Promise.resolve();
        },
        { concurrency: 1 },
      );
      await expect.poll(() => seen.length, { timeout: 5_000 }).toBe(2);
      expect(laterAt).toBeGreaterThanOrEqual(120);
      await consumer.stop();
      await f.close?.();
    });
  });
}

export function eventBusContract(
  name: string,
  make: () => Promise<{ bus: EventBus; close?(): Promise<void> }>,
): void {
  describe(`EventBus contract: ${name}`, () => {
    it("fans messages out to subscribers until they unsubscribe", async () => {
      const f = await make();
      const { bus } = f;
      const a: unknown[] = [];
      const b: unknown[] = [];
      const offA = await bus.subscribe("run:1", (m) => a.push(m));
      const offB = await bus.subscribe("run:1", (m) => b.push(m));
      await bus.publish("run:1", { runId: "1", fromSeq: 1, toSeq: 2 });
      await bus.publish("run:2", { other: true });
      await expect.poll(() => a.length + b.length).toBe(2);
      await offA();
      await bus.publish("run:1", { runId: "1", fromSeq: 3, toSeq: 3 });
      await expect.poll(() => b.length).toBe(2);
      expect(a).toEqual([{ runId: "1", fromSeq: 1, toSeq: 2 }]);
      await offB();
      await f.close?.();
    });
  });
}
