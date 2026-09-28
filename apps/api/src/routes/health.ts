/** Liveness and readiness (API.md §3.9). */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { ApiContext } from "../context.js";
import { API_VERSION } from "../plugins/openapi.js";

/** How long one readiness check may take before it counts as unavailable. */
const READY_TIMEOUT_MS = 3000;

export function healthRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    "/v1/health",
    {
      config: { auth: "public", rateLimit: false, cli: { noun: "system", verb: "health" } },
      schema: {
        tags: ["system"],
        summary: "Liveness",
        response: { 200: z.object({ status: z.literal("ok"), version: z.string() }) },
      },
    },
    () => ({ status: "ok" as const, version: API_VERSION }),
  );
  r.get(
    "/v1/ready",
    {
      config: { auth: "public", rateLimit: false, cli: { noun: "system", verb: "ready" } },
      schema: {
        tags: ["system"],
        summary: "Readiness: the database (and Redis, when configured) answers",
        response: {
          200: z.object({ status: z.literal("ready"), checks: z.record(z.string(), z.string()) }),
          503: z.object({
            status: z.literal("unavailable"),
            checks: z.record(z.string(), z.string()),
          }),
        },
      },
    },
    async (req, reply) => {
      // public: each check reports a fixed word; the reason goes to the log only
      const checks: Record<string, string> = {};
      const probe = async (name: string, fn: () => Promise<unknown>) => {
        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            fn(),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error("timed out")), READY_TIMEOUT_MS);
            }),
          ]);
          checks[name] = "ok";
        } catch (error) {
          req.log.warn({ err: error, check: name }, "readiness check failed");
          checks[name] = "unavailable";
        } finally {
          clearTimeout(timer);
        }
      };
      await probe("database", () => ctx.db.sql`select 1`);
      if (ctx.pingRedis) await probe("redis", ctx.pingRedis);
      if (Object.values(checks).some((c) => c !== "ok"))
        return reply.code(503).send({ status: "unavailable" as const, checks });
      return { status: "ready" as const, checks };
    },
  );
}
