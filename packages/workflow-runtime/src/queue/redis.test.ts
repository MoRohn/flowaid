import { randomUUID } from "node:crypto";
import { describe } from "vitest";
import { testRedisUrl } from "@flowaid/env/testing";
import { eventBusContract, queueDriverContract } from "../testing/contractSuite.js";
import { BullMqQueueDriver } from "./BullMqQueueDriver.js";
import { RedisEventBus } from "./RedisEventBus.js";

const url = testRedisUrl();

describe.runIf(Boolean(url))("Redis drivers", () => {
  queueDriverContract("BullMQ", () => {
    const u = new URL(url ?? "redis://localhost:6379");
    const queue = new BullMqQueueDriver({
      connection: { host: u.hostname, port: Number(u.port || 6379), maxRetriesPerRequest: null },
      prefix: `flowaid-test-${randomUUID().slice(0, 8)}`,
    });
    return Promise.resolve({ queue, close: () => queue.close() });
  });
  eventBusContract("Redis pub/sub", () => {
    const bus = new RedisEventBus(url ?? "", `flowaid-test-${randomUUID().slice(0, 8)}:`);
    return Promise.resolve({ bus, close: () => bus.close() });
  });
});
