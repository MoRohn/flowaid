import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgArtifactIndex, stateEntries } from "@flowaid/database";
import { describeDb } from "@flowaid/database/testing";
import { LocalArtifactStore } from "@flowaid/storage";
import type { Job, QueueDriver, QueueName } from "@flowaid/workflow-core";
import { scheduleRetentionSweep } from "./jobs/maintenance.js";
import { createHarness, type Harness } from "./test/setup.js";

describe("scheduleRetentionSweep", () => {
  it("enqueues retention.sweep on the maintenance queue at each fire", async () => {
    const enqueued: { queue: QueueName; job: Job; jobId?: string }[] = [];
    const queue = {
      enqueue: (q: QueueName, job: Job, opts?: { jobId?: string }) => {
        enqueued.push({ queue: q, job, ...(opts?.jobId ? { jobId: opts.jobId } : {}) });
        return Promise.resolve();
      },
    } as unknown as QueueDriver;
    // croner's optional seconds field: every second
    const stop = scheduleRetentionSweep({ queue, cron: "* * * * * *" });
    await expect.poll(() => enqueued.length, { timeout: 3_000 }).toBeGreaterThan(0);
    stop();
    expect(enqueued[0]).toMatchObject({
      queue: "maintenance",
      job: { type: "retention.sweep" },
      jobId: expect.stringMatching(/^retention\.sweep:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    });
  });
});

describeDb("maintenance queue (Postgres)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  it("runs the retention sweep and deletes expired state and artifact bytes", async () => {
    await h.db.app.system((tx) =>
      tx.insert(stateEntries).values([
        {
          workspaceId: h.workspaceId,
          namespace: "session:s1",
          key: "old",
          value: 1,
          expiresAt: new Date(Date.now() - 60_000),
        },
        { workspaceId: h.workspaceId, namespace: "session:s1", key: "kept", value: 2 },
      ]),
    );
    const index = new PgArtifactIndex(h.db.app);
    const local = new LocalArtifactStore(h.artifactsDir);
    const artifact = await index.create({
      workspaceId: h.workspaceId,
      name: "old.txt",
      mimeType: "text/plain",
      kind: "output_overflow",
      storage: "local",
      bytes: 3,
      sha256: "x",
      expiresAt: new Date(Date.now() - 60_000),
    });
    await local.put(artifact.storageKey, new Uint8Array([1, 2, 3]));

    expect(h.worker.lastRetentionSweep).toBeNull();
    await h.queue.enqueue("maintenance", { type: "retention.sweep", at: new Date().toISOString() });
    await expect.poll(() => h.worker.lastRetentionSweep, { timeout: 10_000 }).not.toBeNull();
    expect(h.worker.lastRetentionSweep).toMatchObject({
      done: true,
      result: { stateEntries: 1, artifacts: 1 },
    });
    const keys = (
      await h.db.app.system((tx) => tx.select({ key: stateEntries.key }).from(stateEntries))
    ).map((r) => r.key);
    expect(keys).toEqual(["kept"]);
    expect(await index.get(h.workspaceId, artifact.id)).toBeNull();
    await expect(local.get(artifact.storageKey)).rejects.toThrow();
  });
});
