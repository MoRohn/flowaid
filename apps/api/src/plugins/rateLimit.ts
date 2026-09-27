/** Per-principal rate limits (API.md §1): session 600/min, API key 1 200/min (or its own), public by IP. */
import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { ApiContext } from "../context.js";

export async function registerRateLimit(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    hook: "preHandler",
    timeWindow: 60_000,
    max: (req) => {
      const p = req.principal;
      if (!p) return ctx.config.rateLimit.public;
      if (p.type === "user") return ctx.config.rateLimit.session;
      return p.rateLimitPerMin ?? ctx.config.rateLimit.apiKey;
    },
    keyGenerator: (req) => {
      const p = req.principal;
      if (!p) return req.sessionOnly ? `sid:${req.sessionOnly.sid}` : `ip:${req.ip}`;
      return p.type === "user" ? `sid:${p.sid ?? p.id}` : `key:${p.id}`;
    },
    errorResponseBuilder: (_req, c) => {
      const e = new Error(`rate limit exceeded: ${c.max} requests per minute`) as Error & {
        statusCode: number;
      };
      e.statusCode = 429;
      return e;
    },
  });
}
