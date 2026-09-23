# flowaid — Database (`@flowaid/database`)

Authoritative schema for PostgreSQL 16 (+ `pgvector`), expressed as Drizzle `pg-core` definitions. The code lives in **one file**, `packages/database/src/schema.ts`, ordered by the section headers below (WP-03). Names here are the names used by `ARCHITECTURE.md`, `API.md` and `CONTRACTS.ts`. Additions since v1.0 (jobs, user_tokens, human_task_review_tokens, event_subscriptions, credential storage, webhook/schedule hardening columns) are marked `// v1.1` and ship in `0001_init.sql` — nothing is deployed yet, so there is no second migration for them.

## Conventions

- Ids are `uuid` v7 generated in the application (`@flowaid/shared` `uuidv7()`), never by the database, so ids exist before the insert (events reference `nodeRunId`s minted by the scheduler).
- Every tenant-owned table has `workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` and an index starting with `workspace_id`. `migrations/0002_rls.sql` runs `ENABLE` **and** `FORCE ROW LEVEL SECURITY` on every such table (table owners would otherwise bypass RLS) with the policy `USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid OR current_setting('app.bypass_rls', true) = 'on')` — an unset GUC yields zero rows (fail closed); the sweep and `db reproject` set the bypass GUC. It also creates the roles `flowaid_app` (api/worker) and `flowaid_code` (`worker-code`: `queue_jobs`, `node_runs`, `run_events` insert only); migrations run as the owner through `DATABASE_ADMIN_URL` (defaults to `DATABASE_URL`). Policies are active when `DB_RLS=true`, which is the compose default; the API runs `SET LOCAL app.workspace_id` per request.
- Timestamps are `timestamptz`. JSON columns are `jsonb` and are validated with the Zod schema named in the `$type<>` at the repository boundary (never raw writes).
- Enums that are open-ended in the product (`origin`, `purpose`, `kind`) are `text` with a `$type<>`; enums that gate indexes and state machines (`run_status`, `node_run_status`) are Postgres enums.
- Migrations: `drizzle-kit generate` → `packages/database/migrations/*.sql`, applied by `flowaid db migrate` and by the api container entrypoint (fail-fast, never at request time). Postgres only (D26).
- Money is `numeric(12,6)`; probabilities/confidence are `numeric(6,5)`.

## Schema (Drizzle)

```ts
// packages/database/src/schema.ts
import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  bigint,
  boolean,
  numeric,
  index,
  uniqueIndex,
  primaryKey,
  check,
  customType,
} from "drizzle-orm/pg-core";
import type {
  JsonValue,
  JsonObject,
  JsonSchema,
  WorkflowDefinition,
  ExecutionPlan,
  Diagnostic,
  ErrorInfo,
  TokenUsage,
  DecisionResult,
  HumanRequest,
  HumanResponse,
  SecretDecl,
  Trigger,
  ToolDefinition,
  NodeManifest,
  NodeKind,
  PortName,
  TimerPurpose,
  RunOrigin,
  RunMode,
  WorkerPool,
} from "@flowaid/workflow-core";

/* ───────────────────────── custom types ───────────────────────── */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    return value.slice(1, -1).split(",").map(Number);
  },
});
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/* ───────────────────────── enums ───────────────────────── */
export const runStatusEnum = pgEnum("run_status", [
  "queued",
  "starting",
  "running",
  "waiting",
  "waiting_for_human",
  "retrying",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);
export const nodeRunStatusEnum = pgEnum("node_run_status", [
  "pending",
  "running",
  "waiting",
  "retry_wait",
  "completed",
  "failed",
  "skipped",
  "cancelled",
  "reused",
]);
export const workspaceRoleEnum = pgEnum("workspace_role", [
  "owner",
  "admin",
  "editor",
  "operator",
  "viewer",
]);
export const dataClassEnum = pgEnum("data_class", ["public", "internal", "sensitive", "pii"]);
export const retentionClassEnum = pgEnum("retention_class", ["standard", "short", "long", "none"]);

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

/* ───────────────────────── identity & tenancy ───────────────────────── */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"), // argon2id; null for SSO-only users
    status: text("status", { enum: ["active", "invited", "disabled"] })
      .notNull()
      .default("invited"),
    tokenVersion: integer("token_version").notNull().default(0), // v1.1: JWT claim `tv`; bumped on password change, logout-all, member removal, role change
    passwordChangedAt: ts("password_changed_at"), // v1.1
    lastLoginAt: ts("last_login_at"), // MFA (mfa_secret_enc) is deferred to the OIDC/MFA phase; no column until then
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)],
);

export const identities = pgTable(
  "identities",
  {
    // OIDC / SSO links
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("identities_provider_subject_uq").on(t.provider, t.subject),
    index("identities_user_idx").on(t.userId),
  ],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(), // v1.1: one family per login (= session `sid`); reuse of a rotated token revokes the family
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    replacedById: uuid("replaced_by_id"),
    userAgent: text("user_agent"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("refresh_tokens_hash_uq").on(t.tokenHash),
    index("refresh_tokens_user_idx").on(t.userId),
    index("refresh_tokens_family_idx").on(t.familyId),
  ],
);

export const userTokens = pgTable(
  "user_tokens",
  {
    // v1.1: invitation acceptance, password reset, email verification
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["invite", "password_reset", "email_verify"] }).notNull(),
    tokenHash: text("token_hash").notNull(), // sha256 of a 32-byte base64url token sent by the email channel
    expiresAt: ts("expires_at").notNull(), // invite 7 d, password_reset 1 h
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("user_tokens_hash_uq").on(t.tokenHash),
    index("user_tokens_user_idx").on(t.userId, t.kind),
  ],
);

export interface WorkspaceSettings {
  decisions?: { primary: JsonObject; failover: JsonObject[] }; // ProviderHop[]; workspace default decision chain
  egress?: { allow: string[]; deny: string[] };
  maxQueuedRuns?: number;
  retention?: Partial<Record<"standard" | "short" | "long", number>>; // days
  privacy?: { persistPII: boolean };
  redactionRules?: {
    pointer?: string;
    regex?: string;
    dataClass?: string;
    mode: "mask" | "hash" | "drop";
  }[];
  traceReview?: { enabled: boolean; sampleRate: number };
  prices?: Record<string, { inputPerMTok: number; outputPerMTok: number }>;
  artifacts?: { maxUploadBytes: number }; // v1.1: presigned PUT size cap (default 100 MiB)
  security?: { mfaRequired: boolean }; // v1.1: honoured once MFA ships
}
// v1.1: `WorkspaceSettingsSchema` (Zod, apps/api/src/dto/workspaces.ts) validates PATCH /v1/workspaces/:id — retention ≥ 1 d, audit ≥ 90 d, sampleRate ∈ [0,1].
export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    settings: jsonb("settings").$type<WorkspaceSettings>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("workspaces_slug_uq").on(t.slug)],
);

export const memberships = pgTable(
  "memberships",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index("memberships_user_idx").on(t.userId),
  ],
);

export const environments = pgTable(
  "environments",
  {
    // seeded: dev, staging, prod; admins may add more
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    variables: jsonb("variables").$type<Record<string, JsonValue>>().notNull().default({}), // source='environment' variables
    protected: boolean("protected").notNull().default(false), // prod: publish/deploy requires admin
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("environments_ws_name_uq").on(t.workspaceId, t.name)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(), // "fa_live_" + 8 chars; shown in UI
    keyHash: text("key_hash").notNull(), // sha256(full key); lookup by hash
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    environmentId: uuid("environment_id").references(() => environments.id, {
      onDelete: "set null",
    }),
    workflowIds: jsonb("workflow_ids").$type<string[] | null>(), // null = any workflow
    isServiceAccount: boolean("is_service_account").notNull().default(false), // service accounts (incl. MCP tokens, scope mcp:serve) keep stored scopes; others intersect with the creator's current role
    rateLimitPerMin: integer("rate_limit_per_min"), // v1.1: null = the api-key default (API.md §1)
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: ts("expires_at").notNull(), // v1.1: default +365 d at creation; rotate sets the old key's expiry to now()+grace
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("api_keys_hash_uq").on(t.keyHash),
    index("api_keys_ws_idx").on(t.workspaceId),
  ],
);

/* ───────────────────────── workflows ───────────────────────── */
export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    draft: jsonb("draft").$type<WorkflowDefinition>().notNull(),
    draftRevision: integer("draft_revision").notNull().default(1), // optimistic concurrency (If-Match)
    draftDiagnostics: jsonb("draft_diagnostics").$type<Diagnostic[]>().notNull().default([]),
    latestVersionId: uuid("latest_version_id"),
    evaluationSetId: uuid("evaluation_set_id"), // linked set for the publish-time regression report
    archivedAt: ts("archived_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("workflows_ws_slug_uq").on(t.workspaceId, t.slug),
    index("workflows_ws_updated_idx").on(t.workspaceId, t.updatedAt),
  ],
);

export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["published", "draft"] }).notNull(),
    version: integer("version"), // 1,2,3… for published; NULL for draft
    label: text("label"), // "draft@rev12" for drafts; optional tag for published
    definition: jsonb("definition").$type<WorkflowDefinition>().notNull(),
    definitionHash: text("definition_hash").notNull(),
    plan: jsonb("plan").$type<ExecutionPlan>().notNull(),
    planHash: text("plan_hash").notNull(),
    compilerVersion: text("compiler_version").notNull(),
    catalogSnapshot: jsonb("catalog_snapshot").$type<Record<string, string>>().notNull(), // nodeTypeId → version
    diagnostics: jsonb("diagnostics").$type<Diagnostic[]>().notNull().default([]), // warnings at publish
    notes: text("notes"),
    evaluationRunId: uuid("evaluation_run_id"), // gate report that allowed this publish
    publishedBy: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("workflow_versions_wf_version_uq")
      .on(t.workflowId, t.version)
      .where(sql`${t.version} IS NOT NULL`),
    uniqueIndex("workflow_versions_draft_hash_uq")
      .on(t.workflowId, t.planHash)
      .where(sql`${t.kind} = 'draft'`),
    index("workflow_versions_wf_idx").on(t.workflowId, t.createdAt),
  ],
);

export const workflowDeployments = pgTable(
  "workflow_deployments",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => workflowVersions.id),
    variableOverrides: jsonb("variable_overrides")
      .$type<Record<string, JsonValue>>()
      .notNull()
      .default({}),
    previousVersionId: uuid("previous_version_id"),
    active: boolean("active").notNull().default(true),
    deployedBy: uuid("deployed_by").references(() => users.id, { onDelete: "set null" }),
    deployedAt: ts("deployed_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("workflow_deployments_active_uq")
      .on(t.workflowId, t.environmentId)
      .where(sql`${t.active}`),
    index("workflow_deployments_wf_idx").on(t.workflowId, t.deployedAt),
  ],
);

/** Binds WorkflowDefinition.secrets[].name → credential per workflow × environment. */
export const secretReferences = pgTable(
  "secret_references",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    secretName: text("secret_name").notNull(),
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => credentials.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workflowId, t.environmentId, t.secretName] }),
    index("secret_references_cred_idx").on(t.credentialId),
  ],
);

/* ───────────────────────── credentials ───────────────────────── */
export const credentials = pgTable(
  "credentials",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(), // credential type id, e.g. 'typesafe.api_key'
    storage: text("storage", { enum: ["db", "external"] })
      .notNull()
      .default("db"), // v1.1: where the value lives (master-key providers are a separate concern: encryption_keys.master_provider). CredentialRepository.getCiphertext().provider carries this value.
    ciphertext: text("ciphertext"), // db: base64(iv|tag|data) AES-256-GCM under the DEK
    wrappedDataKey: text("wrapped_data_key"), // DEK wrapped by KEK version
    keyVersion: integer("key_version"),
    externalRef: text("external_ref"), // external: env:FLOWAID_SECRET_* | vault:path#key | aws-sm:arn | azure-kv:<vault>/<secret>[/<version>] | gcp-sm:projects/*/secrets/*/versions/* (ARCHITECTURE.md §10.6; validated at write)
    publicFields: jsonb("public_fields").$type<Record<string, string>>().notNull().default({}), // non-secret fields (base_url, region)
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]), // tool capabilities: ['github.read']
    environmentId: uuid("environment_id").references(() => environments.id, {
      onDelete: "cascade",
    }), // null = any environment
    allowedWorkflowIds: jsonb("allowed_workflow_ids").$type<string[] | null>(),
    lastTestedAt: ts("last_tested_at"),
    lastTestOk: boolean("last_test_ok"),
    lastUsedAt: ts("last_used_at"),
    rotatedAt: ts("rotated_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("credentials_ws_name_env_uq").on(
      t.workspaceId,
      t.name,
      sql`coalesce(${t.environmentId}, '${sql.raw(ZERO_UUID)}'::uuid)`,
    ),
    index("credentials_ws_type_idx").on(t.workspaceId, t.type),
  ],
);

export const encryptionKeys = pgTable("encryption_keys", {
  // KEK versions wrapped by the master key provider
  version: integer("version").primaryKey(),
  wrappedKek: text("wrapped_kek").notNull(),
  masterProvider: text("master_provider").notNull(), // env | file | aws-kms | vault-transit (| azure-keyvault | gcp-kms later)
  masterKcv: text("master_kcv").notNull(), // v1.1: base64(first 8 bytes of HMAC-SHA256(master, 'flowaid/master-kcv/v1')); verified at boot (E_MASTER_KEY_MISMATCH)
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/* ───────────────────────── runs (event-sourced) ───────────────────────── */
export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    workflowVersionId: uuid("workflow_version_id")
      .notNull()
      .references(() => workflowVersions.id),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environments.id),
    status: runStatusEnum("status").notNull().default("queued"),
    origin: text("origin").$type<RunOrigin>().notNull(),
    mode: text("mode").$type<RunMode>().notNull(),
    input: jsonb("input").$type<JsonValue>().notNull(),
    output: jsonb("output").$type<JsonValue>(),
    outcome: text("outcome"),
    error: jsonb("error").$type<ErrorInfo>(),
    variables: jsonb("variables").$type<Record<string, JsonValue>>().notNull().default({}), // resolved run_input variables
    parentRunId: uuid("parent_run_id"),
    parentNodeRunId: uuid("parent_node_run_id"),
    sourceRunId: uuid("source_run_id"), // replay / restart / fork source
    sessionId: text("session_id"),
    idempotencyKey: text("idempotency_key"),
    idempotencyHash: text("idempotency_hash"),
    labels: jsonb("labels").$type<Record<string, string>>().notNull().default({}),
    lastSeq: integer("last_seq").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseUntil: ts("lease_until"),
    cancelRequestedAt: ts("cancel_requested_at"),
    cancelRequestedBy: text("cancel_requested_by"),
    cancelReason: text("cancel_reason"),
    usage: jsonb("usage")
      .$type<TokenUsage>()
      .notNull()
      .default({ inputTokens: 0, outputTokens: 0 }),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    nodeRunCount: integer("node_run_count").notNull().default(0),
    privacy: jsonb("privacy")
      .$type<{
        sensitive: boolean;
        containsPII: boolean;
        doNotPersist: boolean;
        replayable: boolean;
      }>()
      .notNull()
      .default({ sensitive: false, containsPII: false, doNotPersist: false, replayable: true }),
    dataClass: dataClassEnum("data_class").notNull().default("internal"),
    retentionClass: retentionClassEnum("retention_class").notNull().default("standard"),
    review: jsonb("review").$type<{
      verdict: string;
      confidence: number;
      reasons: string[];
      at: string;
    }>(), // TraceReviewer verdict
    createdAt: createdAt(),
    startedAt: ts("started_at"),
    endedAt: ts("ended_at"),
    expiresAt: ts("expires_at"),
  },
  (t) => [
    index("runs_ws_created_idx").on(t.workspaceId, t.createdAt.desc()),
    index("runs_wf_created_idx").on(t.workflowId, t.createdAt.desc()),
    index("runs_ws_status_idx")
      .on(t.workspaceId, t.status)
      .where(sql`${t.status} NOT IN ('completed','failed','cancelled','timed_out')`),
    index("runs_lease_idx")
      .on(t.leaseUntil)
      .where(sql`${t.leaseOwner} IS NOT NULL`),
    uniqueIndex("runs_idem_uq")
      .on(t.workspaceId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    index("runs_parent_idx").on(t.parentRunId),
    index("runs_session_idx").on(t.workspaceId, t.sessionId),
    index("runs_expires_idx")
      .on(t.expiresAt)
      .where(sql`${t.expiresAt} IS NOT NULL`),
  ],
);

export const runEvents = pgTable(
  "run_events",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").notNull(), // RunEventType
    nodeRunId: uuid("node_run_id"),
    nodeId: text("node_id"),
    scope: text("scope"),
    payload: jsonb("payload").$type<JsonObject>().notNull(), // the full RunEvent (redacted), validated by RunEventSchema
    at: ts("at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.seq] }),
    index("run_events_type_idx").on(t.runId, t.type),
    index("run_events_node_run_idx").on(t.nodeRunId),
    check("run_events_payload_size", sql`pg_column_size(${t.payload}) < 262144`),
  ],
);
// RUN_EVENTS_PARTITIONED=true: migration 0003 converts to PARTITION BY RANGE (at), monthly partitions created 3 months ahead by the sweep job.

export const nodeRuns = pgTable(
  "node_runs",
  {
    id: uuid("id").primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    scope: text("scope").notNull().default(""),
    attempt: integer("attempt").notNull().default(1),
    kind: text("kind").$type<NodeKind>().notNull(), // v1.1: the plan node kind (RFC-0002 narrows NodeRunSchema.kind to the same enum)
    nodeType: text("node_type"),
    nodeName: text("node_name").notNull(),
    status: nodeRunStatusEnum("status").notNull(),
    pool: text("pool").$type<WorkerPool>().notNull().default("general"),
    input: jsonb("input").$type<JsonValue>(), // resolved, redacted
    output: jsonb("output").$type<JsonValue>(), // inline ≤ 64 KiB or { "$artifact": id }
    firedPorts: jsonb("fired_ports").$type<PortName[]>().notNull().default([]),
    decision: jsonb("decision").$type<DecisionResult>(),
    decisionKind: text("decision_kind"),
    decisionValue: text("decision_value"),
    decisionConfidence: numeric("decision_confidence", { precision: 6, scale: 5 }),
    decisionProvider: text("decision_provider"),
    error: jsonb("error").$type<ErrorInfo>(),
    usage: jsonb("usage").$type<TokenUsage>(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    latencyMs: integer("latency_ms"),
    queueLatencyMs: integer("queue_latency_ms"),
    idempotencyKey: text("idempotency_key"),
    inputHash: text("input_hash"),
    reusedFromNodeRunId: uuid("reused_from_node_run_id"),
    waitState: jsonb("wait_state").$type<JsonValue>(), // NodeResult.suspend state for task re-entry
    workerId: text("worker_id"),
    scheduledSeq: integer("scheduled_seq").notNull(),
    endedSeq: integer("ended_seq"),
    startedAt: ts("started_at"),
    endedAt: ts("ended_at"),
  },
  (t) => [
    uniqueIndex("node_runs_addr_uq").on(t.runId, t.scope, t.nodeId, t.attempt),
    index("node_runs_run_idx").on(t.runId, t.scheduledSeq),
    index("node_runs_ws_type_idx").on(t.workspaceId, t.nodeType, t.startedAt.desc()),
    index("node_runs_decision_idx")
      .on(t.workspaceId, t.decisionKind, t.decisionConfidence)
      .where(sql`${t.decision} IS NOT NULL`),
    index("node_runs_hash_idx").on(t.runId, t.nodeId, t.scope, t.inputHash),
  ],
);

export const runCheckpoints = pgTable(
  "run_checkpoints",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    state: jsonb("state").$type<JsonObject>().notNull(), // SchedulerState with output refs only
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.seq] })],
);

export const runTimers = pgTable(
  "run_timers",
  {
    // authoritative timers (BullMQ delayed jobs are accelerators)
    id: uuid("id").primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    nodeRunId: uuid("node_run_id"),
    purpose: text("purpose").$type<TimerPurpose>().notNull(),
    fireAt: ts("fire_at").notNull(),
    firedAt: ts("fired_at"),
    cancelledAt: ts("cancelled_at"),
    lockedBy: text("locked_by"),
    lockedUntil: ts("locked_until"),
  },
  (t) => [
    index("run_timers_due_idx")
      .on(t.fireAt)
      .where(sql`${t.firedAt} IS NULL AND ${t.cancelledAt} IS NULL`),
    index("run_timers_run_idx").on(t.runId),
  ],
);

export const humanTasks = pgTable(
  "human_tasks",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    nodeRunId: uuid("node_run_id").notNull(),
    nodeId: text("node_id").notNull(),
    scope: text("scope").notNull().default(""),
    workflowId: uuid("workflow_id").notNull(),
    request: jsonb("request").$type<HumanRequest>().notNull(), // redacted
    status: text("status", { enum: ["open", "responded", "expired", "cancelled"] })
      .notNull()
      .default("open"),
    assignees: jsonb("assignees").$type<string[]>().notNull().default([]),
    response: jsonb("response").$type<HumanResponse>(),
    respondedBy: text("responded_by"),
    respondedAt: ts("responded_at"),
    expiresAt: ts("expires_at"),
    escalatedAt: ts("escalated_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("human_tasks_ws_status_idx").on(t.workspaceId, t.status, t.createdAt.desc()),
    index("human_tasks_run_idx").on(t.runId),
    index("human_tasks_wf_idx").on(t.workflowId, t.status),
  ],
);

export const humanTaskReviewTokens = pgTable(
  "human_task_review_tokens",
  {
    // v1.1: many external review links per task, revocable, single-use on respond
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => humanTasks.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(), // sha256(32-byte base64url token); the token travels in the URL fragment and the Authorization header only
    expiresAt: ts("expires_at").notNull(), // ≤ min(task.expires_at, 7 d)
    createdBy: text("created_by").notNull(),
    usedAt: ts("used_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("human_task_review_tokens_hash_uq").on(t.tokenHash),
    index("human_task_review_tokens_task_idx").on(t.taskId),
  ],
);

export const stateEntries = pgTable(
  "state_entries",
  {
    // ctx.state: durable KV (Working/Conversation/Durable memory nodes)
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    namespace: text("namespace").notNull(), // 'run:<id>' | 'session:<id>' | 'workspace'
    key: text("key").notNull(),
    value: jsonb("value").$type<JsonValue>().notNull(),
    version: integer("version").notNull().default(1),
    expiresAt: ts("expires_at"),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.namespace, t.key] }),
    index("state_entries_expires_idx")
      .on(t.expiresAt)
      .where(sql`${t.expiresAt} IS NOT NULL`),
  ],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "cascade" }),
    nodeRunId: uuid("node_run_id"),
    workflowId: uuid("workflow_id").references(() => workflows.id, { onDelete: "cascade" }), // v1.1: set for kind='export'; download requires workflows:read on it
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    storage: text("storage", { enum: ["s3", "local"] }).notNull(),
    storageKey: text("storage_key").notNull(), // server-generated ws/<workspaceId>/<artifactId>, never derived from `name`
    kind: text("kind", { enum: ["output_overflow", "file", "upload", "log", "export"] }).notNull(), // v1.1: export = code-export zip (expires 24 h)
    status: text("status", { enum: ["pending", "ready"] })
      .notNull()
      .default("ready"), // v1.1: uploads stay pending until POST /v1/artifacts/:id/complete verifies size and sha256
    dataClass: dataClassEnum("data_class").notNull().default("internal"),
    expiresAt: ts("expires_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("artifacts_run_idx").on(t.runId),
    index("artifacts_wf_idx")
      .on(t.workflowId)
      .where(sql`${t.workflowId} IS NOT NULL`),
    index("artifacts_expires_idx")
      .on(t.expiresAt)
      .where(sql`${t.expiresAt} IS NOT NULL`),
  ],
);

export const queueJobs = pgTable(
  "queue_jobs",
  {
    // PgQueueDriver only
    id: text("id").primaryKey(), // deterministic job id (dedupe)
    queue: text("queue").notNull(),
    payload: jsonb("payload").$type<JsonObject>().notNull(), // Job
    priority: integer("priority").notNull().default(0),
    runAt: ts("run_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedBy: text("locked_by"),
    lockedUntil: ts("locked_until"),
    lastError: text("last_error"),
    doneAt: ts("done_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("queue_jobs_ready_idx")
      .on(t.queue, t.priority, t.runAt)
      .where(sql`${t.doneAt} IS NULL`),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    // v1.1: API-initiated background jobs with an artifact result (GET /v1/jobs/:id); the queue entry is separate (queue 'jobs', RFC-0001)
    id: uuid("id").primaryKey(), // uuid v7 = job_id in the 202 response
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["export.package"] }).notNull(),
    status: text("status", { enum: ["queued", "running", "completed", "failed"] })
      .notNull()
      .default("queued"),
    payload: jsonb("payload").$type<JsonObject>().notNull(), // { workflowId, versionId | draftRevision, mode, includeSampleFromRunId?, includeRecordedRunId? }
    artifactId: uuid("artifact_id").references(() => artifacts.id, { onDelete: "set null" }),
    error: jsonb("error").$type<ErrorInfo>(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    startedAt: ts("started_at"),
    endedAt: ts("ended_at"),
    expiresAt: ts("expires_at"),
  },
  (t) => [
    index("jobs_ws_created_idx").on(t.workspaceId, t.createdAt.desc()),
    index("jobs_expires_idx")
      .on(t.expiresAt)
      .where(sql`${t.expiresAt} IS NOT NULL`),
  ],
);

/* ───────────────────────── agents, tools, mcp, models, plugins ───────────────────────── */
export const agents = pgTable(
  "agents",
  {
    // reusable Agent presets referenced by flowaid.ai.agent via config.agentId
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    config: jsonb("config").$type<JsonObject>().notNull(), // { model: ModelRef, system, tools: ToolRef[], bounds, approval }
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("agents_ws_name_uq").on(t.workspaceId, t.name)],
);

export const tools = pgTable(
  "tools",
  {
    // OpenAPI toolsets, workflow-as-tool, code tools
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["openapi", "workflow", "code", "http"] }).notNull(),
    definitions: jsonb("definitions").$type<ToolDefinition[]>().notNull(),
    source: jsonb("source").$type<JsonObject>().notNull().default({}), // openapi: { url | documentArtifactId, serverUrl, specHash }
    credentialId: uuid("credential_id").references(() => credentials.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("tools_ws_name_uq").on(t.workspaceId, t.name)],
);

export const mcpServers = pgTable(
  "mcp_servers",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    transport: text("transport", { enum: ["streamable_http", "sse", "stdio"] }).notNull(),
    url: text("url"),
    command: text("command"),
    args: jsonb("args").$type<string[]>(),
    env: jsonb("env").$type<Record<string, string>>(),
    authKind: text("auth_kind", { enum: ["none", "headers", "oauth2"] })
      .notNull()
      .default("none"),
    credentialId: uuid("credential_id").references(() => credentials.id, { onDelete: "set null" }),
    status: text("status", { enum: ["pending", "connected", "error", "disabled"] })
      .notNull()
      .default("pending"),
    discoveredTools: jsonb("discovered_tools").$type<ToolDefinition[]>().notNull().default([]),
    discoveredResources: jsonb("discovered_resources").$type<JsonValue>().notNull().default([]),
    discoveredPrompts: jsonb("discovered_prompts").$type<JsonValue>().notNull().default([]),
    toolPolicy: jsonb("tool_policy")
      .$type<{ allow: string[]; deny: string[]; approvalRequired: string[] }>()
      .notNull()
      .default({ allow: ["*"], deny: [], approvalRequired: [] }),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]), // W_MCP_TOOL_SUSPICIOUS etc.
    lastError: text("last_error"),
    lastCheckedAt: ts("last_checked_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("mcp_servers_ws_name_uq").on(t.workspaceId, t.name)],
);

export const mcpExposures = pgTable(
  "mcp_exposures",
  {
    // workflows exposed as MCP tools
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    description: text("description").notNull(),
    enabled: boolean("enabled").notNull().default(true), // v1.1: tokens belong to the principal (api_keys rows with scope mcp:serve and workflow_ids pins), not to the exposure
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("mcp_exposures_ws_tool_uq").on(t.workspaceId, t.toolName),
    index("mcp_exposures_wf_env_idx").on(t.workflowId, t.environmentId),
  ],
);

export const models = pgTable(
  "models",
  {
    // workspace overrides / custom endpoints for the ModelCatalog
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    info: jsonb("info").$type<JsonObject>().notNull(), // ModelInfo
    baseUrl: text("base_url"),
    credentialType: text("credential_type"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("models_ws_provider_model_uq").on(t.workspaceId, t.provider, t.model)],
);

export const plugins = pgTable(
  "plugins",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }), // null = global
    packageName: text("package_name").notNull(),
    version: text("version").notNull(),
    source: text("source", { enum: ["npm", "local", "bundled"] }).notNull(), // v1.1: bundled = shipped in the worker image (FLOWAID_BUNDLED_PLUGINS), registered at boot, read-only except status
    integrity: text("integrity"), // npm: registry tarball integrity, verified at load; bundled: package version
    manifests: jsonb("manifests").$type<NodeManifest[]>().notNull(),
    credentialTypes: jsonb("credential_types").$type<JsonValue>().notNull().default([]),
    status: text("status", { enum: ["enabled", "disabled", "error"] })
      .notNull()
      .default("disabled"),
    pool: text("pool").$type<WorkerPool>().notNull().default("general"),
    error: text("error"),
    installedAt: ts("installed_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("plugins_pkg_uq").on(
      sql`coalesce(${t.workspaceId}, '${sql.raw(ZERO_UUID)}'::uuid)`,
      t.packageName,
    ),
  ],
);

/* ───────────────────────── knowledge ───────────────────────── */
export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(), // 'files' | 'url' | 'sitemap' | 'github' | ...
    config: jsonb("config").$type<JsonObject>().notNull(),
    pipeline: jsonb("pipeline").$type<JsonObject>().notNull(), // { chunker, embedding: ModelRef, index: { adapter: 'pgvector', dimensions } }
    credentialId: uuid("credential_id").references(() => credentials.id, { onDelete: "set null" }),
    status: text("status", { enum: ["new", "syncing", "ready", "stale", "error"] })
      .notNull()
      .default("new"),
    stats: jsonb("stats").$type<JsonObject>().notNull().default({}),
    lastSyncAt: ts("last_sync_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("knowledge_sources_ws_name_uq").on(t.workspaceId, t.name)],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    title: text("title"),
    uri: text("uri"),
    mimeType: text("mime_type"),
    contentHash: text("content_hash").notNull(),
    metadata: jsonb("metadata").$type<JsonObject>().notNull().default({}),
    chunkCount: integer("chunk_count").notNull().default(0),
    status: text("status", { enum: ["pending", "indexed", "error", "deleted"] })
      .notNull()
      .default("pending"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("documents_source_external_uq").on(t.sourceId, t.externalId)],
);

export const chunks = pgTable(
  "chunks",
  {
    // pgvector adapter; other adapters store ids only
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    content: text("content").notNull(),
    tokens: integer("tokens").notNull(),
    metadata: jsonb("metadata").$type<JsonObject>().notNull().default({}),
    embedding: vector("embedding"), // dimension per source; sources with ≠1536 dims use chunks_<dim> tables created by the adapter
    tsv: tsvector("tsv"), // generated column (migration): to_tsvector('simple', content)
  },
  (t) => [
    index("chunks_doc_idx").on(t.documentId, t.ordinal),
    index("chunks_source_idx").on(t.sourceId),
    index("chunks_embedding_hnsw").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("chunks_tsv_gin").using("gin", t.tsv),
    index("chunks_meta_gin").using("gin", t.metadata),
  ],
);

/* ───────────────────────── evaluation ───────────────────────── */
export const evaluationSets = pgTable(
  "evaluation_sets",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id").references(() => workflows.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    inputSchema: jsonb("input_schema").$type<JsonSchema>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("evaluation_sets_ws_name_uq").on(t.workspaceId, t.name)],
);

export const evaluationCases = pgTable(
  "evaluation_cases",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    setId: uuid("set_id")
      .notNull()
      .references(() => evaluationSets.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    input: jsonb("input").$type<JsonValue>().notNull(),
    expected: jsonb("expected").$type<JsonObject>().notNull(), // ExpectationSchema
    metadata: jsonb("metadata").$type<JsonObject>().notNull().default({}),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    sourceRunId: uuid("source_run_id"), // "add to evaluation" provenance
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("evaluation_cases_set_idx").on(t.setId, t.ordinal)],
);

export const evaluationRuns = pgTable(
  "evaluation_runs",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    setId: uuid("set_id")
      .notNull()
      .references(() => evaluationSets.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id").notNull(),
    workflowVersionId: uuid("workflow_version_id")
      .notNull()
      .references(() => workflowVersions.id),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environments.id),
    baselineEvaluationRunId: uuid("baseline_evaluation_run_id"),
    status: text("status", { enum: ["queued", "running", "completed", "failed", "cancelled"] })
      .notNull()
      .default("queued"),
    concurrency: integer("concurrency").notNull().default(4),
    total: integer("total").notNull().default(0),
    completed: integer("completed").notNull().default(0),
    summary: jsonb("summary").$type<JsonObject>(), // EvaluationSummary
    report: jsonb("report").$type<JsonObject>(), // RegressionReport
    gate: jsonb("gate").$type<{ minPassRate: number }>(),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    endedAt: ts("ended_at"),
  },
  (t) => [
    index("evaluation_runs_set_idx").on(t.setId, t.createdAt.desc()),
    index("evaluation_runs_version_idx").on(t.workflowVersionId),
  ],
);

export const evaluationResults = pgTable(
  "evaluation_results",
  {
    evaluationRunId: uuid("evaluation_run_id")
      .notNull()
      .references(() => evaluationRuns.id, { onDelete: "cascade" }),
    caseId: uuid("case_id")
      .notNull()
      .references(() => evaluationCases.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    passed: boolean("passed").notNull(),
    checks: jsonb("checks").$type<JsonObject>().notNull(), // per-expectation results
    metrics: jsonb("metrics").$type<JsonObject>().notNull(), // { latencyMs, costUsd, tokens, branches, decisions: { nodeId: { value, confidence } }, humanRequested }
    failures: jsonb("failures").$type<string[]>().notNull().default([]),
  },
  (t) => [primaryKey({ columns: [t.evaluationRunId, t.caseId] })],
);

/* ───────────────────────── triggers & delivery ───────────────────────── */
export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    path: text("path").notNull(), // /hooks/:workspaceSlug/:path
    signature: text("signature", { enum: ["none", "hmac_sha256", "token"] }).notNull(),
    requireTimestamp: boolean("require_timestamp").notNull().default(true), // v1.1: HMAC mode rejects requests without a valid X-Timestamp unless false
    idempotencyHeader: text("idempotency_header"), // v1.1: e.g. X-GitHub-Delivery; null ⇒ sha256(raw body) within 24 h
    secretCredentialId: uuid("secret_credential_id").references(() => credentials.id, {
      onDelete: "set null",
    }),
    responseMode: text("response_mode", { enum: ["sync", "async", "stream"] })
      .notNull()
      .default("async"),
    inputPointer: text("input_pointer").notNull().default("/body"),
    allowedHeaders: jsonb("allowed_headers").$type<string[]>().notNull().default([]),
    callbackUrl: text("callback_url"),
    callbackSecretCredentialId: uuid("callback_secret_credential_id").references(
      () => credentials.id,
      { onDelete: "set null" },
    ),
    enabled: boolean("enabled").notNull().default(true),
    lastReceivedAt: ts("last_received_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("webhooks_ws_path_uq").on(t.workspaceId, t.path)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    // inbound receipts and outbound callback attempts
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    runId: uuid("run_id"),
    direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
    externalId: text("external_id"), // v1.1: delivery id (idempotency_header value) or body hash for inbound dedupe
    status: text("status", {
      enum: ["accepted", "rejected", "delivered", "failed", "pending", "duplicate"],
    }).notNull(),
    attempt: integer("attempt").notNull().default(1),
    httpStatus: integer("http_status"),
    error: text("error"),
    nextAttemptAt: ts("next_attempt_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("webhook_deliveries_hook_idx").on(t.webhookId, t.createdAt.desc()),
    index("webhook_deliveries_pending_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    uniqueIndex("webhook_deliveries_external_uq")
      .on(t.webhookId, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL AND ${t.direction} = 'inbound'`),
  ],
);

export const eventSubscriptions = pgTable(
  "event_subscriptions",
  {
    // v1.1: projection of NODE_WAITING{event} for POST /v1/events/:eventName
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    eventName: text("event_name").notNull(),
    correlationKey: text("correlation_key"), // null = any (RFC-0006 adds wait.until.event.correlation)
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    nodeRunId: uuid("node_run_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.nodeRunId] }),
    index("event_subscriptions_lookup_idx").on(t.workspaceId, t.eventName, t.correlationKey),
  ],
);

export const schedules = pgTable(
  "schedules",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    cron: text("cron").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    input: jsonb("input").$type<JsonValue>().notNull().default({}),
    overlap: text("overlap", { enum: ["skip", "allow"] })
      .notNull()
      .default("skip"),
    catchUp: text("catch_up", { enum: ["skip", "one", "all"] })
      .notNull()
      .default("skip"), // v1.1: missed fires after downtime
    maxCatchUp: integer("max_catch_up").notNull().default(10), // v1.1
    jitterMs: integer("jitter_ms").notNull().default(0), // v1.1
    enabled: boolean("enabled").notNull().default(true),
    nextRunAt: ts("next_run_at"),
    lastRunAt: ts("last_run_at"),
    lastRunId: uuid("last_run_id"),
    lastError: text("last_error"), // v1.1
    lockedBy: text("locked_by"),
    lockedUntil: ts("locked_until"),
    createdAt: createdAt(),
  },
  (t) => [
    index("schedules_due_idx")
      .on(t.nextRunAt)
      .where(sql`${t.enabled}`),
    index("schedules_wf_env_idx").on(t.workflowId, t.environmentId),
  ],
);
// next_run_at is computed by the worker scheduler (croner) in the schedule's timezone; runs are created with idempotency_key 'schedule:<id>:<fireAtIso>'.

export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }), // null = built-in
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    definition: jsonb("definition").$type<WorkflowDefinition>().notNull(),
    requiredSecrets: jsonb("required_secrets").$type<SecretDecl[]>().notNull().default([]),
    requiredResources: jsonb("required_resources")
      .$type<{
        mcpServers: { key: string; description: string; requiredTools: string[] }[];
        knowledgeSources: { key: string; description: string }[];
      }>()
      .notNull()
      .default({ mcpServers: [], knowledgeSources: [] }), // v1.1: sentinels `$template.<kind>.<key>` in `definition` are rewritten on instantiate
    triggers: jsonb("triggers").$type<Trigger[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("templates_scope_slug_uq").on(
      sql`coalesce(${t.workspaceId}, '${sql.raw(ZERO_UUID)}'::uuid)`,
      t.slug,
    ),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    // workspace notification channels (human tasks, alerts)
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["email", "slack_webhook", "webhook"] }).notNull(),
    name: text("name").notNull(),
    config: jsonb("config").$type<JsonObject>().notNull(), // non-secret parts; secret in credentialId
    credentialId: uuid("credential_id").references(() => credentials.id, { onDelete: "set null" }),
    events: jsonb("events")
      .$type<string[]>()
      .notNull()
      .default(["human_task.created", "run.failed", "trace_review.page"]),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_ws_idx").on(t.workspaceId)],
);

/* ───────────────────────── audit ───────────────────────── */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(), // uuid v7
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    actorType: text("actor_type", {
      enum: ["user", "api_key", "review_token", "mcp_token", "webhook", "system"],
    }).notNull(), // v1.1: = Principal.type (API.md §1)
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(), // 'workflow.publish', 'credential.create', 'run.cancel', 'human_task.respond', 'credential.use', 'auth.login', 'auth.login_failed', 'auth.logout', 'auth.logout_all', 'auth.refresh_reuse_detected', 'auth.password_changed', 'api_key.rotate', 'api_key.used_from_new_ip', 'plugin.install', 'mcp_server.stdio_spawn', 'schedule.fired', 'webhook.duplicate', 'webhook.rejected', 'workflow.exported', 'runs.purge' ...  (`details` passes through Redactor.redact() before insert; every non-GET route declares config.audit)
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    details: jsonb("details").$type<JsonObject>().notNull().default({}),
    ip: text("ip"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_ws_at_idx").on(t.workspaceId, t.at.desc()),
    index("audit_resource_idx").on(t.resourceType, t.resourceId),
  ],
);
```

## Projections: how `run_events` drives the other run tables

`PgRunStore.appendEvents(runId, events, { leaseOwner, expectedSeq })` runs in one transaction:

1. `UPDATE runs SET last_seq = last_seq + $n WHERE id = $runId AND lease_owner = $leaseOwner AND last_seq = $expectedSeq RETURNING last_seq` — zero rows ⇒ rollback + `WorkerLostError`.
2. Insert `run_events` rows with `seq = expectedSeq + 1 … + n` (payload redacted by the caller's `Redactor` and `PlanNode.redact`).
3. Apply projections in event order:

| event                                                              | projection                                                                                                                                                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RUN_STARTED`                                                      | `runs.status='starting'`, `started_at`, `lease_owner/lease_until`                                                                                                                        |
| `RUN_WAITING` / `RUN_RESUMED`                                      | `runs.status` = `waiting                                                                                                                                                                 | waiting_for_human                                                                                                          | retrying`/`running` |
| `RUN_CANCEL_REQUESTED`                                             | (flag columns already set by the API)                                                                                                                                                    |
| `RUN_OUTPUT`                                                       | no row change (merged at completion)                                                                                                                                                     |
| `RUN_COMPLETED` / `RUN_FAILED` / `RUN_CANCELLED` / `RUN_TIMED_OUT` | `runs.status`, `output`, `outcome`, `error`, `usage`, `cost_usd`, `ended_at`, `expires_at` (from retention class), `lease_owner = NULL`; open `human_tasks` → `cancelled` on cancel/fail |
| `NODE_SCHEDULED`                                                   | insert `node_runs` (`status='pending'`, `scheduled_seq`, `input_hash`, `idempotency_key`, `reused_from_node_run_id`); `runs.node_run_count += 1`                                         |
| `NODE_STARTED`                                                     | `status='running'`, `started_at`, `input`, `pool`, `worker_id`, `queue_latency_ms`                                                                                                       |
| `NODE_COMPLETED`                                                   | `status='completed'                                                                                                                                                                      | 'reused'`, `output`, `fired_ports`, `usage`, `cost_usd`, `latency_ms`, `ended_at`, `ended_seq`; `runs.usage/cost_usd += …` |
| `NODE_FAILED`                                                      | `status='failed'` (terminal) or unchanged (retry follows), `error`, `fired_ports`, `latency_ms`, `ended_seq` when terminal                                                               |
| `NODE_RETRIED`                                                     | `status='retry_wait'`; insert `run_timers` (purpose `retry`)                                                                                                                             |
| `NODE_SKIPPED` / `NODE_CANCELLED`                                  | `status='skipped'                                                                                                                                                                        | 'cancelled'`, `ended_at`, `ended_seq`                                                                                      |
| `NODE_WAITING`                                                     | `status='waiting'`, `wait_state`                                                                                                                                                         |
| `DECISION_COMPLETED`                                               | `decision`, `decision_kind`, `decision_value`, `decision_confidence`, `decision_provider`                                                                                                |
| `GENERATION_COMPLETED` / `TOOL_RETURNED`                           | usage/cost roll-up into `node_runs`                                                                                                                                                      |
| `TIMER_SET` / `TIMER_FIRED`                                        | insert `run_timers` / `fired_at`                                                                                                                                                         |
| `HUMAN_APPROVAL_REQUESTED`                                         | insert `human_tasks` (`status='open'`)                                                                                                                                                   |
| `HUMAN_APPROVAL_RECEIVED`                                          | (row already `responded` via CAS by the API)                                                                                                                                             |
| `HUMAN_TASK_ESCALATED` / `HUMAN_TASK_EXPIRED`                      | `assignees`/`escalated_at` / `status='expired'`                                                                                                                                          |
| `CHECKPOINT_CREATED`                                               | (checkpoint row written by the orchestrator in the same transaction)                                                                                                                     |

4. `NOTIFY run_events, '{"runId":…,"fromSeq":…,"toSeq":…}'` (payload ≤ 8 KB, ids only).

`flowaid db reproject <runId>` truncates the run's projections and replays its events through the same `applyProjection`; the integration suite asserts `project(events) ≡ rows` after every golden scenario.

## Retention

| Data class / table                                           | Default                                                                     | Mechanism                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runs` (`retention_class`)                                   | `standard` 90 d, `short` 7 d, `long` 400 d, `none` = purge on completion    | `expires_at` computed at completion; nightly `retention.sweep` deletes `run_events`, `node_runs`, `run_checkpoints`, `run_timers`, `human_tasks`, `artifacts` (+ S3 objects) for expired runs and **keeps the `runs` row** with I/O nulled and metrics columns intact for 400 d |
| `node_runs.input/output` with `x-dataClass: pii`/`sensitive` | 7 d (unless `workspaces.settings.privacy.persistPII`)                       | columns nulled by the sweep, `decision_*`/usage/latency kept                                                                                                                                                                                                                    |
| `run_events` partitions                                      | dropped when older than the workspace's max retention (partitioned mode)    | `DROP TABLE run_events_YYYY_MM`                                                                                                                                                                                                                                                 |
| `run_checkpoints`                                            | last 2 per run while active; final one for the run's retention              | sweep                                                                                                                                                                                                                                                                           |
| `human_tasks.request` context                                | responded + 30 d                                                            | context nulled                                                                                                                                                                                                                                                                  |
| `workflow_versions` (`kind='draft'`)                         | 7 d when unreferenced by any run                                            | sweep                                                                                                                                                                                                                                                                           |
| `webhook_deliveries`                                         | 30 d                                                                        | sweep                                                                                                                                                                                                                                                                           |
| `state_entries`                                              | `expires_at` (session TTL default 24 h; run namespace deleted with the run) | sweep                                                                                                                                                                                                                                                                           |
| `audit_events`                                               | 400 d (configurable, never below 90 d)                                      | yearly partitions dropped                                                                                                                                                                                                                                                       |
| `evaluation_results`                                         | with their evaluation run                                                   | cascade                                                                                                                                                                                                                                                                         |
| `doNotPersist` outputs                                       | never written                                                               | `{ "$redacted": true }` stub                                                                                                                                                                                                                                                    |
| `runs.idempotency_key`                                       | 24 h                                                                        | nulled by the sweep so `runs_idem_uq` matches the API's 24 h window (v1.1)                                                                                                                                                                                                      |
| `jobs` (+ `artifacts.kind='export'`)                         | 7 d (the export zip itself 24 h)                                            | sweep; artifact cascade (v1.1)                                                                                                                                                                                                                                                  |
| `user_tokens`, `human_task_review_tokens`                    | 7 d after expiry                                                            | sweep (v1.1)                                                                                                                                                                                                                                                                    |
| `event_subscriptions`                                        | with the run                                                                | cascade (v1.1)                                                                                                                                                                                                                                                                  |

The sweep is the `retention.sweep` job on the `maintenance` queue (`RETENTION_SWEEP_CRON`, default `0 3 * * *`; RFC-0001), together with `partition.ensure` and `draft_versions.gc`.

Workspace deletion cascades everything through foreign keys; S3 objects are removed by prefix `ws/<workspaceId>/`.

## Migration set for the first slice

`0001_init.sql` (all tables, enums, indexes), `0002_rls.sql` (`ENABLE` + `FORCE` RLS policies, roles and grants; policies active when `DB_RLS=true`, the compose default), `0003_partition_run_events.sql` (conditional), `0004_chunks_generated_tsv.sql` (generated column + pgvector extension), seeds: `seed_environments.sql` is applied per workspace by the API on workspace creation (`dev`, `staging`, `prod` with `prod.protected = true`), `seed_templates.ts` loads the three demo templates with their `required_resources`. First boot (`apps/api` bootstrap): owner user, default workspace `default`, environments, templates (ARCHITECTURE.md §8).
