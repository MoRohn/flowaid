/**
 * Saved views (API.md §3.4): a person's named filters of a list, per workspace. Only `runs` has
 * views today. Views belong to the signed-in user; API keys and tokens have none.
 */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { savedViews } from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type JsonObject,
} from "@flowaid/workflow-core";
import type { Principal } from "../auth/principal.js";
import type { ApiContext } from "../context.js";
import { NoContent } from "../dto/common.js";

const ScopeSchema = z.enum(["runs"]);

export const SavedViewSchema = z.object({
  id: z.uuid(),
  scope: ScopeSchema,
  name: z.string(),
  filters: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const SaveViewSchema = z.object({
  scope: ScopeSchema,
  name: z.string().trim().min(1).max(80),
  filters: z.record(z.string(), z.unknown()),
});

function person(p: Principal | null | undefined): Principal & { userId: string } {
  if (!p?.userId || p.type !== "user") throw new ForbiddenError("saved views belong to a person");
  return p as Principal & { userId: string };
}

type Row = typeof savedViews.$inferSelect;
const dto = (v: Row) => ({
  id: v.id,
  scope: v.scope,
  name: v.name,
  filters: v.filters,
  createdAt: v.createdAt.toISOString(),
  updatedAt: v.updatedAt.toISOString(),
});

export function savedViewRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/v1/saved-views",
    {
      config: {
        auth: "session",
        scope: "runs:read",
        cli: { noun: "view", verb: "list" },
      },
      schema: {
        tags: ["runs"],
        querystring: z.object({ scope: ScopeSchema }),
        response: { 200: z.array(SavedViewSchema) },
      },
    },
    async (req) => {
      const p = person(req.principal);
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select()
          .from(savedViews)
          .where(
            and(
              eq(savedViews.workspaceId, p.workspaceId),
              eq(savedViews.userId, p.userId),
              eq(savedViews.scope, req.query.scope),
            ),
          )
          .orderBy(asc(savedViews.name)),
      );
      return rows.map(dto);
    },
  );

  r.post(
    "/v1/saved-views",
    {
      config: {
        auth: "session",
        scope: "runs:read",
        audit: { action: "saved_view.save", resource: "saved_view" },
        cli: { noun: "view", verb: "save" },
      },
      schema: {
        tags: ["runs"],
        summary: "Save a view; a view with the same name is replaced",
        body: SaveViewSchema,
        response: { 200: SavedViewSchema },
      },
    },
    async (req) => {
      const p = person(req.principal);
      const now = new Date(ctx.clock.now());
      const [row] = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .insert(savedViews)
          .values({
            id: uuidv7(),
            workspaceId: p.workspaceId,
            userId: p.userId,
            scope: req.body.scope,
            name: req.body.name,
            filters: req.body.filters as JsonObject,
          })
          .onConflictDoUpdate({
            target: [savedViews.workspaceId, savedViews.userId, savedViews.scope, savedViews.name],
            set: { filters: req.body.filters as JsonObject, updatedAt: now },
          })
          .returning(),
      );
      if (!row) throw new ConflictError("the view was not saved");
      req.audit = { resourceId: row.id, details: { scope: row.scope, name: row.name } };
      return dto(row);
    },
  );

  r.delete(
    "/v1/saved-views/:id",
    {
      config: {
        auth: "session",
        scope: "runs:read",
        audit: { action: "saved_view.delete", resource: "saved_view" },
        cli: { noun: "view", verb: "delete", positional: ["id"] },
      },
      schema: {
        tags: ["runs"],
        params: z.object({ id: z.uuid() }),
        response: { 204: NoContent },
      },
    },
    async (req, reply) => {
      const p = person(req.principal);
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .delete(savedViews)
          .where(
            and(
              eq(savedViews.id, req.params.id),
              eq(savedViews.workspaceId, p.workspaceId),
              eq(savedViews.userId, p.userId),
            ),
          )
          .returning({ id: savedViews.id }),
      );
      if (!rows.length) throw new NotFoundError("saved view not found");
      req.audit = { resourceId: req.params.id };
      return reply.code(204).send(null);
    },
  );
}
