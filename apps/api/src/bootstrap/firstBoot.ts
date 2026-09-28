/**
 * First boot (ARCHITECTURE.md §8): when no user exists, create the owner — from
 * FLOWAID_ADMIN_EMAIL/PASSWORD, else `owner@flowaid.local` with a generated password printed once
 * (status `invited`, so the first sign-in must change it) — the `default` workspace with its dev,
 * staging and prod environments, and the built-in templates. Runs exactly once.
 */
import { randomBytes } from "node:crypto";
import {
  createUser,
  createWorkspace,
  getWorkspaceBySlug,
  seedTemplates,
  setMembership,
  users,
  type Database,
  type BuiltInTemplate,
} from "@flowaid/database";
import { coreTemplates } from "@flowaid/nodes-core/manifest";
import { sql } from "drizzle-orm";
import { hashPassword } from "../auth/passwords.js";

export interface FirstBootResult {
  created: boolean;
  ownerEmail?: string;
  /** only when generated; print it once */
  generatedPassword?: string;
  workspaceId?: string;
}

export function builtInTemplates(): BuiltInTemplate[] {
  return coreTemplates.map((t) => ({
    slug: t.id,
    category: t.category,
    definition: t.definition as never,
    requiredResources: {
      mcpServers: t.requiredResources
        .filter((r) => r.kind === "mcp")
        .map((r) => ({
          key: r.key,
          description: r.description,
          requiredTools: r.tools.map((x) => x.name),
        })),
      knowledgeSources: t.requiredResources
        .filter((r) => r.kind === "knowledge")
        .map((r) => ({ key: r.key, description: r.description })),
    },
  }));
}

export async function firstBoot(
  db: Database,
  o: { adminEmail?: string; adminPassword?: string },
): Promise<FirstBootResult> {
  return db.system(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4711)`);
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
    // Built-in templates are refreshed on every boot, so an upgraded install gets new ones
    // (seedTemplates upserts by slug and never touches workspace templates).
    if (n > 0) {
      await seedTemplates(tx, builtInTemplates());
      return { created: false };
    }
    const generated = o.adminPassword ? undefined : randomBytes(18).toString("base64url");
    const email = o.adminEmail ?? "owner@flowaid.local";
    const owner = await createUser(tx, {
      email,
      name: "Owner",
      passwordHash: await hashPassword(o.adminPassword ?? (generated as string)),
      status: o.adminPassword ? "active" : "invited",
    });
    // An instance whose users were all removed keeps its default workspace: adopt it.
    const existing = await getWorkspaceBySlug(tx, "default");
    const workspace =
      existing ??
      (await createWorkspace(tx, { slug: "default", name: "Default", ownerUserId: owner.id }))
        .workspace;
    if (existing) await setMembership(tx, existing.id, owner.id, "owner");
    await seedTemplates(tx, builtInTemplates());
    return {
      created: true,
      ownerEmail: email,
      ...(generated ? { generatedPassword: generated } : {}),
      workspaceId: workspace.id,
    };
  });
}
