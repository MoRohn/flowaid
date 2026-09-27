/** Workflow helpers shared by the workflow, version and run routes. */
import { and, eq, like } from "drizzle-orm";
import {
  environments,
  workflowDeployments,
  workflowVersions,
  workflows,
  type DeploymentRow,
  type Tx,
  type WorkflowRow,
} from "@flowaid/database";
import { NotFoundError, WORKFLOW_SCHEMA_URI, type JsonObject } from "@flowaid/workflow-core";
import { canSeeWorkflow, type Principal } from "../auth/principal.js";

export function slugify(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36)
    .replace(/-+$/g, "");
  return s.length >= 3
    ? s
    : `${s || "workflow"}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 40);
}

/** `slug`, `slug-2`, `slug-3` … unique within the workspace. */
export async function uniqueSlug(tx: Tx, workspaceId: string, base: string): Promise<string> {
  const rows = await tx
    .select({ slug: workflows.slug })
    .from(workflows)
    .where(and(eq(workflows.workspaceId, workspaceId), like(workflows.slug, `${base}%`)));
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** A workflow of the principal's workspace that the principal may see (pins apply). */
export async function visibleWorkflow(tx: Tx, p: Principal, id: string): Promise<WorkflowRow> {
  const [row] = await tx
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, id), eq(workflows.workspaceId, p.workspaceId)));
  if (!row || !canSeeWorkflow(p, id)) throw new NotFoundError(`workflow ${id} not found`);
  return row;
}

export function blankDefinition(id: string, name: string): JsonObject {
  return {
    $schema: WORKFLOW_SCHEMA_URI,
    id,
    name,
    description: "",
    inputs: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
    outputs: { type: "object", properties: { message: { type: "string" } } },
    nodes: [
      { id: "start", kind: "input", name: "Input" },
      {
        id: "done",
        kind: "output",
        name: "Output",
        value: {
          kind: "object",
          fields: {
            message: { kind: "ref", ref: { kind: "port", node: "start", port: "message" } },
          },
        },
      },
    ],
    edges: [],
  };
}

/** Rewrites `$template.<kind>.<key>` sentinels with the chosen resource ids. */
export function instantiateTemplate(
  definition: unknown,
  resources: Record<string, string>,
): unknown {
  return JSON.parse(
    JSON.stringify(definition).replace(
      /"\$template\.([a-z]+)\.([a-z0-9_]+)"/g,
      (m, kind: string, key: string) => {
        const id = resources[`${kind}.${key}`] ?? resources[key];
        return id ? JSON.stringify(id) : m;
      },
    ),
  ) as unknown;
}

export async function deploymentsOf(
  tx: Tx,
  workflowId: string,
): Promise<(DeploymentRow & { environment: string; version: number | null })[]> {
  const rows = await tx
    .select({ d: workflowDeployments, env: environments.name, version: workflowVersions.version })
    .from(workflowDeployments)
    .innerJoin(environments, eq(environments.id, workflowDeployments.environmentId))
    .innerJoin(workflowVersions, eq(workflowVersions.id, workflowDeployments.versionId))
    .where(
      and(eq(workflowDeployments.workflowId, workflowId), eq(workflowDeployments.active, true)),
    );
  return rows.map((r) => ({ ...r.d, environment: r.env, version: r.version }));
}

export const deploymentDto = (
  d: DeploymentRow & { environment: string; version: number | null },
) => ({
  id: d.id,
  environmentId: d.environmentId,
  environment: d.environment,
  versionId: d.versionId,
  version: d.version,
  previousVersionId: d.previousVersionId,
  variableOverrides: d.variableOverrides as Record<string, unknown>,
  deployedAt: d.deployedAt.toISOString(),
  deployedBy: d.deployedBy,
});
