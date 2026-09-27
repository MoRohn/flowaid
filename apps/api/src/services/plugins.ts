/**
 * Enabled plugin packages as the API sees them (ARCHITECTURE.md §3.5): the manifests the worker
 * recorded in `plugins` (bundled packages at boot, installed ones later). The API never loads
 * plugin code; it only serves and compiles against these manifests.
 */
import { and, eq, isNull, or } from "drizzle-orm";
import { plugins, type Database, type Tx } from "@flowaid/database";
import type { NodeManifest } from "@flowaid/workflow-core";

export interface EnabledPlugins {
  manifests: NodeManifest[];
  packages: { name: string; version: string }[];
}

/** Global and workspace-scoped plugins whose row is enabled. */
export async function enabledPlugins(tx: Tx, workspaceId: string | null): Promise<EnabledPlugins> {
  const rows = await tx
    .select({ name: plugins.packageName, version: plugins.version, manifests: plugins.manifests })
    .from(plugins)
    .where(
      and(
        eq(plugins.status, "enabled"),
        workspaceId
          ? or(isNull(plugins.workspaceId), eq(plugins.workspaceId, workspaceId))
          : isNull(plugins.workspaceId),
      ),
    )
    .orderBy(plugins.packageName);
  return {
    manifests: rows.flatMap((r) => r.manifests),
    packages: rows.map((r) => ({ name: r.name, version: r.version })),
  };
}

export function loadEnabledPlugins(
  db: Database,
  workspaceId: string | null,
): Promise<EnabledPlugins> {
  return db.system((tx) => enabledPlugins(tx, workspaceId));
}
