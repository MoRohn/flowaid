import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL } from "@flowaid/database/testing";
import { testRedisUrl } from "@flowaid/env/testing";
import type { ApiContext } from "./context.js";
import { buildServer } from "./server.js";
import { RedisLimitStore } from "./services/limits.js";
import { createTestApp, OWNER, type TestApp } from "./test/app.js";

const redisUrl = testRedisUrl();

// Two api servers over one database and one Redis stand for two api replicas (P3-3).
describe.runIf(Boolean(TEST_DATABASE_URL && redisUrl))(
  "rate limits shared through Redis (Postgres + Redis)",
  () => {
    let t: TestApp;
    const opened: { app: FastifyInstance; store: RedisLimitStore }[] = [];

    /** A replica over `t`'s database with its own Redis connection; `prefix` isolates the test. */
    async function replica(prefix: string, over: Partial<ApiContext> = {}) {
      const store = RedisLimitStore.connect(redisUrl as string, prefix);
      const app = await buildServer({ ...t.ctx, ...over, limits: store });
      await app.ready();
      opened.push({ app, store });
      return app;
    }
    const login = (app: FastifyInstance, email: string, password = "wrong-password-1") =>
      app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password } });

    beforeAll(async () => {
      t = await createTestApp();
    });
    afterAll(async () => {
      const [first] = opened;
      if (first?.store.shared) {
        const keys = await first.store.shared.redis.keys("flowaid:test-limits:*");
        if (keys.length) await first.store.shared.redis.del(...keys);
      }
      for (const { app, store } of opened) {
        await app.close();
        await store.close();
      }
      await t?.close();
    });

    it("counts sign-in failures for one email across replicas", async () => {
      const prefix = `flowaid:test-limits:${randomBytes(6).toString("hex")}:`;
      const a = await replica(prefix);
      const b = await replica(prefix);
      // ten failures, alternating replicas: each answers 401
      for (let i = 0; i < 10; i++)
        expect((await login(i % 2 ? a : b, OWNER.email)).statusCode).toBe(401);
      // the eleventh is refused on either replica, even with the right password
      expect((await login(a, OWNER.email, OWNER.password)).statusCode).toBe(429);
      expect((await login(b, OWNER.email, OWNER.password)).statusCode).toBe(429);
    });

    it("applies the per-client request limit across replicas", async () => {
      const prefix = `flowaid:test-limits:${randomBytes(6).toString("hex")}:`;
      const config = { ...t.ctx.config, rateLimit: { ...t.ctx.config.rateLimit, public: 3 } };
      const a = await replica(prefix, { config });
      const b = await replica(prefix, { config });
      const codes = [];
      for (let i = 0; i < 4; i++)
        codes.push((await login(i % 2 ? a : b, `n${i}@example.com`)).statusCode);
      expect(codes).toEqual([401, 401, 401, 429]);
    });
  },
);
