/**
 * Scale mode (REDIS_URL set): the bus is Redis pub/sub, but commit notices are `pg_notify`s sent
 * inside the append transaction. The worker's terminal bookkeeping (subflow completion) must
 * still see them.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL } from "@flowaid/database/testing";
import { testRedisUrl } from "@flowaid/env/testing";
import { RedisEventBus } from "@flowaid/workflow-runtime";
import { createHarness, type Harness } from "./test/setup.js";

const redisUrl = testRedisUrl();
const ref = (node: string, port: string) => ({ kind: "ref", ref: { kind: "port", node, port } });

describe.runIf(Boolean(TEST_DATABASE_URL) && Boolean(redisUrl))(
  "worker with a Redis event bus (Postgres)",
  () => {
    let h: Harness;
    let bus: RedisEventBus;
    beforeAll(async () => {
      bus = new RedisEventBus(redisUrl ?? "", `flowaid-test-${randomUUID().slice(0, 8)}:`);
      h = await createHarness({ extra: () => ({ bus }) });
    });
    afterAll(async () => {
      await h.close();
      await bus.close();
    });

    it("completes a subflow back into its parent", async () => {
      const child = await h.deploy("Child", {
        inputs: { type: "object", properties: { x: { type: "string" } }, required: ["x"] },
        outputs: { type: "object", properties: { y: {} } },
        nodes: [
          { id: "start", kind: "input", name: "Input" },
          {
            id: "done",
            kind: "output",
            name: "Done",
            value: { kind: "object", fields: { y: ref("start", "x") } },
          },
        ],
      });
      const parent = await h.deploy("Parent", {
        inputs: { type: "object", properties: { x: { type: "string" } }, required: ["x"] },
        outputs: { type: "object", properties: { fromChild: {} } },
        nodes: [
          { id: "start", kind: "input", name: "Input" },
          {
            id: "child",
            kind: "subflow",
            name: "Child",
            workflowId: child.workflowId,
            inputs: { x: ref("start", "x") },
            timeoutMs: 30_000,
          },
          {
            id: "done",
            kind: "output",
            name: "Done",
            value: { kind: "object", fields: { fromChild: ref("child", "output") } },
          },
        ],
      });
      const runId = await h.start(parent.workflowId, parent.versionId, { x: "hi" });
      const run = await h.waitFor(runId, ["completed", "failed"], 15_000);
      expect(run.error).toBeNull();
      expect(run.output).toEqual({ fromChild: { y: "hi" } });
    });
  },
);
