import { z } from "zod";
import { FeatureKeySchema, RoleSchema, SlugSchema } from "./common.js";

export const UserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  status: z.enum(["active", "invited", "disabled"]),
});
export const WorkspaceSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  role: RoleSchema,
});
export const SessionResponseSchema = z.object({
  user: UserSchema,
  workspaces: z.array(WorkspaceSummarySchema),
  /** access-token expiry (epoch ms); the cookie carries the token */
  expiresAt: z.number(),
  /** the password must be changed before anything else (first-boot owner, admin reset) */
  mustChangePassword: z.boolean(),
});
export const LoginRequestSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
});

export const MeResponseSchema = z.object({
  principal: z.object({
    type: z.string(),
    id: z.string(),
    workspaceId: z.string().nullable(),
    workspaceSlug: z.string().nullable(),
    role: RoleSchema.nullable(),
    scopes: z.array(z.string()),
    environmentId: z.string().nullable(),
    workflowIds: z.array(z.string()).nullable(),
  }),
  user: UserSchema.nullable(),
  workspaces: z.array(WorkspaceSummarySchema),
  features: z.record(FeatureKeySchema, z.boolean()),
});

export const WorkspaceSettingsSchema = z
  .object({
    retention: z
      .object({
        runsDays: z.int().min(1).max(3650).optional(),
        auditDays: z.int().min(90).max(3650).optional(),
        artifactsDays: z.int().min(1).max(3650).optional(),
      })
      .optional(),
    maxQueuedRuns: z.int().min(1).max(1_000_000).optional(),
    defaultDecisionChain: z.array(z.unknown()).optional(),
    budgets: z.object({ monthlyCostUsd: z.number().min(0).optional() }).optional(),
    /** the generation model the AI builder uses (default: the first provider with a key) */
    advisorModel: z.object({ provider: z.string(), model: z.string() }).optional(),
  })
  .loose();

export const WorkspaceSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  settings: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export const CreateWorkspaceRequestSchema = z.object({
  name: z.string().min(1).max(100),
  slug: SlugSchema,
});
export const PatchWorkspaceRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  settings: WorkspaceSettingsSchema.optional(),
});

export const MemberSchema = z.object({
  userId: z.uuid(),
  email: z.string(),
  name: z.string(),
  role: RoleSchema,
  status: z.string(),
  joinedAt: z.string(),
});
export const MemberRequestSchema = z.object({
  email: z.string().email(),
  role: RoleSchema.exclude(["owner"]),
});

export const EnvironmentSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  protected: z.boolean(),
  variables: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export const EnvironmentRequestSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  variables: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/), z.unknown()).default({}),
  protected: z.boolean().default(false),
});

/** PATCH: every field optional and no defaults (absent fields keep their stored values). */
export const EnvironmentPatchSchema = z.object({
  name: EnvironmentRequestSchema.shape.name.optional(),
  variables: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/), z.unknown()).optional(),
  protected: z.boolean().optional(),
});

export const ApiKeySummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  environmentId: z.string().nullable(),
  workflowIds: z.array(z.string()).nullable(),
  serviceAccount: z.boolean(),
  rateLimitPerMin: z.number().nullable(),
  expiresAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});
export const CreateApiKeyRequestSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).min(1),
  mode: z.enum(["live", "test"]).default("live"),
  environmentId: z.uuid().optional(),
  workflowIds: z.array(z.uuid()).max(200).optional(),
  expiresAt: z.iso.datetime().optional(),
  rateLimitPerMin: z.int().min(1).max(100_000).optional(),
  serviceAccount: z.object({ name: z.string().min(1).max(100) }).optional(),
});
export const ApiKeyCreatedSchema = z.object({
  id: z.uuid(),
  prefix: z.string(),
  key: z.string(),
  expiresAt: z.string(),
});
