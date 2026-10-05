/** Response shapes of the management surfaces (API.md §3; checked against apps/api/src/routes). */
import type { JsonValue } from "@flowaid/workflow-core";
import type { Role } from "~/api/types";

export interface CredentialField {
  name: string;
  secret: boolean;
  required: boolean;
  schema: { type?: string; format?: string; description?: string; enum?: string[] } & Record<
    string,
    unknown
  >;
}
export interface CredentialType {
  id: string;
  name: string;
  description: string;
  fields: CredentialField[];
  scopes: string[];
  testSupported: boolean;
}
export interface Credential {
  id: string;
  name: string;
  type: string;
  storage: "db" | "external";
  externalRef: string | null;
  publicFields: Record<string, string>;
  hints: Record<string, string>;
  scopes: string[];
  environmentId: string | null;
  allowedWorkflowIds: string[] | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastUsedAt: string | null;
  rotatedAt: string | null;
  createdAt: string;
  /** a webhook's or notification channel's generated secret (never listed; managed there) */
  owner?: { kind: "webhook" | "notification"; id: string; name: string } | null;
}
/** One thing that refers to a credential (`GET /v1/credentials/:id/uses`). */
export interface CredentialUse {
  kind:
    "workflow_secret" | "toolset" | "mcp_server" | "knowledge_source" | "webhook" | "notification";
  /** the workflow (workflow_secret) or the resource that uses it */
  id: string;
  name: string;
  environmentId: string | null;
  secretName: string | null;
  workflowId: string | null;
}

export interface McpServer {
  id: string;
  name: string;
  transport: "streamable_http" | "sse" | "stdio";
  url: string | null;
  command: string | null;
  args: string[] | null;
  authKind: "none" | "headers" | "oauth2";
  credentialId: string | null;
  status: string;
  toolPolicy: { allow: string[]; deny: string[]; approvalRequired: string[] } | null;
  toolCount: number;
  warnings: unknown[];
  lastError: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
}
export interface McpDiscovery {
  tools: { name: string; description?: string }[];
  excluded?: unknown[];
  resources?: unknown[];
  prompts?: unknown[];
  warnings?: unknown[];
  server?: unknown;
}
export interface McpExposure {
  id: string;
  workflowId: string;
  environmentId: string;
  toolName: string;
  description: string;
  /** the owner's switch; deploys leave a manual exposure's switch alone */
  enabled: boolean;
  /** manual: made in Triggers → MCP tools; trigger: declared by a deployed version */
  source?: "manual" | "trigger";
  /** a version of the workflow is deployed to the exposure's environment */
  deployed?: boolean;
  /** clients see the tool now (enabled and deployed) */
  active?: boolean;
  url: string;
}
export interface Tool {
  id: string;
  name: string;
  kind: string;
  definitions: { name: string; description?: string }[];
  source: unknown;
  credentialId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface OpenApiPreview {
  title: string;
  version: string;
  servers: string[];
  authSchemes: Record<string, unknown>;
  warnings: unknown[];
  operations: {
    name: string;
    method?: string;
    path?: string;
    summary?: string;
    idempotency?: string;
    capability?: string;
  }[];
}
export interface Provider {
  id: string;
  models: number;
  configuredOnServer: boolean;
}
export interface ModelInfo {
  provider: string;
  model: string;
  aliases?: string[];
  kind: "decision" | "chat" | "embedding" | "rerank";
  contextTokens?: number;
  maxOutputTokens?: number;
  pricing?: { inputPerMTok?: number; outputPerMTok?: number };
  deprecated?: boolean;
}

export interface CreatedKey {
  id: string;
  prefix: string;
  key: string;
  expiresAt: string;
}
export interface Workspace {
  id: string;
  slug: string;
  name: string;
  settings: Record<string, unknown>;
  createdAt: string;
}
/** `GET /v1/workspaces/:id/budget`: this calendar month's (UTC) run spend against the budget. */
export interface WorkspaceBudget {
  month: string;
  spentUsd: number;
  monthlyCostUsd: number | null;
  reached: boolean;
}
export interface WorkspaceSettings {
  retention?: { runsDays?: number; auditDays?: number; artifactsDays?: number };
  maxQueuedRuns?: number;
  budgets?: { monthlyCostUsd?: number };
  [k: string]: unknown;
}
export interface MemberRow {
  userId: string;
  email: string;
  name: string;
  role: Role;
  status: string;
  joinedAt: string;
}
export interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  current: boolean;
}
export interface AuditEvent {
  id: string;
  at: string;
  actorType: string;
  actorId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface Webhook {
  id: string;
  workflowId: string;
  environmentId: string;
  path: string;
  url: string;
  signature: string;
  requireTimestamp: boolean;
  idempotencyHeader: string | null;
  secretBound: boolean;
  responseMode: string;
  enabled: boolean;
  lastReceivedAt: string | null;
  createdAt: string;
}
export interface Schedule {
  id: string;
  workflowId: string;
  environmentId: string;
  cron: string;
  timezone: string;
  overlap: "skip" | "allow";
  catchUp: "skip" | "one" | "all";
  maxCatchUp: number;
  jitterMs: number;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunId: string | null;
  lastError: string | null;
}
export interface WebhookDelivery {
  id: string;
  webhookId: string;
  runId: string | null;
  direction: "inbound" | "outbound";
  externalId: string | null;
  status: "accepted" | "rejected" | "delivered" | "failed" | "pending" | "duplicate";
  attempt: number;
  httpStatus: number | null;
  error: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
}

export type NotificationEvent =
  | "human_task.created"
  | "run.failed"
  | "trace_review.page"
  | "schedule.failed"
  | "webhook.rejected"
  | "budget.warning"
  | "budget.exceeded";

export interface NotificationChannel {
  id: string;
  kind: "email" | "slack_webhook" | "webhook";
  name: string;
  config: { to?: string[]; url?: string };
  events: NotificationEvent[];
  enabled: boolean;
  secretSet: boolean;
  createdAt: string;
}

export interface DeployResult {
  triggers: {
    webhooks: { id: string; path: string; url: string; signature: string; secretBound: boolean }[];
    schedules: { id: string; cron: string; timezone: string; nextRunAt: string | null }[];
    mcpExposures: { id: string; toolName: string }[];
    disabled: { kind: string; id: string }[];
  };
}

export interface TemplateRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  builtIn: boolean;
  requiredResources: {
    mcpServers?: { key: string; description?: string; requiredTools?: string[] }[];
    knowledgeSources?: { key: string; description?: string }[];
  } | null;
  requiredSecrets: { name: string; credentialType?: string; required?: boolean }[] | null;
  graph?: {
    nodes: { id: string; kind: string; type: string | null; name: string }[];
    edges: { source: string; target: string }[];
  };
}

export interface EvaluationSet {
  id: string;
  workflowId: string | null;
  name: string;
  description: string;
  inputSchema: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}
export interface EvaluationCase {
  id: string;
  setId: string;
  ordinal: number;
  input: JsonValue;
  expected: Record<string, unknown>;
  metadata: Record<string, unknown>;
  tags: string[];
  sourceRunId: string | null;
  createdAt: string;
}
export interface CalibrationBinRow {
  lo: number;
  hi: number;
  count: number;
  accuracy: number;
  confidence: number;
}
export interface EvaluationSummary {
  cases: number;
  passed: number;
  passRate: number;
  completionRate: number;
  accuracy: Record<string, number>;
  calibration: Record<string, { ece: number; bins: CalibrationBinRow[] }>;
  branchCorrectness: number;
  schemaSuccess: number;
  toolSuccess: number;
  humanReviewRate: number;
  latency: { p50: number; p95: number; p99: number };
  /** `judge` (judge checks' share of `total`) is absent on reports from older releases */
  costUsd: { total: number; perCase: number; judge?: number };
}
export interface RegressionReport {
  versionId: string;
  baselineVersionId: string | null;
  summary: EvaluationSummary;
  baseline: EvaluationSummary | null;
  deltas: Partial<Record<keyof EvaluationSummary, number>>;
  flips: { caseId: string; field: string; before: JsonValue; after: JsonValue }[];
  verdict: "pass" | "fail";
  gate: { minPassRate: number } | null;
  warnings: { code: string; message: string }[];
}
export interface EvaluationRun {
  id: string;
  setId: string;
  workflowId: string;
  workflowVersionId: string | null;
  environmentId: string | null;
  baselineEvaluationRunId: string | null;
  status: string;
  concurrency: number;
  total: number;
  completed: number;
  summary: EvaluationSummary | null;
  report: RegressionReport | null;
  gate: { minPassRate: number } | null;
  createdAt: string;
  endedAt: string | null;
}
export interface CaseResultRow {
  caseId: string;
  runId: string | null;
  passed: boolean;
  checks: {
    id: string;
    kind: string;
    passed: boolean;
    message?: string;
    expected?: JsonValue;
    actual?: JsonValue;
  }[];
  failures: string[];
  metrics: {
    latencyMs: number;
    costUsd: number;
    tokens: number;
    branches: Record<string, string | null>;
    decisions: Record<string, { value: JsonValue; confidence: number }>;
    humanRequested: boolean;
  } | null;
  status: string;
}
