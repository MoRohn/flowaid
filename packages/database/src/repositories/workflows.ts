/**
 * Workflows, versions, deployments and secret bindings.
 *
 * - Drafts use optimistic concurrency: `saveDraft` succeeds only at the expected revision
 *   (HTTP If-Match), otherwise `ConflictError`.
 * - Published version numbers are dense per workflow: the workflow row is locked while the next
 *   number is taken.
 * - A deployment replaces the active one of (workflow, environment) atomically and remembers the
 *   previous version, so `rollback` is one step.
 */
import { and, asc, desc, eq, isNull, max, sql } from "drizzle-orm";
import { uuidv7 } from "@flowaid/shared";
import {
  ConflictError,
  NotFoundError,
  type Diagnostic,
  type JsonValue,
  type WorkflowDefinition,
} from "@flowaid/workflow-core";
import type { Tx } from "../db.js";
import { secretReferences, workflowDeployments, workflows, workflowVersions } from "../schema.js";

export type WorkflowRow = typeof workflows.$inferSelect;
export type WorkflowVersionRow = typeof workflowVersions.$inferSelect;
export type DeploymentRow = typeof workflowDeployments.$inferSelect;

export async function createWorkflow(
  tx: Tx,
  input: {
    workspaceId: string;
    name: string;
    slug: string;
    draft: WorkflowDefinition;
    description?: string;
    tags?: string[];
    createdBy?: string | null;
  },
): Promise<WorkflowRow> {
  const [row] = await tx
    .insert(workflows)
    .values({
      id: uuidv7(),
      workspaceId: input.workspaceId,
      name: input.name,
      slug: input.slug,
      description: input.description ?? "",
      tags: input.tags ?? [],
      draft: input.draft,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return row as WorkflowRow;
}

export async function getWorkflow(tx: Tx, id: string): Promise<WorkflowRow | null> {
  const [row] = await tx.select().from(workflows).where(eq(workflows.id, id));
  return row ?? null;
}

export async function listWorkflows(
  tx: Tx,
  input: { workspaceId: string; includeArchived?: boolean; limit?: number },
): Promise<WorkflowRow[]> {
  return tx
    .select()
    .from(workflows)
    .where(
      and(
        eq(workflows.workspaceId, input.workspaceId),
        input.includeArchived ? undefined : isNull(workflows.archivedAt),
      ),
    )
    .orderBy(desc(workflows.updatedAt))
    .limit(input.limit ?? 100);
}

/** Saves a draft at `expectedRevision`; returns the new revision. */
export async function saveDraft(
  tx: Tx,
  id: string,
  expectedRevision: number,
  draft: WorkflowDefinition,
  diagnostics: Diagnostic[],
): Promise<number> {
  const [row] = await tx
    .update(workflows)
    .set({
      draft,
      draftDiagnostics: diagnostics,
      draftRevision: sql`${workflows.draftRevision} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(workflows.id, id), eq(workflows.draftRevision, expectedRevision)))
    .returning({ revision: workflows.draftRevision });
  if (row) return row.revision;
  const current = await getWorkflow(tx, id);
  if (!current) throw new NotFoundError(`Workflow ${id} does not exist`);
  throw new ConflictError(
    `The draft changed (revision ${current.draftRevision}, expected ${expectedRevision}); reload and retry`,
    {
      currentRevision: current.draftRevision,
    },
  );
}

export async function archiveWorkflow(tx: Tx, id: string): Promise<void> {
  await tx
    .update(workflows)
    .set({ archivedAt: sql`now()` })
    .where(eq(workflows.id, id));
}

type VersionContent = Pick<
  typeof workflowVersions.$inferInsert,
  | "definition"
  | "definitionHash"
  | "plan"
  | "planHash"
  | "compilerVersion"
  | "catalogSnapshot"
  | "diagnostics"
>;

/** Publishes the next version number of a workflow. */
export async function publishVersion(
  tx: Tx,
  input: VersionContent & {
    workflowId: string;
    notes?: string | null;
    label?: string | null;
    publishedBy?: string | null;
    evaluationRunId?: string | null;
  },
): Promise<WorkflowVersionRow> {
  const [wf] = await tx
    .select()
    .from(workflows)
    .where(eq(workflows.id, input.workflowId))
    .for("update");
  if (!wf) throw new NotFoundError(`Workflow ${input.workflowId} does not exist`);
  const [last] = await tx
    .select({ n: max(workflowVersions.version) })
    .from(workflowVersions)
    .where(eq(workflowVersions.workflowId, input.workflowId));
  const [row] = await tx
    .insert(workflowVersions)
    .values({
      id: uuidv7(),
      workspaceId: wf.workspaceId,
      workflowId: wf.id,
      kind: "published",
      version: (last?.n ?? 0) + 1,
      label: input.label ?? null,
      definition: input.definition,
      definitionHash: input.definitionHash,
      plan: input.plan,
      planHash: input.planHash,
      compilerVersion: input.compilerVersion,
      catalogSnapshot: input.catalogSnapshot,
      diagnostics: input.diagnostics ?? [],
      notes: input.notes ?? null,
      publishedBy: input.publishedBy ?? null,
      evaluationRunId: input.evaluationRunId ?? null,
    })
    .returning();
  await tx
    .update(workflows)
    .set({ latestVersionId: row?.id, updatedAt: sql`now()` })
    .where(eq(workflows.id, wf.id));
  return row as WorkflowVersionRow;
}

/** The draft version for a plan hash (test runs of the draft), created on first use. */
export async function draftVersion(
  tx: Tx,
  input: VersionContent & { workspaceId: string; workflowId: string; revision: number },
): Promise<WorkflowVersionRow> {
  const [existing] = await tx
    .select()
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.workflowId, input.workflowId),
        eq(workflowVersions.kind, "draft"),
        eq(workflowVersions.planHash, input.planHash),
      ),
    );
  if (existing) return existing;
  const [row] = await tx
    .insert(workflowVersions)
    .values({
      id: uuidv7(),
      workspaceId: input.workspaceId,
      workflowId: input.workflowId,
      kind: "draft",
      version: null,
      label: `draft@rev${input.revision}`,
      definition: input.definition,
      definitionHash: input.definitionHash,
      plan: input.plan,
      planHash: input.planHash,
      compilerVersion: input.compilerVersion,
      catalogSnapshot: input.catalogSnapshot,
      diagnostics: input.diagnostics ?? [],
    })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  // A concurrent request created it first.
  const [raced] = await tx
    .select()
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.workflowId, input.workflowId),
        eq(workflowVersions.kind, "draft"),
        eq(workflowVersions.planHash, input.planHash),
      ),
    );
  return raced as WorkflowVersionRow;
}

export async function listVersions(tx: Tx, workflowId: string): Promise<WorkflowVersionRow[]> {
  return tx
    .select()
    .from(workflowVersions)
    .where(and(eq(workflowVersions.workflowId, workflowId), eq(workflowVersions.kind, "published")))
    .orderBy(desc(workflowVersions.version));
}

export async function getVersion(tx: Tx, id: string): Promise<WorkflowVersionRow | null> {
  const [row] = await tx.select().from(workflowVersions).where(eq(workflowVersions.id, id));
  return row ?? null;
}

export async function activeDeployment(
  tx: Tx,
  workflowId: string,
  environmentId: string,
): Promise<DeploymentRow | null> {
  const [row] = await tx
    .select()
    .from(workflowDeployments)
    .where(
      and(
        eq(workflowDeployments.workflowId, workflowId),
        eq(workflowDeployments.environmentId, environmentId),
        eq(workflowDeployments.active, true),
      ),
    );
  return row ?? null;
}

/** Deploys a version to an environment, replacing the active deployment atomically. */
export async function deploy(
  tx: Tx,
  input: {
    workflowId: string;
    environmentId: string;
    versionId: string;
    variableOverrides?: Record<string, JsonValue>;
    deployedBy?: string | null;
  },
): Promise<DeploymentRow> {
  const version = await getVersion(tx, input.versionId);
  if (!version || version.workflowId !== input.workflowId || version.kind !== "published")
    throw new NotFoundError(
      `Version ${input.versionId} is not a published version of workflow ${input.workflowId}`,
    );
  const [wf] = await tx
    .select({ id: workflows.id })
    .from(workflows)
    .where(eq(workflows.id, input.workflowId))
    .for("update");
  if (!wf) throw new NotFoundError(`Workflow ${input.workflowId} does not exist`);
  const previous = await activeDeployment(tx, input.workflowId, input.environmentId);
  if (previous)
    await tx
      .update(workflowDeployments)
      .set({ active: false })
      .where(eq(workflowDeployments.id, previous.id));
  const [row] = await tx
    .insert(workflowDeployments)
    .values({
      id: uuidv7(),
      workspaceId: version.workspaceId,
      workflowId: input.workflowId,
      environmentId: input.environmentId,
      versionId: input.versionId,
      variableOverrides: input.variableOverrides ?? previous?.variableOverrides ?? {},
      previousVersionId: previous?.versionId ?? null,
      deployedBy: input.deployedBy ?? null,
    })
    .returning();
  return row as DeploymentRow;
}

/** Redeploys the version that was active before the current one. */
export async function rollback(
  tx: Tx,
  workflowId: string,
  environmentId: string,
  by?: string | null,
): Promise<DeploymentRow> {
  const current = await activeDeployment(tx, workflowId, environmentId);
  if (!current?.previousVersionId)
    throw new ConflictError("There is no previous deployment to roll back to");
  return deploy(tx, {
    workflowId,
    environmentId,
    versionId: current.previousVersionId,
    variableOverrides: current.variableOverrides,
    deployedBy: by ?? null,
  });
}

export async function deploymentHistory(tx: Tx, workflowId: string): Promise<DeploymentRow[]> {
  return tx
    .select()
    .from(workflowDeployments)
    .where(eq(workflowDeployments.workflowId, workflowId))
    .orderBy(desc(workflowDeployments.deployedAt));
}

export async function bindSecret(
  tx: Tx,
  input: {
    workspaceId: string;
    workflowId: string;
    environmentId: string;
    secretName: string;
    credentialId: string;
  },
): Promise<void> {
  await tx
    .insert(secretReferences)
    .values(input)
    .onConflictDoUpdate({
      target: [
        secretReferences.workflowId,
        secretReferences.environmentId,
        secretReferences.secretName,
      ],
      set: { credentialId: input.credentialId },
    });
}

export async function unbindSecret(
  tx: Tx,
  workflowId: string,
  environmentId: string,
  secretName: string,
): Promise<void> {
  await tx
    .delete(secretReferences)
    .where(
      and(
        eq(secretReferences.workflowId, workflowId),
        eq(secretReferences.environmentId, environmentId),
        eq(secretReferences.secretName, secretName),
      ),
    );
}

export async function listSecretBindings(tx: Tx, workflowId: string) {
  return tx
    .select()
    .from(secretReferences)
    .where(eq(secretReferences.workflowId, workflowId))
    .orderBy(asc(secretReferences.secretName));
}

/** Where a credential is bound (GET /v1/secrets/where-used). */
export async function credentialUsage(tx: Tx, credentialId: string) {
  return tx.select().from(secretReferences).where(eq(secretReferences.credentialId, credentialId));
}
