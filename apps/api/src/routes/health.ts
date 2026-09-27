/** Liveness and readiness (API.md §3.9). */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { ApiContext } from "../context.js";
import { API_VERSION } from "../plugins/openapi.js";

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
        summary: "Readiness: the database answers",
        response: {
          200: z.object({ status: z.literal("ready"), checks: z.record(z.string(), z.string()) }),
          503: z.object({
            status: z.literal("unavailable"),
            checks: z.record(z.string(), z.string()),
          }),
        },
      },
    },
    async (_req, reply) => {
      const checks: Record<string, string> = {};
      try {
        await ctx.db.sql`select 1`;
        checks.database = "ok";
      } catch (error) {
        checks.database = error instanceof Error ? error.message.slice(0, 200) : "error";
        return reply.code(503).send({ status: "unavailable" as const, checks });
      }
      return { status: "ready" as const, checks };
    },
  );
}
