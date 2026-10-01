import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { runs, schedules, workspaces } from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import { eq } from "drizzle-orm";
import {
  DROPPED_COUNT_LIMIT,
  MAX_CATCH_UP,
  MISFIRE_GRACE_MS,
  dueFires,
  tickSchedules,
} from "./jobs/scheduler.js";
import { createHarness, type Harness } from "./test/setup.js";

const iso = (d: Date[]) => d.map((x) => x.toISOString());

describe("dueFires", () => {
  const at = (t: string) => new Date(`2026-09-27T${t}Z`);
  const every5 = (next: Date, now: Date, mode: "skip" | "one" | "all", max = 10) =>
    dueFires("*/5 * * * *", "UTC", next, now, mode, max);

  it("fires an on-time tick the same way in every mode", () => {
    for (const mode of ["skip", "one", "all"] as const)
      expect(every5(at("12:00:00"), at("12:00:14"), mode)).toEqual({
        fire: [at("12:00:00")],
        dropped: 0,
      });
    expect(every5(at("12:05:00"), at("12:00:14"), "all")).toEqual({ fire: [], dropped: 0 });
  });

  it("after downtime: skip starts no missed run, one starts exactly one, all is bounded", () => {
    // down from 11:00 to 12:07:30: 14 ticks (11:00 … 12:05) were missed
    const next = at("11:00:00");
    const now = at("12:07:30");
    expect(every5(next, now, "skip")).toEqual({ fire: [], dropped: 14 });
    expect(every5(next, now, "one")).toEqual({ fire: [at("12:05:00")], dropped: 13 });
    const all = every5(next, now, "all", 3);
    expect(iso(all.fire)).toEqual([
      "2026-09-27T11:55:00.000Z",
      "2026-09-27T12:00:00.000Z",
      "2026-09-27T12:05:00.000Z",
    ]);
    expect(all.dropped).toBe(11);
    expect(every5(next, now, "all", 50).fire).toHaveLength(14);
    // max_catch_up is capped at MAX_CATCH_UP
    expect(
      dueFires("* * * * *", "UTC", at("00:00:00"), at("12:00:30"), "all", 10_000).fire,
    ).toHaveLength(MAX_CATCH_UP);
  });

  it("skip still starts the newest tick when it is on time after downtime", () => {
    // back at 12:05:20: 11:00 … 12:00 were missed, 12:05 is 20 s old
    expect(every5(at("11:00:00"), at("12:05:20"), "skip")).toEqual({
      fire: [at("12:05:00")],
      dropped: 13,
    });
    // the grace window is a parameter (the scheduler widens it to two polls)
    expect(every5(at("12:00:00"), at("12:03:00"), "skip").fire).toEqual([]);
    expect(
      dueFires("*/5 * * * *", "UTC", at("12:00:00"), at("12:03:00"), "skip", 10, 300_000).fire,
    ).toEqual([at("12:00:00")]);
    expect(MISFIRE_GRACE_MS).toBe(60_000);
  });

  it("keeps a jittered next run as the oldest fire", () => {
    const jittered = at("12:00:03");
    expect(every5(jittered, at("12:00:10"), "one").fire).toEqual([jittered]);
    expect(iso(every5(jittered, at("12:05:10"), "all").fire)).toEqual([
      "2026-09-27T12:00:03.000Z",
      "2026-09-27T12:05:00.000Z",
    ]);
  });

  it("counts a very long outage without walking all of it", () => {
    const r = dueFires("* * * * * *", "UTC", at("00:00:00"), at("12:00:00"), "skip", 10);
    expect(r).toEqual({ fire: [at("12:00:00")], dropped: DROPPED_COUNT_LIMIT });
  });
});

describeDb("scheduler (Postgres)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  it("fires a due schedule once across concurrent ticks, and the worker runs it", async () => {
    const { workflowId } = await h.deploy("Nightly", {
      inputs: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      outputs: { type: "object", properties: { greeting: { type: "string" } } },
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        {
          id: "greet",
          kind: "task",
          type: "flowaid.data.template",
          typeVersion: "1.0.0",
          name: "Greet",
          config: { template: "Good night {{ start.name }}" },
        },
        {
          id: "done",
          kind: "output",
          name: "Done",
          value: {
            kind: "object",
            fields: {
              greeting: { kind: "ref", ref: { kind: "port", node: "greet", port: "text" } },
            },
          },
        },
      ],
    });
    const scheduleId = uuidv7();
    await h.db.app.system((tx) =>
      tx.insert(schedules).values({
        id: scheduleId,
        workspaceId: h.workspaceId,
        workflowId,
        environmentId: h.environmentId,
        cron: "0 3 * * *",
        timezone: "UTC",
        input: { name: "ops" },
        nextRunAt: new Date(Date.now() - 5_000),
      }),
    );
    const [a, b] = await Promise.all([
      tickSchedules({ db: h.db.app, queue: h.queue }),
      tickSchedules({ db: h.db.app, queue: h.queue }),
    ]);
    const started = [...(a ?? []), ...(b ?? [])];
    expect(started).toHaveLength(1);
    const [row] = await h.db.app.system((tx) =>
      tx.select().from(schedules).where(eq(schedules.id, scheduleId)),
    );
    expect(row?.nextRunAt?.getTime()).toBeGreaterThan(Date.now());
    expect(row?.lastRunId).toBe(started[0]);
    const run = await h.waitFor(started[0] as string, ["completed", "failed"]);
    expect(run).toMatchObject({
      status: "completed",
      origin: "schedule",
      output: { greeting: "Good night ops" },
    });
    expect(run.idempotencyKey).toMatch(new RegExp(`^schedule:${scheduleId}:`));
    expect(await tickSchedules({ db: h.db.app, queue: h.queue })).toEqual([]);
    const all = await h.db.app.system((tx) =>
      tx.select({ id: runs.id }).from(runs).where(eq(runs.workflowId, workflowId)),
    );
    expect(all).toHaveLength(1);
  });

  it("records an error when the workflow is not deployed", async () => {
    const { workflowId } = await h.deploy("Orphan", {
      inputs: { type: "object", properties: {} },
      outputs: { type: "object", properties: {} },
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        { id: "done", kind: "output", name: "Done", value: { kind: "object", fields: {} } },
      ],
    });
    await h.db.app.system((tx) =>
      tx.execute(`delete from workflow_deployments where workflow_id = '${workflowId}'` as never),
    );
    const scheduleId = uuidv7();
    await h.db.app.system((tx) =>
      tx.insert(schedules).values({
        id: scheduleId,
        workspaceId: h.workspaceId,
        workflowId,
        environmentId: h.environmentId,
        cron: "0 3 * * *",
        nextRunAt: new Date(Date.now() - 1000),
      }),
    );
    expect(await tickSchedules({ db: h.db.app, queue: h.queue })).toEqual([]);
    const [row] = await h.db.app.system((tx) =>
      tx.select().from(schedules).where(eq(schedules.id, scheduleId)),
    );
    expect(row?.lastError).toMatch(/not deployed/);
  });
  describe("catch-up after downtime (controlled clock)", () => {
    let workflowId: string;
    beforeAll(async () => {
      ({ workflowId } = await h.deploy("Every five", {
        inputs: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
        outputs: { type: "object", properties: {} },
        nodes: [
          { id: "start", kind: "input", name: "Input" },
          { id: "done", kind: "output", name: "Done", value: { kind: "object", fields: {} } },
        ],
      }));
    });
    // the clock: 2020, so no other test's schedule is due
    const now = new Date("2020-03-02T12:07:30Z");
    const tick = () => tickSchedules({ db: h.db.app, queue: h.queue, now: () => now });
    const schedule = async (values: Partial<typeof schedules.$inferInsert>) => {
      const id = uuidv7();
      await h.db.app.system((tx) =>
        tx.insert(schedules).values({
          id,
          workspaceId: h.workspaceId,
          workflowId,
          environmentId: h.environmentId,
          cron: "*/5 * * * *",
          input: { name: "ops" },
          // down since 11:00: 14 ticks missed by 12:07:30
          nextRunAt: new Date("2020-03-02T11:00:00Z"),
          ...values,
        }),
      );
      return id;
    };
    const rowOf = async (id: string) =>
      (await h.db.app.system((tx) => tx.select().from(schedules).where(eq(schedules.id, id))))[0];
    const firesOf = async (id: string) =>
      (
        await h.db.app.system((tx) =>
          tx.select({ labels: runs.labels }).from(runs).where(eq(runs.workflowId, workflowId)),
        )
      )
        .filter((r) => r.labels.scheduleId === id)
        .map((r) => r.labels.fireAt)
        .sort();

    it("skip starts no missed run and only waits for the next tick", async () => {
      const id = await schedule({ catchUp: "skip" });
      expect(await tick()).toEqual([]);
      expect(await firesOf(id)).toEqual([]);
      const row = await rowOf(id);
      expect(row?.nextRunAt?.toISOString()).toBe("2020-03-02T12:10:00.000Z");
      expect(row?.lastError).toBe("skipped 14 missed runs (catch-up: skip)");
      expect(row?.lastRunAt).toBeNull();
    });

    it("one starts exactly one run for all the missed ticks", async () => {
      const id = await schedule({ catchUp: "one" });
      expect(await tick()).toHaveLength(1);
      expect(await firesOf(id)).toEqual(["2020-03-02T12:05:00.000Z"]);
      const row = await rowOf(id);
      expect(row?.nextRunAt?.toISOString()).toBe("2020-03-02T12:10:00.000Z");
      expect(row?.lastError).toBeNull();
      expect(await tick()).toEqual([]);
    });

    it("all starts the newest max_catch_up missed ticks", async () => {
      const id = await schedule({ catchUp: "all", maxCatchUp: 3, overlap: "allow" });
      expect(await tick()).toHaveLength(3);
      expect(await firesOf(id)).toEqual([
        "2020-03-02T11:55:00.000Z",
        "2020-03-02T12:00:00.000Z",
        "2020-03-02T12:05:00.000Z",
      ]);
      expect((await rowOf(id))?.lastError).toMatch(/^skipped the oldest 11 missed runs/);
    });

    it("records a clear error instead of running a schedule whose input is invalid", async () => {
      const failed: { scheduleId: string; error: string }[] = [];
      const id = await schedule({
        catchUp: "one",
        input: { nom: "ops" },
        nextRunAt: new Date("2020-03-02T12:05:00Z"),
      });
      expect(
        await tickSchedules({
          db: h.db.app,
          queue: h.queue,
          now: () => now,
          onFailed: (f) => failed.push(f),
        }),
      ).toEqual([]);
      expect(await firesOf(id)).toEqual([]);
      const message =
        "the schedule's input does not match the deployed version's inputs, so no run was started: / must have required property 'name'";
      expect((await rowOf(id))?.lastError).toBe(message);
      expect(failed).toEqual([expect.objectContaining({ scheduleId: id, error: message })]);
      // the schedule moves on to its next tick
      expect((await rowOf(id))?.nextRunAt?.toISOString()).toBe("2020-03-02T12:10:00.000Z");
    });
  });

  it("refuses a fire once the workspace's monthly budget is spent", async () => {
    const { workflowId, versionId } = await h.deploy("Over budget", {
      inputs: { type: "object", properties: {} },
      outputs: { type: "object", properties: {} },
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        { id: "done", kind: "output", name: "Done", value: { kind: "object", fields: {} } },
      ],
    });
    const earlier = await h.start(workflowId, versionId, {});
    await h.waitFor(earlier, ["completed", "failed"]);
    await h.db.app.system(async (tx) => {
      await tx.update(runs).set({ costUsd: "2" }).where(eq(runs.id, earlier));
      await tx
        .update(workspaces)
        .set({ settings: { budgets: { monthlyCostUsd: 2 } } as never })
        .where(eq(workspaces.id, h.workspaceId));
    });
    const scheduleId = uuidv7();
    await h.db.app.system((tx) =>
      tx.insert(schedules).values({
        id: scheduleId,
        workspaceId: h.workspaceId,
        workflowId,
        environmentId: h.environmentId,
        cron: "0 3 * * *",
        nextRunAt: new Date(Date.now() - 1000),
      }),
    );
    // other tests leave schedules that are due on the real clock: count only this one
    const failed: string[] = [];
    try {
      await tickSchedules({
        db: h.db.app,
        queue: h.queue,
        onFailed: (f) => {
          if (f.scheduleId === scheduleId) failed.push(f.error);
        },
      });
      const fired = await h.db.app.system((tx) =>
        tx.select({ labels: runs.labels }).from(runs).where(eq(runs.workflowId, workflowId)),
      );
      expect(fired.filter((r) => r.labels.scheduleId === scheduleId)).toEqual([]);
      const [row] = await h.db.app.system((tx) =>
        tx.select().from(schedules).where(eq(schedules.id, scheduleId)),
      );
      expect(row?.lastError).toMatch(/monthly budget of \$2\.00 is used up/);
      expect(failed).toHaveLength(1);
    } finally {
      await h.db.app.system((tx) =>
        tx.update(workspaces).set({ settings: {} }).where(eq(workspaces.id, h.workspaceId)),
      );
    }
  });
});
