/**
 * Scale mode (REDIS_URL set): ephemeral events travel on Redis, commit notices on Postgres (the
 * store sends them with the append transaction). The hub must hear both.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgEventBus, RUN_EVENTS_CHANNEL } from "@flowaid/database";
import {
  TEST_DATABASE_URL,
  createTestDatabase,
  type TestDatabase,
} from "@flowaid/database/testing";
import { testRedisUrl } from "@flowaid/env/testing";
import { RedisEventBus } from "@flowaid/workflow-runtime";
import { RUN_DELTAS_CHANNEL, RunEventHub } from "./hub.js";

const redisUrl = testRedisUrl();

const until = async (check: () => boolean, ms = 5_000) => {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
};

describe.runIf(Boolean(TEST_DATABASE_URL) && Boolean(redisUrl))("RunEventHub over Redis", () => {
  let db: TestDatabase;
  let bus: RedisEventBus;
  let hub: RunEventHub;
  beforeAll(async () => {
    db = await createTestDatabase();
    bus = new RedisEventBus(redisUrl ?? "", `flowaid-test-${randomUUID().slice(0, 8)}:`);
    hub = new RunEventHub(bus, new PgEventBus(db.app.sql));
  });
  afterAll(async () => {
    await hub.close();
    await bus.close();
    await db.drop();
  });

  it("receives commit notices from Postgres and deltas from Redis", async () => {
    const runId = randomUUID();
    const durable: [number, number][] = [];
    const deltas: unknown[] = [];
    const off = await hub.listen(runId, {
      durable: (from, to) => durable.push([from, to]),
      ephemeral: (e) => deltas.push(e),
    });
    // what PgRunStore.appendEvents sends on commit
    await db.app
      .sql`select pg_notify(${RUN_EVENTS_CHANNEL}, ${JSON.stringify({ runId, fromSeq: 2, toSeq: 4 })})`;
    await bus.publish(RUN_DELTAS_CHANNEL, { runId, event: { type: "GENERATION_DELTA" } });
    await until(() => durable.length > 0 && deltas.length > 0);
    expect(durable).toEqual([[2, 4]]);
    expect(deltas).toEqual([{ type: "GENERATION_DELTA" }]);
    off();
  });
});
