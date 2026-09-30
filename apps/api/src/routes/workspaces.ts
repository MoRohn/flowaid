/** Workspaces, members and environments (API.md §3.1). */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  createUser,
  createWorkspace,
  environments,
  findUserByEmail,
  getWorkspaceBySlug,
  listUserWorkspaces,
  memberships,
  setMembership,
  updateWorkspaceSettings,
  users,
  workspaces,
  bumpTokenVersion,
  type EnvironmentRow,
  type WorkspaceRow,
} from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import { ConflictError, ForbiddenError, NotFoundError } from "@flowaid/workflow-core";
import { and, asc, eq } from "drizzle-orm";
import { sessionUserId } from "../auth/principal.js";
import { roleAtLeast } from "../auth/scopes.js";
import type { ApiContext } from "../context.js";
import { IdParams, NoContent, PageQuery, afterCursor, page, toPage } from "../dto/common.js";
import {
  CreateWorkspaceRequestSchema,
  EnvironmentPatchSchema,
  EnvironmentRequestSchema,
  EnvironmentSchema,
  MemberRequestSchema,
  MemberSchema,
  PatchWorkspaceRequestSchema,
  WorkspaceSchema,
  WorkspaceSummarySchema,
} from "../dto/identity.js";

const wsDto = (w: WorkspaceRow) => ({
  id: w.id,
  slug: w.slug,
  name: w.name,
  settings: w.settings as Record<string, unknown>,
  createdAt: w.createdAt.toISOString(),
});
const envDto = (e: EnvironmentRow) => ({
  id: e.id,
  name: e.name,
  protected: e.protected,
  variables: e.variables as Record<string, unknown>,
  createdAt: e.createdAt.toISOString(),
});

function sameWorkspace(principalWs: string, id: string) {
  if (principalWs !== id) throw new NotFoundError("workspace not found");
}

export function workspaceRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/v1/workspaces",
    {
      config: { auth: "session", allowNoWorkspace: true, cli: { noun: "workspace", verb: "list" } },
      schema: {
        tags: ["workspaces"],
        summary: "Workspaces I belong to",
        response: { 200: z.array(WorkspaceSummarySchema) },
      },
    },
    async (req) => {
      const userId = sessionUserId(req);
      const rows = await ctx.db.system((tx) => listUserWorkspaces(tx, userId));
      return rows.map((w) => ({
        id: w.workspace.id,
        slug: w.workspace.slug,
        name: w.workspace.name,
        role: w.role,
      }));
    },
  );

  r.post(
    "/v1/workspaces",
    {
      config: {
        auth: "session",
        allowNoWorkspace: true,
        audit: { action: "workspace.create", resource: "workspace" },
        cli: { noun: "workspace", verb: "create" },
      },
      schema: {
        tags: ["workspaces"],
        summary: "Create a workspace (with dev, staging and prod)",
        body: CreateWorkspaceRequestSchema,
        response: { 201: WorkspaceSchema },
      },
    },
    async (req, reply) => {
      const userId = sessionUserId(req);
      const created = await ctx.db.system(async (tx) => {
        if (await getWorkspaceBySlug(tx, req.body.slug))
          throw new ConflictError(`the slug '${req.body.slug}' is taken`);
        return createWorkspace(tx, {
          slug: req.body.slug,
          name: req.body.name,
          ownerUserId: userId,
        });
      });
      ctx.auth.invalidateUser(userId);
      req.audit = {
        resourceId: created.workspace.id,
        workspaceId: created.workspace.id,
        actor: { type: "user", id: userId },
      };
      return reply.code(201).send(wsDto(created.workspace));
    },
  );

  r.get(
    "/v1/workspaces/:id",
    {
      config: {
        auth: "session_or_api_key",
        cli: { noun: "workspace", verb: "get", positional: ["id"] },
      },
      schema: { tags: ["workspaces"], params: IdParams, response: { 200: WorkspaceSchema } },
    },
    async (req) => {
      sameWorkspace(req.principal?.workspaceId ?? "", req.params.id);
      const w = await ctx.db.tenant(req.params.id, (tx) =>
        tx.query.workspaces.findFirst({ where: (t, { eq: e }) => e(t.id, req.params.id) }),
      );
      if (!w) throw new NotFoundError("workspace not found");
      return wsDto(w);
    },
  );

  r.patch(
    "/v1/workspaces/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "admin",
        audit: { action: "workspace.update", resource: "workspace" },
        cli: { noun: "workspace", verb: "update", positional: ["id"] },
      },
      schema: {
        tags: ["workspaces"],
        params: IdParams,
        body: PatchWorkspaceRequestSchema,
        response: { 200: WorkspaceSchema },
      },
    },
    async (req) => {
      sameWorkspace(req.principal?.workspaceId ?? "", req.params.id);
      const w = await ctx.db.tenant(req.params.id, async (tx) => {
        if (req.body.name)
          await tx
            .update(workspaces)
            .set({ name: req.body.name, updatedAt: new Date() })
            .where(eq(workspaces.id, req.params.id));
        if (req.body.settings)
          return updateWorkspaceSettings(tx, req.params.id, req.body.settings as never);
        return tx.query.workspaces.findFirst({ where: (t, { eq: e }) => e(t.id, req.params.id) });
      });
      if (!w) throw new NotFoundError("workspace not found");
      req.audit.details = { fields: Object.keys(req.body) };
      return wsDto(w);
    },
  );

  r.delete(
    "/v1/workspaces/:id",
    {
      config: {
        auth: "session",
        audit: { action: "workspace.delete", resource: "workspace" },
        cli: { noun: "workspace", verb: "delete", positional: ["id"] },
      },
      schema: { tags: ["workspaces"], params: IdParams, response: { 204: NoContent } },
    },
    async (req, reply) => {
      sameWorkspace(req.principal?.workspaceId ?? "", req.params.id);
      if (req.principal?.role !== "owner")
        throw new ForbiddenError("only the owner can delete a workspace");
      await ctx.db.system((tx) => tx.delete(workspaces).where(eq(workspaces.id, req.params.id)));
      req.audit.workspaceId = null;
      return reply.code(204).send(null);
    },
  );

  // Members
  const memberParams = z.object({ id: z.uuid(), userId: z.uuid() });
  r.get(
    "/v1/workspaces/:id/members",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        cli: { noun: "member", verb: "list", positional: ["id"] },
      },
      schema: {
        tags: ["workspaces"],
        params: IdParams,
        querystring: PageQuery,
        response: { 200: page(MemberSchema) },
      },
    },
    async (req) => {
      sameWorkspace(req.principal?.workspaceId ?? "", req.params.id);
      const { limit, cursor } = req.query;
      const rows = await ctx.db.system((tx) =>
        tx
          .select({ m: memberships, u: users })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(
            and(
              eq(memberships.workspaceId, req.params.id),
              afterCursor(users.email, users.id, cursor),
            ),
          )
          .orderBy(asc(users.email), asc(users.id))
          .limit(limit + 1),
      );
      return toPage(
        rows,
        limit,
        ({ u }) => [u.email, u.id],
        ({ m, u }) => ({
          userId: u.id,
          email: u.email,
          name: u.name,
          role: m.role,
          status: u.status,
          joinedAt: m.createdAt.toISOString(),
        }),
      );
    },
  );

  r.post(
    "/v1/workspaces/:id/members",
    {
      config: {
        auth: "session_or_api_key",
        scope: "members:manage",
        audit: { action: "member.add", resource: "membership" },
        cli: { noun: "member", verb: "add", positional: ["id"] },
      },
      schema: {
        tags: ["workspaces"],
        params: IdParams,
        body: MemberRequestSchema,
        response: { 201: MemberSchema },
      },
    },
    async (req, reply) => {
      sameWorkspace(req.principal?.workspaceId ?? "", req.params.id);
      const out = await ctx.db.system(async (tx) => {
        let user = await findUserByEmail(tx, req.body.email);
        user ??= await createUser(tx, {
          email: req.body.email,
          name: req.body.email.split("@")[0] ?? req.body.email,
          status: "invited",
        });
        const [existing] = await tx
          .select()
          .from(memberships)
          .where(and(eq(memberships.workspaceId, req.params.id), eq(memberships.userId, user.id)));
        if (existing) throw new ConflictError(`${req.body.email} is already a member`);
        await setMembership(tx, req.params.id, user.id, req.body.role);
        return user;
      });
      req.audit = { resourceId: out.id, details: { role: req.body.role } };
      return reply.code(201).send({
        userId: out.id,
        email: out.email,
        name: out.name,
        role: req.body.role,
        status: out.status,
        joinedAt: new Date(ctx.clock.now()).toISOString(),
      });
    },
  );

  r.patch(
    "/v1/workspaces/:id/members/:userId",
    {
      config: {
        auth: "session_or_api_key",
        scope: "members:manage",
        audit: { action: "member.role_changed", resource: "membership", idParam: "userId" },
        cli: { noun: "member", verb: "update", positional: ["id", "userId"] },
      },
      schema: {
        tags: ["workspaces"],
        params: memberParams,
        body: z.object({ role: MemberRequestSchema.shape.role }),
        response: { 204: NoContent },
      },
    },
    async (req, reply) => {
      sameWorkspace(req.principal?.workspaceId ?? "", req.params.id);
      await ctx.db.system(async (tx) => {
        const [m] = await tx
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.workspaceId, req.params.id),
              eq(memberships.userId, req.params.userId),
            ),
          );
        if (!m) throw new NotFoundError("member not found");
        if (m.role === "owner") throw new ForbiddenError("the owner's role cannot be changed");
        if (req.principal && !roleAtLeast(req.principal.role, "admin"))
          throw new ForbiddenError("only admins change roles");
        await setMembership(tx, req.params.id, req.params.userId, req.body.role);
        await bumpTokenVersion(tx, req.params.userId);
      });
      ctx.auth.invalidateUser(req.params.userId);
      req.audit.details = { role: req.body.role };
      return reply.code(204).send(null);
    },
  );

  r.delete(
    "/v1/workspaces/:id/members/:userId",
    {
      config: {
        auth: "session_or_api_key",
        scope: "members:manage",
        audit: { action: "member.remove", resource: "membership", idParam: "userId" },
        cli: { noun: "member", verb: "remove", positional: ["id", "userId"] },
      },
      schema: { tags: ["workspaces"], params: memberParams, response: { 204: NoContent } },
    },
    async (req, reply) => {
      sameWorkspace(req.principal?.workspaceId ?? "", req.params.id);
      await ctx.db.system(async (tx) => {
        const [m] = await tx
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.workspaceId, req.params.id),
              eq(memberships.userId, req.params.userId),
            ),
          );
        if (!m) throw new NotFoundError("member not found");
        if (m.role === "owner") throw new ForbiddenError("the owner cannot be removed");
        await tx
          .delete(memberships)
          .where(
            and(
              eq(memberships.workspaceId, req.params.id),
              eq(memberships.userId, req.params.userId),
            ),
          );
        await bumpTokenVersion(tx, req.params.userId);
      });
      ctx.auth.invalidateUser(req.params.userId);
      return reply.code(204).send(null);
    },
  );

  // Environments
  r.get(
    "/v1/environments",
    {
      config: {
        auth: "session_or_api_key",
        scope: "workflows:read",
        cli: { noun: "environment", verb: "list" },
      },
      schema: { tags: ["environments"], response: { 200: z.array(EnvironmentSchema) } },
    },
    async (req) => {
      const ws = req.principal?.workspaceId ?? "";
      const rows = await ctx.db.tenant(ws, (tx) =>
        tx
          .select()
          .from(environments)
          .where(eq(environments.workspaceId, ws))
          .orderBy(asc(environments.createdAt)),
      );
      return rows.map(envDto);
    },
  );

  r.post(
    "/v1/environments",
    {
      config: {
        auth: "session_or_api_key",
        scope: "admin",
        audit: { action: "environment.create", resource: "environment" },
        cli: { noun: "environment", verb: "create" },
      },
      schema: {
        tags: ["environments"],
        body: EnvironmentRequestSchema,
        response: { 201: EnvironmentSchema },
      },
    },
    async (req, reply) => {
      const ws = req.principal?.workspaceId ?? "";
      const row = await ctx.db.tenant(ws, async (tx) => {
        const [dup] = await tx
          .select()
          .from(environments)
          .where(and(eq(environments.workspaceId, ws), eq(environments.name, req.body.name)));
        if (dup) throw new ConflictError(`environment '${req.body.name}' exists`);
        const [created] = await tx
          .insert(environments)
          .values({
            id: uuidv7(),
            workspaceId: ws,
            name: req.body.name,
            protected: req.body.protected,
            variables: req.body.variables as never,
          })
          .returning();
        return created as EnvironmentRow;
      });
      req.audit.resourceId = row.id;
      return reply.code(201).send(envDto(row));
    },
  );

  r.patch(
    "/v1/environments/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "admin",
        audit: { action: "environment.update", resource: "environment" },
        cli: { noun: "environment", verb: "update", positional: ["id"] },
      },
      schema: {
        tags: ["environments"],
        params: IdParams,
        body: EnvironmentPatchSchema,
        response: { 200: EnvironmentSchema },
      },
    },
    async (req) => {
      const ws = req.principal?.workspaceId ?? "";
      const row = await ctx.db.tenant(ws, async (tx) => {
        const [u] = await tx
          .update(environments)
          .set({
            ...(req.body.name ? { name: req.body.name } : {}),
            ...(req.body.protected !== undefined ? { protected: req.body.protected } : {}),
            ...(req.body.variables ? { variables: req.body.variables as never } : {}),
          })
          .where(and(eq(environments.id, req.params.id), eq(environments.workspaceId, ws)))
          .returning();
        return u;
      });
      if (!row) throw new NotFoundError("environment not found");
      req.audit.details = { fields: Object.keys(req.body) };
      return envDto(row);
    },
  );

  r.delete(
    "/v1/environments/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "admin",
        audit: { action: "environment.delete", resource: "environment" },
        cli: { noun: "environment", verb: "delete", positional: ["id"] },
      },
      schema: { tags: ["environments"], params: IdParams, response: { 204: NoContent } },
    },
    async (req, reply) => {
      const ws = req.principal?.workspaceId ?? "";
      const rows = await ctx.db.tenant(ws, (tx) =>
        tx
          .delete(environments)
          .where(and(eq(environments.id, req.params.id), eq(environments.workspaceId, ws)))
          .returning({ id: environments.id }),
      );
      if (rows.length === 0) throw new NotFoundError("environment not found");
      return reply.code(204).send(null);
    },
  );
}
