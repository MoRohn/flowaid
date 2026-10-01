import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { runs, schedules, workspaces } from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import { eq } from "drizzle-orm";
import { dueFires, tickSchedules } from "./jobs/scheduler.js";
import { createHarness, type Harness } from "./test/setup.js";

describe("dueFires", () => {
  const now = new Date("2026-09-27T12:07:30Z");
  const next = new Date("2026-09-27T12:00:00Z");
  it("skip and one fire once; all catches up to the limit", () => {
    expect(dueFires("*/5 * * * *", "UTC", next, now, "skip", 10)).toEqual([next]);
    expect(dueFires("*/5 * * * *", "UTC", next, now, "one", 10)).toEqual([next]);
    expect(
      dueFires("*/5 * * * *", "UTC", next, now, "all", 10).map((d) => d.toISOString()),
    ).toEqual(["2026-09-27T12:00:00.000Z", "2026-09-27T12:05:00.000Z"]);
    expect(dueFires("* * * * *", "UTC", next, now, "all", 3)).toHaveLength(3);
    expect(dueFires("* * * * *", "UTC", new Date("2026-09-27T13:00:00Z"), now, "all", 3)).toEqual(
      [],
    );
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
        nextRunAt: new Date(Date.now() - 60_000),
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
        .set({ settings: { budgets: { monthlyCostUsd: 2 } } })
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
    const failed: string[] = [];
    try {
      expect(
        await tickSchedules({
          db: h.db.app,
          queue: h.queue,
          onFailed: (f) => failed.push(f.error),
        }),
      ).toEqual([]);
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
