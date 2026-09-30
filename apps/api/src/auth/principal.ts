/** The authenticated caller of a request (API.md §1). */
import type { WorkspaceRole } from "@flowaid/database";
import { ForbiddenError, UnauthorizedError } from "@flowaid/workflow-core";
import type { Scope } from "./scopes.js";

export type PrincipalType =
  "user" | "api_key" | "review_token" | "mcp_token" | "webhook" | "system";

export interface Principal {
  type: PrincipalType;
  id: string;
  /** the user behind a session (and the creator of an api key, when still a member) */
  userId: string | null;
  workspaceId: string;
  workspaceSlug: string;
  role: WorkspaceRole | null;
  scopes: ReadonlySet<Scope>;
  environmentId: string | null;
  workflowIds: ReadonlySet<string> | null;
  /** session id (refresh family) for sessions */
  sid?: string;
  /** session expiry (epoch s) */
  exp?: number;
  rateLimitPerMin?: number | null;
}

/** A session that authenticated but has no workspace yet (e.g. a new user before creating one). */
export interface SessionOnly {
  type: "session_only";
  userId: string;
  sid: string;
  exp: number;
}

export type AuthMode = "public" | "session" | "api_key" | "session_or_api_key";

/**
 * The signed-in user of a session route, with or without a workspace. Throws 401 rather than
 * letting a missing session reach a query as an empty user id.
 */
export function sessionUserId(req: {
  principal?: Principal | null;
  sessionOnly?: SessionOnly | null;
}): string {
  const userId = req.principal?.userId ?? req.sessionOnly?.userId;
  if (!userId) throw new UnauthorizedError("no session");
  return userId;
}

export function hasScope(p: Principal, scope: Scope): boolean {
  return p.scopes.has(scope) || p.scopes.has("admin");
}

export function canSeeWorkflow(p: Principal, workflowId: string): boolean {
  return p.workflowIds === null || p.workflowIds.has(workflowId);
}

/** Whether `p` may see or act in `environmentId` (`null`: every environment, e.g. a shared credential). */
export function canUseEnvironment(p: Principal, environmentId: string | null): boolean {
  return p.environmentId === null || environmentId === p.environmentId;
}

/**
 * An API key pinned to an environment acts only in that environment: deploying, rolling back,
 * binding secrets, creating credentials or reading them anywhere else is refused. `null` is every
 * environment at once (a workspace-wide credential), which a pinned key may not create either.
 */
export function assertEnvironmentAllowed(p: Principal, environmentId: string | null): void {
  if (!canUseEnvironment(p, environmentId))
    throw new ForbiddenError("this API key is pinned to another environment");
}
