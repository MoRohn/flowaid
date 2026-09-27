import { z } from "zod";
import { SlugSchema } from "./common.js";

const Json = z.unknown();
export const DiagnosticSchema = z
  .object({ code: z.string(), severity: z.enum(["error", "warning", "info"]), message: z.string() })
  .loose();

export const WorkflowSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  draftRevision: z.number(),
  latestVersionId: z.string().nullable(),
  latestVersion: z.number().nullable(),
  archived: z.boolean(),
  errors: z.number(),
  warnings: z.number(),
  updatedAt: z.string(),
});

export const DeploymentSchema = z.object({
  id: z.uuid(),
  environmentId: z.uuid(),
  environment: z.string(),
  versionId: z.uuid(),
  version: z.number().nullable(),
  previousVersionId: z.string().nullable(),
  variableOverrides: z.record(z.string(), Json),
  deployedAt: z.string(),
  deployedBy: z.string().nullable(),
});

export const WorkflowSchema = WorkflowSummarySchema.extend({
  draft: Json,
  draftDiagnostics: z.array(DiagnosticSchema),
  evaluationSetId: z.string().nullable(),
  deployments: z.array(DeploymentSchema),
  createdAt: z.string(),
});

export const CreateWorkflowRequestSchema = z.object({
  name: z.string().min(1).max(200),
  slug: SlugSchema.optional(),
  description: z.string().max(4000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  definition: Json.optional(),
  templateId: z.string().optional(),
  /** template resources: `$template.<kind>.<key>` → resource id */
  resources: z.record(z.string(), z.uuid()).optional(),
});
export const PatchWorkflowRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  slug: SlugSchema.optional(),
  description: z.string().max(4000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  evaluationSetId: z.uuid().nullable().optional(),
});

export const DraftResponseSchema = z.object({
  draftRevision: z.number(),
  diagnostics: z.array(DiagnosticSchema),
});
export const ValidateRequestSchema = z.object({
  definition: Json.optional(),
  environmentId: z.uuid().optional(),
  level: z.enum(["draft", "publish"]).default("draft"),
});
export const ValidateResponseSchema = z.object({
  ok: z.boolean(),
  diagnostics: z.array(DiagnosticSchema),
  planHash: z.string().nullable(),
});
export const CompileResponseSchema = ValidateResponseSchema.extend({ plan: Json.optional() });

export const PublishRequestSchema = z.object({
  notes: z.string().max(4000).optional(),
  label: z.string().max(100).optional(),
  deployTo: z.array(z.uuid()).max(10).optional(),
});

export const WorkflowVersionSummarySchema = z.object({
  id: z.uuid(),
  workflowId: z.uuid(),
  kind: z.enum(["published", "draft"]),
  version: z.number().nullable(),
  label: z.string().nullable(),
  definitionHash: z.string(),
  planHash: z.string(),
  compilerVersion: z.string(),
  notes: z.string().nullable(),
  publishedBy: z.string().nullable(),
  createdAt: z.string(),
});
export const WorkflowVersionSchema = WorkflowVersionSummarySchema.extend({
  definition: Json,
  plan: Json.optional(),
  diagnostics: z.array(DiagnosticSchema),
  catalogSnapshot: z.record(z.string(), z.string()),
});

export const DeployRequestSchema = z.object({
  versionId: z.uuid(),
  variableOverrides: z.record(z.string(), Json).optional(),
});
export const TriggersSchema = z.object({
  webhooks: z.array(
    z.object({
      id: z.string(),
      path: z.string(),
      url: z.string(),
      signature: z.string(),
      secretBound: z.boolean(),
    }),
  ),
  schedules: z.array(
    z.object({
      id: z.string(),
      cron: z.string(),
      timezone: z.string(),
      nextRunAt: z.string().nullable(),
    }),
  ),
  mcpExposures: z.array(z.object({ id: z.string(), toolName: z.string() })),
  disabled: z.array(z.object({ kind: z.string(), id: z.string() })),
});
export const DeployResponseSchema = DeploymentSchema.extend({ triggers: TriggersSchema });
