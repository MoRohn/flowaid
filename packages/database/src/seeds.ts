/**
 * Seeds: built-in templates (workspace_id NULL, readable by every workspace) and the default
 * environments of a workspace (`seedEnvironments`, in repositories/workspaces.ts). Both are
 * idempotent: templates are upserted by slug.
 */
import { sql } from "drizzle-orm";
import { uuidv7 } from "@flowaid/shared";
import type { SecretDecl, Trigger, WorkflowDefinition } from "@flowaid/workflow-core";
import type { Tx } from "./db.js";
import { templates } from "./schema.js";

export interface RequiredResources {
  mcpServers: { key: string; description: string; requiredTools: string[] }[];
  knowledgeSources: { key: string; description: string }[];
}

export interface BuiltInTemplate {
  slug: string;
  category: string;
  definition: WorkflowDefinition;
  requiredResources?: RequiredResources;
}

/** Upserts built-in templates; name, description, secrets and triggers come from the definition. */
export async function seedTemplates(tx: Tx, list: readonly BuiltInTemplate[]): Promise<number> {
  for (const t of list) {
    const def = t.definition as WorkflowDefinition & {
      name?: string;
      description?: string;
      secrets?: SecretDecl[];
      triggers?: Trigger[];
    };
    const values = {
      name: def.name ?? t.slug,
      description: def.description ?? "",
      category: t.category,
      definition: t.definition,
      requiredSecrets: def.secrets ?? [],
      requiredResources: t.requiredResources ?? { mcpServers: [], knowledgeSources: [] },
      triggers: def.triggers ?? [],
    };
    const updated = await tx
      .update(templates)
      .set(values)
      .where(sql`${templates.workspaceId} is null and ${templates.slug} = ${t.slug}`)
      .returning({ id: templates.id });
    if (updated.length === 0)
      await tx
        .insert(templates)
        .values({ id: uuidv7(), workspaceId: null, slug: t.slug, ...values });
  }
  return list.length;
}
