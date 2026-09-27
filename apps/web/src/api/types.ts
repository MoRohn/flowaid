/** Response shapes the web app reads (API.md; the generated SDK types replace these as they land). */
import type {
  Diagnostic,
  ExecutionPlan,
  HumanRequest,
  HumanResponse,
  RunStatus,
  WorkflowDefinition,
} from "@flowaid/workflow-core";

export type Role = "owner" | "admin" | "editor" | "operator" | "viewer";

export interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
  role: Role;
}
export interface Me {
  principal: {
    type: string;
    id: string;
    workspaceId: string | null;
    workspaceSlug: string | null;
    role: Role | null;
    scopes: string[];
    environmentId: string | null;
    workflowIds: string[] | null;
  };
  user: { id: string; email: string; name: string; status: string } | null;
  workspaces: WorkspaceSummary[];
  features: Record<string, boolean>;
}
export interface Environment {
  id: string;
  name: string;
  protected: boolean;
  variables?: Record<string, unknown>;
  createdAt?: string;
}
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}
export interface Diag {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  nodeId?: string;
  location?: Diagnostic["location"];
  [k: string]: unknown;
}
export interface WorkflowSummary {
  id: string;
  name: string;
  slug: string;
  description: string;
  tags: string[];
  draftRevision: number;
  latestVersionId: string | null;
  latestVersion: number | null;
  archived: boolean;
  errors: number;
  warnings: number;
  updatedAt: string;
}
export interface Deployment {
  id: string;
  environmentId: string;
  environment: string;
  versionId: string;
  version: number | null;
  previousVersionId: string | null;
  variableOverrides: Record<string, unknown>;
  deployedAt: string;
  deployedBy: string | null;
}
export interface WorkflowDetail extends WorkflowSummary {
  draft: WorkflowDefinition;
  draftDiagnostics: Diag[];
  evaluationSetId: string | null;
  deployments: Deployment[];
  createdAt: string;
}
export interface VersionSummary {
  id: string;
  workflowId: string;
  kind: "published" | "draft";
  version: number | null;
  label: string | null;
  definitionHash: string;
  planHash: string;
  compilerVersion: string;
  notes: string | null;
  publishedBy: string | null;
  createdAt: string;
}
export interface VersionDetail extends VersionSummary {
  definition: WorkflowDefinition;
  plan?: ExecutionPlan;
  diagnostics: Diag[];
}
export interface Run {
  id: string;
  workspaceId: string;
  workflowId: string;
  workflowVersionId: string;
  environmentId: string;
  status: RunStatus;
  origin: string;
  mode: string;
  input: unknown;
  output: unknown;
  outcome: string | null;
  error: { code: string; message: string; nodeId?: string; retryable?: boolean } | null;
  parentRunId: string | null;
  sourceRunId: string | null;
  sessionId: string | null;
  labels: Record<string, string>;
  lastSeq: number;
  usage: { inputTokens?: number; outputTokens?: number } | null;
  costUsd: number;
  nodeRunCount: number;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}
export interface HumanTask {
  id: string;
  runId: string;
  nodeRunId: string;
  nodeId: string;
  scope: string;
  workflowId: string;
  request: HumanRequest;
  status: "open" | "responded" | "expired" | "cancelled";
  assignees: string[];
  response: HumanResponse | null;
  respondedBy: string | null;
  respondedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}
export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  environmentId: string | null;
  workflowIds: string[] | null;
  serviceAccount: boolean;
  rateLimitPerMin: number | null;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
export interface Member {
  userId: string;
  email: string;
  name: string;
  role: Role;
  status: string;
  joinedAt: string;
}

/** `GET /v1/workflows?include=activity` */
export interface WorkflowWithActivity extends WorkflowSummary {
  deployments: { environmentId: string; version: number | null }[];
  runs24h: number[];
  lastRun: { id: string; status: RunStatus; createdAt: string } | null;
}
