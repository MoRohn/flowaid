/** Response shapes of the run-side routes (apps/api/src/routes/{runs,review,evaluations}.ts). */
import type {
  ExecutionPlan,
  HumanRequest,
  HumanResponse,
  NodeManifest,
  NodeRun,
  WorkflowDefinition,
} from "@flowaid/workflow-core";
import type { HumanTask, Run, VersionSummary } from "~/api/types";

/** `GET /v1/runs/:id?include=node_runs` */
export interface RunDetail extends Run {
  node_runs: NodeRun[];
}

/** `GET /v1/runs/:id/events` */
export interface EventPage {
  items: unknown[];
  next_cursor: string | null;
}

/** `GET /v1/workflow-versions/:id` */
export interface VersionDetail extends VersionSummary {
  definition: WorkflowDefinition;
  plan?: ExecutionPlan;
}

/** `GET /v1/human-tasks/:id` */
export interface HumanTaskDetail {
  task: HumanTask;
  run: { id: string; status: Run["status"]; workflowId: string } | undefined;
  node: { id: string };
  request: HumanRequest;
}

/** `POST /v1/human-tasks/:id/review-link` */
export interface ReviewLink {
  id: string;
  url: string;
  expiresAt: string;
}

/** `GET /v1/human-tasks/:id/review-links`: a link's metadata, never its token. */
export interface ReviewLinkInfo {
  id: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdBy: string;
  status: "active" | "used" | "revoked" | "expired";
}

/** `GET /v1/review`: what an external reviewer may see, nothing more. */
export interface ExternalReviewView {
  title: string;
  mode: HumanRequest["mode"];
  context: Record<string, unknown>;
  expiresAt: string;
  workflowName: string;
}

export interface EvaluationSetSummary {
  id: string;
  name: string;
  workflowId: string | null;
}

export type Catalog = ReadonlyMap<string, NodeManifest>;

export type { HumanResponse, NodeRun };
