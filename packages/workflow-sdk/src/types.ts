/**
 * Wire shapes the SDK works with directly (API.md §4, §7). Where the OpenAPI document declares a
 * response these match the generated types; the run record itself is declared here because its
 * route returns the stored run as is.
 */
import type {
  HumanRequest,
  HumanResponse,
  JsonValue,
  RunStatus,
  TokenUsage,
} from "@flowaid/workflow-core";

export type { HumanResponse, RunStatus };

export interface RunRequest {
  input?: JsonValue;
  mode?: "sync" | "async";
  environmentId?: string;
  versionId?: string;
  draft?: boolean;
  sessionId?: string;
  variables?: Record<string, JsonValue>;
  labels?: Record<string, string>;
  /** sync only (1000–300000, default 60000) */
  waitTimeoutMs?: number;
}

export interface RunAccepted {
  run_id: string;
  status: RunStatus;
  links: { self: string; stream: string; output: string };
  human_task?: { id: string; url: string };
}

export interface RunCompleted {
  run_id: string;
  status: "completed";
  output: JsonValue;
  outcome: string | null;
  usage: TokenUsage;
  cost_usd: number;
  duration_ms: number;
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
  input: JsonValue;
  output: JsonValue | null;
  outcome: string | null;
  error: { code: string; message: string; nodeId?: string; [k: string]: unknown } | null;
  parentRunId: string | null;
  sourceRunId: string | null;
  sessionId: string | null;
  labels: Record<string, string>;
  lastSeq: number;
  usage: TokenUsage | null;
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

/** A published version as `GET /v1/workflows/:id/versions` lists it. */
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

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);
