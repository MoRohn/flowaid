/** What the runner needs from a run, and what it reports. */
import type {
  DecisionResult,
  HumanResponse,
  JsonValue,
  NodeId,
  RunStatus,
} from "@flowaid/workflow-core";

/** One node of a finished run, as read from `node_runs` (the last attempt per node). */
export interface NodeRecord {
  nodeId: NodeId;
  status:
    | "completed"
    | "failed"
    | "skipped"
    | "cancelled"
    | "waiting"
    | "reused"
    | "running"
    | "pending"
    | "retry_wait";
  /** the control port it fired (branch/gate/router/decision routes) */
  firedPort?: string | null;
  decision?: DecisionResult | null;
  /** an output schema mismatch on this node */
  schemaError?: boolean;
}

export interface ToolCallRecord {
  name: string;
  ok: boolean;
}

/** A finished (or stopped) run, as the launcher reports it. */
export interface RunRecord {
  runId: string;
  status: RunStatus;
  outcome: string | null;
  output: JsonValue;
  latencyMs: number;
  costUsd: number;
  tokens?: number;
  nodes: NodeRecord[];
  tools: ToolCallRecord[];
  humanRequested: boolean;
  error?: { code: string; message: string } | null;
}

export interface LaunchRequest {
  caseId: string;
  input: JsonValue;
  /** `{ evaluationRunId, caseId }` */
  labels: Record<string, string>;
  /** auto-responses for human nodes (default approve) */
  human: Record<NodeId, HumanResponse>;
  signal: AbortSignal;
}

/** Starts one run with `origin: 'evaluation'` and resolves when it is terminal. */
export interface RunLauncher {
  launch(req: LaunchRequest): Promise<RunRecord>;
}

export type CheckKind =
  | "output"
  | "decision"
  | "branch"
  | "node"
  | "tool"
  | "status"
  | "outcome"
  | "latency"
  | "cost"
  | "human"
  | "run";

export interface CheckResult {
  kind: CheckKind;
  /** stable id within the case, e.g. `output:/answer:equals`, `decision:intent` */
  id: string;
  passed: boolean;
  expected?: JsonValue;
  actual?: JsonValue;
  message?: string;
}

export interface CaseMetrics {
  latencyMs: number;
  /** the workflow run's own cost (what `maxCostUsd` and the regression report compare) */
  costUsd: number;
  /** what the case's judge checks cost; absent on results scored before judges were priced */
  judgeCostUsd?: number;
  tokens: number;
  branches: Record<NodeId, string | null>;
  decisions: Record<NodeId, { value: JsonValue; confidence: number }>;
  humanRequested: boolean;
  toolCalls: { total: number; ok: number };
  /** nodes whose output did not match their schema */
  schemaErrors: number;
}

export interface CaseResult {
  caseId: string;
  runId: string | null;
  passed: boolean;
  checks: CheckResult[];
  failures: string[];
  metrics: CaseMetrics;
  status: RunStatus | "launch_failed";
}

export interface CalibrationBin {
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
  /** decision expectations met, per node */
  accuracy: Record<NodeId, number>;
  calibration: Record<NodeId, { ece: number; bins: CalibrationBin[] }>;
  branchCorrectness: number;
  schemaSuccess: number;
  toolSuccess: number;
  humanReviewRate: number;
  latency: { p50: number; p95: number; p99: number };
  /**
   * `total` is everything the evaluation spent (runs and judge checks); `perCase` is the
   * workflow's run cost per case; `judge` is the judge checks' share of `total`.
   */
  costUsd: { total: number; perCase: number; judge: number };
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
  /** `W_REGRESSION` when the pass rate drops significantly (McNemar, see compare.ts), p95 latency +30 %, or cost +20 % */
  warnings: { code: "W_REGRESSION"; message: string }[];
}
