/** Sessions (API.md §1, §3.1): login, refresh rotation with reuse detection, logout, password change, me. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import "../types.js";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  findUserByEmail,
  getUser,
  issueRefreshToken,
  listUserWorkspaces,
  recordAudit,
  recordLogin,
  revokeAllSessions,
  revokeFamily,
  rotateRefreshToken,
  refreshTokens,
  users,
  type UserRow,
} from "@flowaid/database";
import { BadRequestError, RateLimitError, UnauthorizedError } from "@flowaid/workflow-core";
import { and, desc, eq, isNull } from "drizzle-orm";
import { hashSecret, randomToken } from "../auth/apiKey.js";
import { ACCESS_TTL_S } from "../auth/jwt.js";
import { hashPassword, passwordProblem, verifyPassword } from "../auth/passwords.js";
import type { ApiContext } from "../context.js";
import { NoContent } from "../dto/common.js";
import { LoginRequestSchema, MeResponseSchema, SessionResponseSchema } from "../dto/identity.js";
import { REFRESH_COOKIE, sessionCookieName } from "../plugins/auth.js";
import { featuresFor } from "../services/features.js";
import { Throttle } from "../services/throttle.js";

const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;

export function userDto(u: UserRow) {
  return { id: u.id, email: u.email, name: u.name, status: u.status };
}

export async function sessionFor(ctx: ApiContext, user: UserRow, sid: string, reply: FastifyReply) {
  const now = ctx.clock.now();
  const access = await ctx.keys.sign({ sub: user.id, sid, tv: user.tokenVersion }, now);
  const secure = ctx.config.secureCookies;
  void reply.setCookie(sessionCookieName(secure), access, {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: ACCESS_TTL_S,
  });
  const workspaces = await ctx.db.system((tx) => listUserWorkspaces(tx, user.id));
  return {
    user: userDto(user),
    workspaces: workspaces.map((w) => ({
      id: w.workspace.id,
      slug: w.workspace.slug,
      name: w.workspace.name,
      role: w.role,
    })),
    expiresAt: now + ACCESS_TTL_S * 1000,
    mustChangePassword: user.status === "invited",
  };
}

function setRefreshCookie(ctx: ApiContext, reply: FastifyReply, token: string) {
  const secure = ctx.config.secureCookies;
  void reply.setCookie(REFRESH_COOKIE, token, {
    path: "/v1/auth/refresh",
    httpOnly: true,
    secure,
    sameSite: "strict",
    maxAge: REFRESH_TTL_MS / 1000,
  });
}

function clearCookies(ctx: ApiContext, reply: FastifyReply) {
  const secure = ctx.config.secureCookies;
  void reply.clearCookie(sessionCookieName(secure), {
    path: "/",
    secure,
    httpOnly: true,
    sameSite: "lax",
  });
  void reply.clearCookie(REFRESH_COOKIE, {
    path: "/v1/auth/refresh",
    secure,
    httpOnly: true,
    sameSite: "strict",
  });
}

const ua = (req: FastifyRequest) =>
  typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 500) : null;

export function authRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const byIp = new Throttle(20, 60_000, () => ctx.clock.now());
  const byEmail = new Throttle(10, 15 * 60_000, () => ctx.clock.now());

  r.post(
    "/v1/auth/login",
    {
      config: {
        auth: "public",
        audit: { action: "auth.login", resource: "user" },
        cli: { noun: "auth", verb: "login" },
      },
      schema: {
        tags: ["auth"],
        summary: "Sign in with email and password",
        body: LoginRequestSchema,
        response: { 200: SessionResponseSchema },
      },
    },
    async (req, reply) => {
      const email = req.body.email.trim().toLowerCase();
      const emailHash = hashSecret(email).slice(0, 16);
      if (!byIp.hit(req.ip) || !byEmail.hit(email))
        throw new RateLimitError("too many sign-in attempts; try again later", 60_000);
      const user = await ctx.db.system((tx) => findUserByEmail(tx, email));
      const ok = await verifyPassword(user?.passwordHash ?? null, req.body.password);
      if (!user || !ok || user.status === "disabled") {
        await ctx.db.system((tx) =>
          recordAudit(tx, {
            workspaceId: null,
            actorType: "user",
            actorId: user?.id ?? "anonymous",
            action: "auth.login_failed",
            resourceType: "user",
            resourceId: user?.id ?? "-",
            details: { emailHash },
            ip: req.ip,
            userAgent: ua(req),
            requestId: req.id,
          }),
        );
        throw new UnauthorizedError("wrong email or password");
      }
      byEmail.reset(email);
      // A presented refresh token belongs to an earlier login: revoke its family.
      const presented = req.cookies[REFRESH_COOKIE];
      const refresh = randomToken();
      const row = await ctx.db.system(async (tx) => {
        if (presented) {
          const [old] = await tx
            .select()
            .from(refreshTokens)
            .where(eq(refreshTokens.tokenHash, hashSecret(presented)));
          if (old) await revokeFamily(tx, old.familyId);
        }
        await recordLogin(tx, user.id);
        return issueRefreshToken(tx, {
          userId: user.id,
          tokenHash: hashSecret(refresh),
          expiresAt: new Date(ctx.clock.now() + REFRESH_TTL_MS),
          userAgent: ua(req),
          ip: req.ip,
        });
      });
      setRefreshCookie(ctx, reply, refresh);
      req.audit = { resourceId: user.id, workspaceId: null, actor: { type: "user", id: user.id } };
      return sessionFor(ctx, user, row.familyId, reply);
    },
  );

  r.post(
    "/v1/auth/refresh",
    {
      config: { auth: "public", audit: false, cli: { noun: "auth", verb: "refresh" } },
      schema: {
        tags: ["auth"],
        summary: "Rotate the refresh token and mint a new session",
        response: { 200: SessionResponseSchema },
      },
    },
    async (req, reply) => {
      if (req.headers["x-requested-with"] !== "flowaid")
        throw new UnauthorizedError("missing X-Requested-With: flowaid");
      const presented = req.cookies[REFRESH_COOKIE];
      if (!presented) throw new UnauthorizedError("no refresh token");
      const next = randomToken();
      const result = await ctx.db.system((tx) =>
        rotateRefreshToken(tx, hashSecret(presented), {
          tokenHash: hashSecret(next),
          expiresAt: new Date(ctx.clock.now() + REFRESH_TTL_MS),
          userAgent: ua(req),
          ip: req.ip,
        }),
      );
      if (result.status === "reused") {
        await ctx.db.system((tx) =>
          recordAudit(tx, {
            workspaceId: null,
            actorType: "user",
            actorId: result.userId,
            action: "auth.refresh_reuse_detected",
            resourceType: "session",
            resourceId: result.familyId,
            details: {},
            ip: req.ip,
            userAgent: ua(req),
            requestId: req.id,
          }),
        );
        clearCookies(ctx, reply);
        throw new UnauthorizedError(
          "the refresh token was already used; every session of that sign-in was revoked",
        );
      }
      if (result.status === "invalid") {
        clearCookies(ctx, reply);
        throw new UnauthorizedError("the refresh token is invalid or expired");
      }
      const user = await ctx.db.system((tx) => getUser(tx, result.userId));
      if (!user || user.status === "disabled")
        throw new UnauthorizedError("the account is disabled");
      setRefreshCookie(ctx, reply, next);
      return sessionFor(ctx, user, result.token.familyId, reply);
    },
  );

  r.post(
    "/v1/auth/logout",
    {
      config: {
        auth: "session",
        allowNoWorkspace: true,
        audit: { action: "auth.logout", resource: "session" },
        cli: { noun: "auth", verb: "logout" },
      },
      schema: { tags: ["auth"], summary: "Sign out this session", response: { 204: NoContent } },
    },
    async (req, reply) => {
      const sid = req.principal?.sid ?? req.sessionOnly?.sid;
      if (sid) await ctx.db.system((tx) => revokeFamily(tx, sid));
      clearCookies(ctx, reply);
      req.audit.resourceId = sid;
      return reply.code(204).send(null);
    },
  );

  r.post(
    "/v1/auth/logout-all",
    {
      config: {
        auth: "session",
        allowNoWorkspace: true,
        audit: { action: "auth.logout_all", resource: "user" },
        cli: { noun: "auth", verb: "logout-all" },
      },
      schema: {
        tags: ["auth"],
        summary: "Sign out every session of this user",
        response: { 204: NoContent },
      },
    },
    async (req, reply) => {
      const userId = req.principal?.userId ?? req.sessionOnly?.userId;
      if (!userId) throw new UnauthorizedError("no session");
      await ctx.db.system((tx) => revokeAllSessions(tx, userId));
      ctx.auth.invalidateUser(userId);
      clearCookies(ctx, reply);
      req.audit.resourceId = userId;
      return reply.code(204).send(null);
    },
  );

  r.post(
    "/v1/me/password",
    {
      config: {
        auth: "session",
        allowNoWorkspace: true,
        audit: { action: "auth.password_changed", resource: "user" },
        cli: { noun: "me", verb: "change-password" },
      },
      schema: {
        tags: ["auth"],
        summary: "Change the password (signs out every other session)",
        body: z.object({
          currentPassword: z.string().min(1).max(256),
          newPassword: z.string().min(1).max(256),
        }),
        response: { 200: SessionResponseSchema },
      },
    },
    async (req, reply) => {
      const userId = req.principal?.userId ?? req.sessionOnly?.userId;
      if (!userId) throw new UnauthorizedError("no session");
      const user = await ctx.db.system((tx) => getUser(tx, userId));
      if (!user || !(await verifyPassword(user.passwordHash, req.body.currentPassword)))
        throw new UnauthorizedError("the current password is wrong");
      const problem = passwordProblem(req.body.newPassword);
      if (problem) throw new BadRequestError(`the new password ${problem}`);
      if (req.body.newPassword === req.body.currentPassword)
        throw new BadRequestError("the new password must differ from the current one");
      const hash = await hashPassword(req.body.newPassword);
      const refresh = randomToken();
      const { updated, family } = await ctx.db.system(async (tx) => {
        await tx
          .update(users)
          .set({
            passwordHash: hash,
            status: "active",
            passwordChangedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));
        await revokeAllSessions(tx, userId);
        const row = await issueRefreshToken(tx, {
          userId,
          tokenHash: hashSecret(refresh),
          expiresAt: new Date(ctx.clock.now() + REFRESH_TTL_MS),
          userAgent: ua(req),
          ip: req.ip,
        });
        return { updated: (await getUser(tx, userId)) as UserRow, family: row.familyId };
      });
      ctx.auth.invalidateUser(userId);
      setRefreshCookie(ctx, reply, refresh);
      req.audit.resourceId = userId;
      return sessionFor(ctx, updated, family, reply);
    },
  );

  const SessionItem = z.object({
    id: z.uuid(),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    createdAt: z.string(),
    current: z.boolean(),
  });
  r.get(
    "/v1/me/sessions",
    {
      config: { auth: "session", allowNoWorkspace: true, cli: { noun: "me", verb: "sessions" } },
      schema: {
        tags: ["auth"],
        summary: "Signed-in sessions",
        response: { 200: z.array(SessionItem) },
      },
    },
    async (req) => {
      const userId = req.principal?.userId ?? req.sessionOnly?.userId ?? "";
      const sid = req.principal?.sid ?? req.sessionOnly?.sid;
      const rows = await ctx.db.system((tx) =>
        tx
          .select()
          .from(refreshTokens)
          .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
          .orderBy(desc(refreshTokens.createdAt)),
      );
      return rows.map((t) => ({
        id: t.familyId,
        ip: t.ip,
        userAgent: t.userAgent,
        createdAt: t.createdAt.toISOString(),
        current: t.familyId === sid,
      }));
    },
  );

  r.delete(
    "/v1/me/sessions/:id",
    {
      config: {
        auth: "session",
        allowNoWorkspace: true,
        audit: { action: "auth.session_revoked", resource: "session" },
        cli: { noun: "me", verb: "revoke-session", positional: ["id"] },
      },
      schema: {
        tags: ["auth"],
        summary: "Revoke one session",
        params: z.object({ id: z.uuid() }),
        response: { 204: NoContent },
      },
    },
    async (req, reply) => {
      const userId = req.principal?.userId ?? req.sessionOnly?.userId ?? "";
      await ctx.db.system(async (tx) => {
        const [t] = await tx
          .select()
          .from(refreshTokens)
          .where(and(eq(refreshTokens.familyId, req.params.id), eq(refreshTokens.userId, userId)));
        if (t) await revokeFamily(tx, t.familyId);
      });
      return reply.code(204).send(null);
    },
  );

  r.get(
    "/v1/me",
    {
      config: {
        auth: "session_or_api_key",
        allowNoWorkspace: true,
        cli: { noun: "me", verb: "get" },
      },
      schema: {
        tags: ["auth"],
        summary: "Who am I: principal, workspaces and enabled features",
        response: { 200: MeResponseSchema },
      },
    },
    async (req) => {
      const p = req.principal;
      const userId = p?.userId ?? req.sessionOnly?.userId ?? null;
      const user =
        userId && (p?.type === "user" || req.sessionOnly)
          ? await ctx.db.system((tx) => getUser(tx, userId))
          : null;
      const workspaces = user ? await ctx.db.system((tx) => listUserWorkspaces(tx, user.id)) : [];
      return {
        principal: {
          type: p?.type ?? "user",
          id: p?.id ?? userId ?? "",
          workspaceId: p?.workspaceId ?? null,
          workspaceSlug: p?.workspaceSlug ?? null,
          role: p?.role ?? null,
          scopes: p ? [...p.scopes].sort() : [],
          environmentId: p?.environmentId ?? null,
          workflowIds: p?.workflowIds ? [...p.workflowIds] : null,
        },
        user: user ? userDto(user) : null,
        workspaces: workspaces.map((w) => ({
          id: w.workspace.id,
          slug: w.workspace.slug,
          name: w.workspace.name,
          role: w.role,
        })),
        features: featuresFor(ctx.config),
      };
    },
  );

  r.get("/.well-known/jwks.json", { config: { auth: "public" }, schema: { hide: true } }, () =>
    ctx.keys.jwks(),
  );
}
