/** Workspaces, memberships and environments. */
import { and, asc, eq } from "drizzle-orm";
import { uuidv7 } from "@flowaid/shared";
import type { Tx } from "../db.js";
import { environments, memberships, workspaces, type WorkspaceSettings } from "../schema.js";

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type EnvironmentRow = typeof environments.$inferSelect;
export type WorkspaceRole = (typeof memberships.$inferSelect)["role"];

/** The environments every workspace starts with (`prod` needs admin to deploy). */
export const DEFAULT_ENVIRONMENTS = [
  { name: "dev", protected: false },
  { name: "staging", protected: false },
  { name: "prod", protected: true },
] as const;

/** Creates the default environments of a workspace (idempotent). */
export async function seedEnvironments(tx: Tx, workspaceId: string): Promise<EnvironmentRow[]> {
  await tx
    .insert(environments)
    .values(
      DEFAULT_ENVIRONMENTS.map((e) => ({
        id: uuidv7(),
        workspaceId,
        name: e.name,
        protected: e.protected,
      })),
    )
    .onConflictDoNothing();
  return tx
    .select()
    .from(environments)
    .where(eq(environments.workspaceId, workspaceId))
    .orderBy(asc(environments.createdAt));
}

/** A workspace with its owner and default environments (run in the system scope or as the new tenant). */
export async function createWorkspace(
  tx: Tx,
  input: {
    id?: string;
    slug: string;
    name: string;
    ownerUserId: string;
    settings?: WorkspaceSettings;
  },
): Promise<{ workspace: WorkspaceRow; environments: EnvironmentRow[] }> {
  const id = input.id ?? uuidv7();
  const [workspace] = await tx
    .insert(workspaces)
    .values({ id, slug: input.slug, name: input.name, settings: input.settings ?? {} })
    .returning();
  await tx
    .insert(memberships)
    .values({ workspaceId: id, userId: input.ownerUserId, role: "owner" });
  return { workspace: workspace as WorkspaceRow, environments: await seedEnvironments(tx, id) };
}

export async function getWorkspaceBySlug(tx: Tx, slug: string): Promise<WorkspaceRow | null> {
  const [row] = await tx.select().from(workspaces).where(eq(workspaces.slug, slug));
  return row ?? null;
}

/** The workspaces a user belongs to, with the role (system scope: spans tenants). */
export async function listUserWorkspaces(
  tx: Tx,
  userId: string,
): Promise<Array<{ workspace: WorkspaceRow; role: WorkspaceRole }>> {
  const rows = await tx
    .select({ workspace: workspaces, role: memberships.role })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(workspaces.name));
  return rows;
}

export async function getMembership(
  tx: Tx,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const [row] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)));
  return row?.role ?? null;
}

export async function setMembership(
  tx: Tx,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<void> {
  await tx
    .insert(memberships)
    .values({ workspaceId, userId, role })
    .onConflictDoUpdate({ target: [memberships.workspaceId, memberships.userId], set: { role } });
}

export async function updateWorkspaceSettings(
  tx: Tx,
  workspaceId: string,
  settings: WorkspaceSettings,
): Promise<WorkspaceRow | null> {
  const [row] = await tx
    .update(workspaces)
    .set({ settings, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId))
    .returning();
  return row ?? null;
}
