/**
 * The closed enums the UI shares with the runtime. Every option list comes
 * straight from the `@flowaid/workflow-core` Zod schemas (CONTRACTS.ts §8,
 * §10), so a status or origin the runtime can emit is never unknown to a
 * component; only the human labels live here. `categories.test.ts` asserts
 * that each label map covers its schema's options exactly.
 *
 * Category hues are CSS variables (`--cat-<category>`); keep them in sync
 * with /brand/tokens.css.
 */
import {
  NodeCategorySchema,
  NodeRunStatusSchema,
  RunOriginSchema,
  RunStatusSchema,
  type NodeCategory,
  type NodeRunStatus,
  type RunOrigin,
  type RunStatus,
} from "@flowaid/workflow-core";

export type { NodeCategory, NodeRunStatus, RunOrigin, RunStatus };

/** Node categories, in catalog order. */
export const NODE_CATEGORIES: readonly NodeCategory[] = NodeCategorySchema.options;
/** Run lifecycle statuses. */
export const RUN_STATUSES: readonly RunStatus[] = RunStatusSchema.options;
/** Node-run (attempt) lifecycle statuses. */
export const NODE_RUN_STATUSES: readonly NodeRunStatus[] = NodeRunStatusSchema.options;
/** What can start a run. */
export const RUN_ORIGINS: readonly RunOrigin[] = RunOriginSchema.options;

export const CATEGORY_LABEL: Record<NodeCategory, string> = {
  flow: "Flow",
  decision: "Decision",
  generation: "Generation",
  agent: "Agent",
  tool: "Tool",
  data: "Data",
  retrieval: "Retrieval",
  state: "State",
  human: "Human",
  safety: "Safety",
  developer: "Developer",
};

/** CSS variable for a category's hue, e.g. `var(--cat-decision)`. */
export function categoryVar(category: NodeCategory): string {
  return `var(--cat-${category})`;
}

/** Labels for run statuses. */
export const STATUS_LABEL: Record<RunStatus, string> = {
  queued: "Queued",
  starting: "Starting",
  running: "Running",
  waiting: "Waiting",
  waiting_for_human: "Waiting for approval",
  retrying: "Retrying",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  timed_out: "Timed out",
};

/** Labels for node-run statuses. */
export const NODE_RUN_STATUS_LABEL: Record<NodeRunStatus, string> = {
  pending: "Pending",
  running: "Running",
  waiting: "Waiting",
  retry_wait: "Retry wait",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
  cancelled: "Cancelled",
  reused: "Reused",
};

/** Labels for run origins. */
export const ORIGIN_LABEL: Record<RunOrigin, string> = {
  api: "API",
  ui: "Manual",
  webhook: "Webhook",
  schedule: "Schedule",
  mcp: "MCP",
  evaluation: "Evaluation",
  subflow: "Subflow",
  replay: "Replay",
  restart: "Restart",
  fork: "Fork",
};

/** Run statuses after which a run never changes again. */
export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);

/** Node-run statuses that end an attempt. */
export const TERMINAL_NODE_RUN_STATUSES: ReadonlySet<NodeRunStatus> = new Set<NodeRunStatus>([
  "completed",
  "failed",
  "skipped",
  "cancelled",
  "reused",
]);

export function isRunStatus(value: string): value is RunStatus {
  return (RUN_STATUSES as readonly string[]).includes(value);
}

export function isNodeRunStatus(value: string): value is NodeRunStatus {
  return (NODE_RUN_STATUSES as readonly string[]).includes(value);
}

export function isRunOrigin(value: string): value is RunOrigin {
  return (RUN_ORIGINS as readonly string[]).includes(value);
}

export function isNodeCategory(value: string): value is NodeCategory {
  return (NODE_CATEGORIES as readonly string[]).includes(value);
}
