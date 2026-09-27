/** Scopes and the role → scope mapping (API.md §1). */
import type { WorkspaceRole } from "@flowaid/database";

export const SCOPES = [
  "workflows:read",
  "workflows:write",
  "workflows:publish",
  "workflows:delete",
  "runs:create",
  "runs:read",
  "runs:cancel",
  "runs:approve",
  "runs:replay",
  "runs:delete",
  "credentials:read",
  "credentials:write",
  "secrets:bind",
  "tools:read",
  "tools:write",
  "mcp:read",
  "mcp:write",
  "mcp:serve",
  "evaluations:read",
  "evaluations:write",
  "knowledge:read",
  "knowledge:write",
  "webhooks:write",
  "schedules:write",
  "members:manage",
  "api_keys:manage",
  "audit:read",
  "admin",
] as const;
export type Scope = (typeof SCOPES)[number];

const READ = SCOPES.filter((s) => s.endsWith(":read"));
const OPERATOR = [...READ, "runs:create", "runs:cancel", "runs:approve", "runs:replay"] as const;
const EDITOR = [
  ...OPERATOR,
  "workflows:write",
  "workflows:publish",
  "tools:read",
  "tools:write",
  "knowledge:read",
  "knowledge:write",
  "evaluations:read",
  "evaluations:write",
  "secrets:bind",
] as const;
const ADMIN = [
  ...EDITOR,
  "credentials:read",
  "credentials:write",
  "mcp:read",
  "mcp:write",
  "webhooks:write",
  "schedules:write",
  "members:manage",
  "api_keys:manage",
  "audit:read",
  "runs:delete",
  "workflows:delete",
  "admin",
] as const;

export const ROLE_SCOPES: Readonly<Record<WorkspaceRole, ReadonlySet<Scope>>> = {
  viewer: new Set(READ),
  operator: new Set(OPERATOR),
  editor: new Set(EDITOR),
  admin: new Set(ADMIN),
  owner: new Set(ADMIN),
};

export const ROLE_ORDER: readonly WorkspaceRole[] = [
  "viewer",
  "operator",
  "editor",
  "admin",
  "owner",
];

export function roleAtLeast(role: WorkspaceRole | null, min: WorkspaceRole): boolean {
  return role !== null && ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(min);
}

export function isScope(s: string): s is Scope {
  return (SCOPES as readonly string[]).includes(s);
}
