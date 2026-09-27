/**
 * Principal resolution (API.md §1). API keys: checksum check offline, SHA-256 lookup, scopes
 * intersected with the creator's current role (service accounts keep theirs). Sessions: ES256 JWT
 * (`sub`, `sid`, `tv`), token version and user status checked against a 60 s cache, workspace from
 * `X-Workspace` (else the most recently used), role read from `memberships` (cached 60 s per sid).
 */
import {
  findActiveApiKey,
  getMembership,
  getUser,
  getWorkspaceBySlug,
  listUserWorkspaces,
  touchApiKey,
  type Database,
  type WorkspaceRole,
} from "@flowaid/database";
import { ForbiddenError, UnauthorizedError } from "@flowaid/workflow-core";
import { hashSecret, looksLikeApiKey, parseApiKey } from "./apiKey.js";
import type { JwtKeys } from "./jwt.js";
import type { Principal, SessionOnly } from "./principal.js";
import { ROLE_SCOPES, isScope, type Scope } from "./scopes.js";

const TTL_MS = 60_000;

class TtlCache<V> {
  private readonly map = new Map<string, { value: V; at: number }>();
  constructor(private readonly now: () => number) {}
  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit || this.now() - hit.at > TTL_MS) return undefined;
    return hit.value;
  }
  set(key: string, value: V): void {
    if (this.map.size > 10_000) this.map.clear();
    this.map.set(key, { value, at: this.now() });
  }
  deleteWhere(pred: (key: string) => boolean): void {
    for (const k of [...this.map.keys()]) if (pred(k)) this.map.delete(k);
  }
}

export interface Credentials {
  bearer?: string;
  sessionCookie?: string;
  workspaceSlug?: string;
}

export class AuthService {
  private readonly users: TtlCache<{ tokenVersion: number; status: string }>;
  private readonly roles: TtlCache<{
    workspaceId: string;
    slug: string;
    role: WorkspaceRole;
  } | null>;

  constructor(
    private readonly db: Database,
    private readonly keys: JwtKeys,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.users = new TtlCache(now);
    this.roles = new TtlCache(now);
  }

  /** Forget cached session state for a user (logout-all, role change, removal). */
  invalidateUser(userId: string): void {
    this.users.deleteWhere((k) => k === userId);
    this.roles.deleteWhere((k) => k.startsWith(`${userId}|`));
  }

  async resolve(c: Credentials): Promise<Principal | SessionOnly | null> {
    if (c.bearer && looksLikeApiKey(c.bearer)) return this.fromApiKey(c.bearer);
    const token = c.bearer ?? c.sessionCookie;
    if (!token) return null;
    return this.fromSession(token, c.workspaceSlug);
  }

  private async fromApiKey(key: string): Promise<Principal> {
    if (!parseApiKey(key)) throw new UnauthorizedError("malformed API key");
    const row = await this.db.system((tx) => findActiveApiKey(tx, hashSecret(key)));
    if (!row) throw new UnauthorizedError("unknown, revoked or expired API key");
    const stored = new Set(row.scopes.filter(isScope));
    let scopes: Set<Scope> = stored;
    let role: WorkspaceRole | null = null;
    if (!row.isServiceAccount) {
      role = row.createdBy
        ? await this.db.system((tx) => getMembership(tx, row.workspaceId, row.createdBy as string))
        : null;
      if (!role)
        throw new UnauthorizedError("the API key's creator is no longer a member of the workspace");
      const allowed = ROLE_SCOPES[role];
      scopes = new Set([...stored].filter((s) => allowed.has(s)));
    }
    const ws = await this.db.system(
      async (tx) =>
        (await tx.query.workspaces.findFirst({
          where: (w, { eq }) => eq(w.id, row.workspaceId),
        })) ?? null,
    );
    void this.db.system((tx) => touchApiKey(tx, row.id)).catch(() => undefined);
    return {
      type: stored.has("mcp:serve") && row.isServiceAccount ? "mcp_token" : "api_key",
      id: row.id,
      userId: row.isServiceAccount ? null : row.createdBy,
      workspaceId: row.workspaceId,
      workspaceSlug: ws?.slug ?? "",
      role,
      scopes,
      environmentId: row.environmentId,
      workflowIds: row.workflowIds ? new Set(row.workflowIds) : null,
      rateLimitPerMin: row.rateLimitPerMin,
    };
  }

  private async fromSession(
    token: string,
    slug: string | undefined,
  ): Promise<Principal | SessionOnly> {
    const claims = await this.keys.verify(token, this.now());
    let user = this.users.get(claims.sub);
    if (!user) {
      const row = await this.db.system((tx) => getUser(tx, claims.sub));
      if (!row) throw new UnauthorizedError("unknown user");
      user = { tokenVersion: row.tokenVersion, status: row.status };
      this.users.set(claims.sub, user);
    }
    if (user.status === "disabled") throw new UnauthorizedError("the account is disabled");
    if (user.tokenVersion !== claims.tv) throw new UnauthorizedError("the session was revoked");
    const cacheKey = `${claims.sub}|${claims.sid}|${slug ?? ""}`;
    let membership = this.roles.get(cacheKey);
    if (membership === undefined) {
      membership = await this.db.system(async (tx) => {
        if (slug) {
          const ws = await getWorkspaceBySlug(tx, slug);
          if (!ws) return null;
          const role = await getMembership(tx, ws.id, claims.sub);
          return role ? { workspaceId: ws.id, slug: ws.slug, role } : null;
        }
        const all = await listUserWorkspaces(tx, claims.sub);
        const first = all[0];
        return first
          ? { workspaceId: first.workspace.id, slug: first.workspace.slug, role: first.role }
          : null;
      });
      this.roles.set(cacheKey, membership);
    }
    if (!membership) {
      if (slug) throw new ForbiddenError(`not a member of workspace '${slug}'`);
      return { type: "session_only", userId: claims.sub, sid: claims.sid, exp: claims.exp };
    }
    return {
      type: "user",
      id: claims.sub,
      userId: claims.sub,
      workspaceId: membership.workspaceId,
      workspaceSlug: membership.slug,
      role: membership.role,
      scopes: ROLE_SCOPES[membership.role],
      environmentId: null,
      workflowIds: null,
      sid: claims.sid,
      exp: claims.exp,
    };
  }
}
