import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { uuidv7 } from "@flowaid/shared";
import { WorkerLostError, type DurableRunEvent } from "@flowaid/workflow-core";
import { reproject } from "../reproject.js";
import { humanTasks, nodeRuns, runs, runTimers } from "../schema.js";
import { createTestDatabase, describeDb, type TestDatabase } from "../test/pg.js";
import {
  fixture,
  newRun,
  node,
  seedTenant,
  steppingClock,
  supportTriageLog,
  type Tenant,
} from "../test/golden.js";
import { PgEventBus } from "./PgEventBus.js";
import { PgRunStore, recordedKey } from "./PgRunStore.js";

type Input = Omit<DurableRunEvent, "seq" | "runId" | "at">;

describeDb("PgRunStore", () => {
  let t: TestDatabase;
  let tenant: Tenant;
  beforeAll(async () => {
    t = await createTestDatabase();
    tenant = await seedTenant(t.app);
  });
  afterAll(async () => {
    await t?.drop();
  });

  /** Creates a run, takes the lease as w1 and appends every batch; returns the store and ids. */
  async function playSupportTriage() {
    const store = new PgRunStore(t.app, { now: steppingClock() });
    const { run, created } = newRun(tenant);
    await store.createRun(run, created);
    expect(await store.acquireLease(run.id, "w1", 30_000)).toMatchObject({
      runId: run.id,
      lastSeq: 1,
    });
    const log = supportTriageLog();
    let seq = 1;
    for (const batch of log.batches) {
      const result = await store.appendEvents(run.id, batch, {
        leaseOwner: "w1",
        expectedSeq: seq,
      });
      expect(result.firstSeq).toBe(seq + 1);
      seq = result.lastSeq;
    }
    return { store, run, ids: log.ids, lastSeq: seq };
  }

  /** Every projection row of a run, normalised for comparison. */
  async function snapshot(runId: string) {
    return t.app.system(async (tx) => ({
      run: (await tx.select().from(runs).where(eq(runs.id, runId)))[0],
      nodeRuns: await tx
        .select()
        .from(nodeRuns)
        .where(eq(nodeRuns.runId, runId))
        .orderBy(asc(nodeRuns.scheduledSeq)),
      tasks: await tx.select().from(humanTasks).where(eq(humanTasks.runId, runId)),
      timers: await tx
        .select()
        .from(runTimers)
        .where(eq(runTimers.runId, runId))
        .orderBy(asc(runTimers.fireAt)),
    }));
  }

  describe("golden support-triage log", () => {
    let played: Awaited<ReturnType<typeof playSupportTriage>>;
    beforeAll(async () => {
      played = await playSupportTriage();
    });

    it("stores every event with a dense seq starting at 1", async () => {
      const events = await played.store.listEvents(played.run.id, 0, 1000);
      expect(events.map((e) => e.seq)).toEqual(
        Array.from({ length: played.lastSeq }, (_, i) => i + 1),
      );
      expect(events[0]?.type).toBe("RUN_CREATED");
      expect(events.at(-1)?.type).toBe("RUN_COMPLETED");
      const decisions = await played.store.listEvents(played.run.id, 0, 10, ["DECISION_COMPLETED"]);
      expect(decisions).toHaveLength(1);
      expect(await played.store.listEvents(played.run.id, 5, 2)).toHaveLength(2);
    });

    it("projects the run row", async () => {
      const run = await played.store.getRun(played.run.id);
      expect(run).toMatchObject({
        status: "completed",
        outcome: "human_approved",
        lastSeq: played.lastSeq,
        nodeRunCount: 8,
        usage: { inputTokens: 1842, outputTokens: 296 },
        costUsd: 0.00087,
      });
      expect(run?.startedAt).not.toBeNull();
      expect(run?.endedAt).not.toBeNull();
      const [row] = await t.app.system((tx) =>
        tx.select().from(runs).where(eq(runs.id, played.run.id)),
      );
      expect(row?.leaseOwner).toBeNull();
      expect(row?.expiresAt?.getTime()).toBe((row?.endedAt?.getTime() ?? 0) + 90 * 86_400_000);
    });

    it("projects node runs, decisions, retries and latencies", async () => {
      const list = await played.store.listNodeRuns(played.run.id);
      const byId = new Map(list.map((n) => [n.id, n]));
      expect(list.map((n) => [n.nodeId, n.attempt, n.status])).toEqual([
        ["start", 1, "completed"],
        ["intent", 1, "completed"],
        ["fetch_account", 1, "retry_wait"],
        ["fetch_account", 2, "completed"],
        ["draft", 1, "completed"],
        ["approve", 1, "completed"],
        ["out_auto", 1, "skipped"],
        ["out_human", 1, "completed"],
      ]);
      const intent = byId.get(played.ids.intent);
      expect(intent?.decision?.provider).toBe("typesafe");
      expect(intent?.costUsd).toBeCloseTo(0.000206);
      // Scheduled and started in one batch: the events share a timestamp.
      expect(intent?.queueLatencyMs).toBe(0);
      expect(byId.get(played.ids.fetch1)?.error?.code).toBe("NETWORK_ERROR");
      expect(byId.get(played.ids.draft)?.usage).toEqual({ inputTokens: 640, outputTokens: 118 });
      const [decisionCols] = await t.app.system((tx) =>
        tx.select().from(nodeRuns).where(eq(nodeRuns.id, played.ids.intent)),
      );
      expect(decisionCols).toMatchObject({
        decisionKind: "choice",
        decisionProvider: "typesafe",
        decisionConfidence: "0.91000",
      });
    });

    it("projects the human task and the timers", async () => {
      const task = await played.store.getHumanTask(played.ids.task);
      expect(task).toMatchObject({
        status: "responded",
        respondedBy: "user:maria",
        workflowId: tenant.workflowId,
      });
      const snap = await snapshot(played.run.id);
      expect(snap.tasks[0]?.assignees).toEqual(["user:lead"]);
      expect(snap.timers.map((x) => [x.purpose, x.firedAt !== null])).toEqual([
        ["retry", true],
        ["human_expiry", false],
      ]);
    });

    it("returns recorded outputs and node outputs for replay", async () => {
      const recorded = await played.store.recordedOutputs(played.run.id);
      expect(recorded.get(recordedKey("fetch_account", "", "hash-fetch_account"))).toMatchObject({
        nodeRunId: played.ids.fetch2,
        output: { plan: "gold" },
      });
      expect(recorded.has(recordedKey("out_auto", "", "hash-out_auto"))).toBe(false);
      expect(await played.store.getNodeOutput(played.run.id, "", "fetch_account")).toEqual({
        output: { plan: "gold" },
        nodeRunId: played.ids.fetch2,
        attempt: 2,
      });
      expect(await played.store.getNodeOutput(played.run.id, "", "nope")).toBeNull();
    });

    it("reprojects to exactly the same rows (project(events) ≡ rows)", async () => {
      const before = await snapshot(played.run.id);
      const result = await reproject(t.app, played.run.id);
      expect(result).toMatchObject({ events: played.lastSeq, nodeRuns: 8 });
      expect(await snapshot(played.run.id)).toEqual(before);
    });

    it("refuses appends after the terminal event (the lease was released)", async () => {
      await expect(
        played.store.appendEvents(
          played.run.id,
          [{ type: "RUN_RESUMED", reason: "timer", nodeRunId: null } as Input],
          {
            leaseOwner: "w1",
            expectedSeq: played.lastSeq,
          },
        ),
      ).rejects.toBeInstanceOf(WorkerLostError);
      expect(await played.store.acquireLease(played.run.id, "w2", 30_000)).toBeNull();
    });
  });

  describe("fencing", () => {
    it("lets exactly one of two concurrent writers append at a seq", async () => {
      const store = new PgRunStore(t.app);
      const { run, created } = newRun(tenant);
      await store.createRun(run, created);
      await store.acquireLease(run.id, "w1", 30_000);
      const batch = [
        {
          type: "RUN_STARTED",
          workerId: "w1",
          leaseUntil: "2026-09-23T10:00:30.000Z",
          deadlineAt: "2026-09-23T11:00:00.000Z",
        } as Input,
      ];
      const results = await Promise.allSettled([
        store.appendEvents(run.id, batch, { leaseOwner: "w1", expectedSeq: 1 }),
        store.appendEvents(run.id, batch, { leaseOwner: "w1", expectedSeq: 1 }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected");
      expect(rejected?.status === "rejected" ? rejected.reason : null).toBeInstanceOf(
        WorkerLostError,
      );
      expect(await store.listEvents(run.id, 0, 10)).toHaveLength(2);
    });

    it("fences out a worker whose lease was taken over", async () => {
      const store = new PgRunStore(t.app);
      const { run, created } = newRun(tenant);
      await store.createRun(run, created);
      expect(await store.acquireLease(run.id, "w1", 1)).not.toBeNull();
      await new Promise((r) => setTimeout(r, 25));
      expect((await store.expiredLeases(new Date(), 10)).map((l) => l.runId)).toContain(run.id);
      expect(await store.acquireLease(run.id, "w2", 30_000)).toMatchObject({
        workerId: "w2",
        lastSeq: 1,
      });
      expect(await store.renewLease(run.id, "w1", 30_000)).toBe(false);
      await expect(
        store.appendEvents(
          run.id,
          [{ type: "RUN_RESUMED", reason: "timer", nodeRunId: null } as Input],
          {
            leaseOwner: "w1",
            expectedSeq: 1,
          },
        ),
      ).rejects.toBeInstanceOf(WorkerLostError);
      expect(await store.renewLease(run.id, "w2", 30_000)).toBe(true);
      await store.releaseLease(run.id, "w2");
      expect(await store.acquireLease(run.id, "w3", 30_000)).not.toBeNull();
    });

    it("rolls the whole batch back when one event is too large", async () => {
      const store = new PgRunStore(t.app);
      const { run, created } = newRun(tenant);
      await store.createRun(run, created);
      await store.acquireLease(run.id, "w1", 30_000);
      const huge = "x".repeat(300_000);
      const id = uuidv7();
      await expect(
        store.appendEvents(
          run.id,
          [
            {
              type: "NODE_SCHEDULED",
              ...node(id, "big"),
              kind: "task",
              nodeType: null,
              inputHash: "h",
              idempotencyKey: null,
              reusedFromNodeRunId: null,
              batchId: null,
            } as Input,
            { type: "LOG", ...node(id, "big"), level: "info", message: huge, data: null } as Input,
          ],
          { leaseOwner: "w1", expectedSeq: 1 },
        ),
      ).rejects.toThrow();
      expect((await store.getRun(run.id))?.lastSeq).toBe(1);
      expect(await store.listNodeRuns(run.id)).toEqual([]);
    });
  });

  describe("timers, human tasks, checkpoints and cancellation", () => {
    let played: Awaited<ReturnType<typeof playSupportTriage>>;
    beforeAll(async () => {
      played = await playSupportTriage();
    });

    it("fires a due timer exactly once under concurrency", async () => {
      const due = await played.store.dueTimers(new Date("2026-09-25T00:00:00.000Z"), 100);
      expect(due.map((d) => d.id)).toContain(played.ids.expiryTimer);
      expect(due.map((d) => d.id)).not.toContain(played.ids.retryTimer);
      const fired = await Promise.all(
        Array.from({ length: 8 }, () => played.store.markTimerFired(played.ids.expiryTimer)),
      );
      expect(fired.filter(Boolean)).toHaveLength(1);
      expect(await played.store.cancelTimer(played.ids.expiryTimer)).toBe(false);
    });

    it("responds to a human task exactly once (compare-and-set)", async () => {
      const store = new PgRunStore(t.app);
      const { run, created } = newRun(tenant);
      await store.createRun(run, created);
      await store.acquireLease(run.id, "w1", 30_000);
      const nr = uuidv7();
      const task = uuidv7();
      const approve = node(nr, "approve");
      await store.appendEvents(
        run.id,
        [
          {
            type: "NODE_SCHEDULED",
            ...approve,
            kind: "human",
            nodeType: null,
            inputHash: "h",
            idempotencyKey: null,
            reusedFromNodeRunId: null,
            batchId: null,
          } as Input,
          {
            type: "HUMAN_APPROVAL_REQUESTED",
            ...approve,
            humanTaskId: task,
            request: {
              ...fixture("HUMAN_APPROVAL_REQUESTED").request,
              assignees: [],
              expiresAt: null,
            },
          } as unknown as Input,
        ],
        { leaseOwner: "w1", expectedSeq: 1 },
      );
      const answers = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          store.respondHumanTask(task, { action: "approve" }, `user:${i}`),
        ),
      );
      expect(answers.filter(Boolean)).toHaveLength(1);
      expect((await store.getHumanTask(task))?.status).toBe("responded");
      expect(await store.getHumanTask(uuidv7())).toBeNull();
    });

    it("keeps checkpoints and returns the latest at or below a seq", async () => {
      await played.store.saveCheckpoint(played.run.id, 10, { at: 10 });
      await played.store.saveCheckpoint(played.run.id, 20, { at: 20 });
      await played.store.saveCheckpoint(played.run.id, 20, { at: 21 });
      expect(await played.store.latestCheckpoint(played.run.id, 15)).toEqual({
        seq: 10,
        state: { at: 10 },
      });
      expect(await played.store.latestCheckpoint(played.run.id, 99)).toEqual({
        seq: 20,
        state: { at: 21 },
      });
      expect(await played.store.latestCheckpoint(played.run.id, 5)).toBeNull();
    });

    it("records a cancel request once, and not on a finished run", async () => {
      const store = new PgRunStore(t.app);
      const { run, created } = newRun(tenant);
      await store.createRun(run, created);
      expect(await store.cancelRequest(run.id)).toBeNull();
      expect(await store.requestCancel(run.id, "user:1", "wrong input")).toBe(true);
      expect(await store.requestCancel(run.id, "user:2", null)).toBe(false);
      expect(await store.cancelRequest(run.id)).toMatchObject({
        by: "user:1",
        reason: "wrong input",
      });
      expect(await played.store.requestCancel(played.run.id, "user:1", null)).toBe(false);
    });

    it("cancels open human tasks and event waits when the run is cancelled", async () => {
      const store = new PgRunStore(t.app);
      const { run, created } = newRun(tenant);
      await store.createRun(run, created);
      await store.acquireLease(run.id, "w1", 30_000);
      const [a, b, task] = [uuidv7(), uuidv7(), uuidv7()];
      await store.appendEvents(
        run.id,
        [
          {
            type: "NODE_SCHEDULED",
            ...node(a, "approve"),
            kind: "human",
            nodeType: null,
            inputHash: "h",
            idempotencyKey: null,
            reusedFromNodeRunId: null,
            batchId: null,
          } as Input,
          {
            type: "HUMAN_APPROVAL_REQUESTED",
            ...node(a, "approve"),
            humanTaskId: task,
            request: {
              ...fixture("HUMAN_APPROVAL_REQUESTED").request,
              assignees: [],
              expiresAt: null,
            },
          } as unknown as Input,
          {
            type: "NODE_SCHEDULED",
            ...node(b, "await_payment"),
            kind: "wait",
            nodeType: null,
            inputHash: "h",
            idempotencyKey: null,
            reusedFromNodeRunId: null,
            batchId: null,
          } as Input,
          {
            type: "NODE_WAITING",
            ...node(b, "await_payment"),
            reason: "event",
            ref: "payment.received",
            state: null,
          } as Input,
        ],
        { leaseOwner: "w1", expectedSeq: 1 },
      );
      const subscriptions = () =>
        t.app.sql`select event_name from event_subscriptions where run_id = ${run.id}`;
      expect(
        await t.admin`select event_name from event_subscriptions where run_id = ${run.id}`,
      ).toHaveLength(1);
      await store.appendEvents(
        run.id,
        [
          { type: "NODE_CANCELLED", ...node(b, "await_payment"), reason: "run_cancelled" } as Input,
          {
            type: "RUN_CANCELLED",
            by: "user:1",
            usage: { inputTokens: 0, outputTokens: 0 },
            costUsd: 0,
            durationMs: 10,
          } as Input,
        ],
        { leaseOwner: "w1", expectedSeq: 5 },
      );
      expect((await store.getHumanTask(task))?.status).toBe("cancelled");
      expect(
        await t.admin`select 1 from event_subscriptions where run_id = ${run.id}`,
      ).toHaveLength(0);
      expect(subscriptions).toBeTypeOf("function");
      expect((await store.getRun(run.id))?.status).toBe("cancelled");
    });
  });

  it("notifies subscribers with ids only after commit", async () => {
    const bus = new PgEventBus(t.app.sql);
    const messages: unknown[] = [];
    const unsubscribe = await bus.subscribe("run_events", (m) => messages.push(m));
    const store = new PgRunStore(t.app);
    const { run, created } = newRun(tenant);
    await store.createRun(run, created);
    await store.acquireLease(run.id, "w1", 30_000);
    await store.appendEvents(
      run.id,
      [{ type: "RUN_RESUMED", reason: "timer", nodeRunId: null } as Input],
      {
        leaseOwner: "w1",
        expectedSeq: 1,
      },
    );
    await expect
      .poll(() => messages.filter((m) => (m as { runId: string }).runId === run.id).length)
      .toBe(2);
    expect(messages.filter((m) => (m as { runId: string }).runId === run.id)).toEqual([
      { runId: run.id, fromSeq: 1, toSeq: 1 },
      { runId: run.id, fromSeq: 2, toSeq: 2 },
    ]);
    await unsubscribe();
  });
});
