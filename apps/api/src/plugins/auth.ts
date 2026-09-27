/**
 * Authentication and authorisation per route: resolves the principal (Bearer API key or session
 * JWT, or the `__Host-fa_session` cookie), requires `X-Requested-With: flowaid` on state-changing
 * cookie requests (CSRF), and checks the route's scopes.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import "../types.js";
import { ForbiddenError, UnauthorizedError } from "@flowaid/workflow-core";
import type { ApiContext } from "../context.js";
import { hasScope } from "../auth/principal.js";
import type { Scope } from "../auth/scopes.js";

export const SESSION_COOKIE_SECURE = "__Host-fa_session";
export const SESSION_COOKIE_INSECURE = "fa_session";
export const REFRESH_COOKIE = "fa_refresh";

export function sessionCookieName(secure: boolean): string {
  return secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE_INSECURE;
}

function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1]?.trim();
}

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

export function registerAuth(app: FastifyInstance, ctx: ApiContext): void {
  app.decorateRequest("principal", null);
  app.decorateRequest("sessionOnly", null);
  app.decorateRequest("audit", null as unknown as FastifyRequest["audit"]);
  const cookieName = sessionCookieName(ctx.config.secureCookies);

  app.addHook("onRequest", async (req) => {
    req.audit = {};
    const config = req.routeOptions.config;
    const mode = config.auth;
    if (!mode) return;
    const token = bearer(req);
    const cookie = req.cookies[cookieName];
    if (mode === "public" && !token && !cookie) return;
    const slugHeader = req.headers["x-workspace"];
    const resolved = await ctx.auth
      .resolve({
        ...(token ? { bearer: token } : {}),
        ...(cookie ? { sessionCookie: cookie } : {}),
        ...(typeof slugHeader === "string" && slugHeader ? { workspaceSlug: slugHeader } : {}),
      })
      .catch((error: unknown) => {
        if (mode === "public") return null;
        throw error;
      });
    if (mode === "public") {
      if (resolved && resolved.type !== "session_only") req.principal = resolved;
      return;
    }
    if (!resolved) throw new UnauthorizedError("authentication required");
    if (resolved.type === "session_only") {
      if (!config.allowNoWorkspace) throw new ForbiddenError("create or join a workspace first");
      req.sessionOnly = resolved;
      return;
    }
    const viaSession = resolved.type === "user";
    if (mode === "api_key" && viaSession)
      throw new UnauthorizedError("this route needs an API key");
    if (mode === "session" && !viaSession)
      throw new UnauthorizedError("this route needs a signed-in session");
    // CSRF: cookie-authenticated mutations must come from our own origin (the header forces a preflight).
    if (
      viaSession &&
      !token &&
      !READS.has(req.method) &&
      req.headers["x-requested-with"] !== "flowaid"
    )
      throw new ForbiddenError("missing X-Requested-With: flowaid");
    req.principal = resolved;
    const scopes =
      config.scope === undefined
        ? []
        : typeof config.scope === "string"
          ? [config.scope]
          : config.scope;
    for (const s of scopes as Scope[])
      if (!hasScope(resolved, s)) throw new ForbiddenError(`missing scope ${s}`);
  });
}
