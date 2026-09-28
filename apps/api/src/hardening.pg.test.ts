import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { testRedisUrl } from "@flowaid/env/testing";
import { RedisEventBus } from "@flowaid/workflow-runtime";
import { createTestApp, type TestApp } from "./test/app.js";

describeDb("CORS and readiness (Postgres)", () => {
  let t: TestApp;
  beforeAll(async () => {
    // a hand-built config with a wildcard: the server still answers exact origins only
    t = await createTestApp({ corsOrigins: ["*", "http://localhost:3001"] });
  });
  afterAll(() => t.close());
  const preflight = (origin: string) =>
    t.app.inject({
      method: "OPTIONS",
      url: "/v1/me",
      headers: { origin, "access-control-request-method": "GET" },
    });

  it("never reflects an arbitrary origin with credentials", async () => {
    const evil = await preflight("https://evil.example");
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
    const web = await preflight("http://localhost:3001");
    expect(web.headers["access-control-allow-origin"]).toBe("http://localhost:3001");
    expect(web.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("reports readiness with fixed words, logging the reason instead of returning it", async () => {
    expect((await t.app.inject({ method: "GET", url: "/v1/ready" })).json()).toEqual({
      status: "ready",
      checks: { database: "ok" },
    });
    t.ctx.pingRedis = () => Promise.reject(new Error("connect ECONNREFUSED 10.1.2.3:6379"));
    const { db } = t.ctx;
    t.ctx.db = Object.assign(Object.create(db) as typeof db, {
      sql: () => Promise.reject(new Error('password authentication failed for user "flowaid"')),
    });
    try {
      const res = await t.app.inject({ method: "GET", url: "/v1/ready" });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({
        status: "unavailable",
        checks: { database: "unavailable", redis: "unavailable" },
      });
      expect(res.body).not.toMatch(/10\.1\.2\.3|password|flowaid/);
    } finally {
      t.ctx.db = db;
      delete t.ctx.pingRedis;
    }
  });

  const redisUrl = testRedisUrl();
  it.skipIf(!redisUrl)("pings Redis when it is configured", async () => {
    const bus = new RedisEventBus(redisUrl as string);
    t.ctx.pingRedis = () => bus.publish("ready.ping", null);
    try {
      expect((await t.app.inject({ method: "GET", url: "/v1/ready" })).json()).toEqual({
        status: "ready",
        checks: { database: "ok", redis: "ok" },
      });
    } finally {
      delete t.ctx.pingRedis;
      await bus.close();
    }
  });
});
