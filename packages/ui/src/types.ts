/**
 * Types shared by every @flowaid/ui group.
 *
 * Components take the runtime contracts from `@flowaid/workflow-core`
 * directly wherever the shape is plain JSON (`DecisionResult`, `HumanRequest`
 * / `HumanResponse`, `RunEvent`, `Diagnostic`, `NodeRun`, `TokenUsage`,
 * `ProviderAttempt`, `ErrorInfo`). The view types that remain here exist only
 * for the joins the API does not return in one object (a run's workflow name,
 * an environment's name, a node run's category) and for the canvas
 * projection. `lib/adapters.ts` builds them from the contracts.
 */
import type {
  BooleanDecision,
  ChoiceDecision,
  DataDependency,
  DecisionKind,
  DecisionResult,
  Diagnostic,
  DiagnosticCode,
  ErrorInfo,
  HumanRequest,
  HumanResponse,
  JsonPatch,
  JsonPatchOp,
  JsonSchema as ContractJsonSchema,
  JsonValue,
  NodeCategory,
  NodeId,
  NodeKind,
  NodeManifest,
  NodeRun,
  NodeRunStatus,
  NodeTypeId,
  PortName,
  ProviderAttempt,
  Run,
  RunEvent,
  RunEventOf,
  RunEventType,
  RunOrigin,
  RunStatus,
  ScoreDecision,
  ScopePath,
  TokenUsage,
  UiHints,
  WorkflowNode,
} from "@flowaid/workflow-core";

export type {
  BooleanDecision,
  ChoiceDecision,
  ContractJsonSchema,
  DataDependency,
  DecisionKind,
  DecisionResult,
  Diagnostic,
  DiagnosticCode,
  ErrorInfo,
  HumanRequest,
  HumanResponse,
  JsonPatch,
  JsonPatchOp,
  JsonValue,
  NodeCategory,
  NodeId,
  NodeKind,
  NodeManifest,
  NodeRun,
  NodeRunStatus,
  NodeTypeId,
  PortName,
  ProviderAttempt,
  Run,
  RunEvent,
  RunEventOf,
  RunEventType,
  RunOrigin,
  RunStatus,
  ScopePath,
  ScoreDecision,
  TokenUsage,
  UiHints,
  WorkflowNode,
};

/** Severity of a compiler diagnostic. */
export type DiagnosticSeverity = Diagnostic["severity"];

// ---------------------------------------------------------------------------
// Confidence gate
// ---------------------------------------------------------------------------

/**
 * The gate as the runtime configures it (ARCHITECTURE.md §6.3): `pass` iff
 * `confidence ≥ threshold`; with a `reviewBand`, `[threshold − reviewBand,
 * threshold)` goes to `review` and everything below to `fail`; without one the
 * gate is two-way (`pass` / `review`). `requireValue` additionally routes a
 * boolean decision whose value is false away from `pass`.
 */
export interface GateConfig {
  threshold: number;
  reviewBand?: number;
  requireValue?: boolean;
}

/**
 * The UI's two-threshold model of the same gate: `auto := threshold`,
 * `review := threshold − (reviewBand ?? threshold)`. At or above `auto` →
 * pass; at or above `review` → review; below → fail. A `review` of 0 is the
 * two-way gate (nothing fails).
 */
export interface ConfidenceThresholds {
  review: number;
  auto: number;
}

/** Control-out of the confidence gate. */
export type GateOutcome = "pass" | "review" | "fail";

export function gateOutcome(confidence: number, t: ConfidenceThresholds): GateOutcome {
  if (confidence >= t.auto) return "pass";
  if (confidence >= t.review) return "review";
  return "fail";
}

/** Drops float noise from threshold arithmetic (0.9 − 0.2 is 0.7000000000000001) so the editor round-trips typed values. */
function roundThreshold(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

/**
 * `auto := threshold`, `review := threshold − (reviewBand ?? threshold)`, with the
 * floor clamped to [0, threshold]. Without a `reviewBand` the review floor is 0: the two-way gate.
 */
export function thresholdsFromGate(config: GateConfig): ConfidenceThresholds {
  const auto = config.threshold;
  const review = roundThreshold(auto - (config.reviewBand ?? auto));
  return { review: Math.min(auto, Math.max(0, review)), auto };
}

/**
 * Inverse of {@link thresholdsFromGate}: `threshold := auto`, `reviewBand := auto − review`;
 * a review floor of 0 is the two-way gate (no `reviewBand`).
 */
export function gateFromThresholds(t: ConfidenceThresholds, requireValue?: boolean): GateConfig {
  const config: GateConfig = { threshold: t.auto };
  if (t.review > 0) config.reviewBand = Math.max(0, roundThreshold(t.auto - t.review));
  if (requireValue !== undefined) config.requireValue = requireValue;
  return config;
}

/**
 * The runtime rule for a decision, verbatim from ARCHITECTURE.md §6.3: `pass`
 * iff `confidence ≥ threshold` and (`requireValue` is off or the decision is a
 * boolean `true`); otherwise `fail` iff a `reviewBand` is set and either
 * `confidence < threshold − reviewBand` or the `requireValue` check failed;
 * otherwise `review`.
 */
export function gateOutcomeForDecision(
  decision: Pick<DecisionResult, "kind" | "value" | "confidence">,
  config: GateConfig,
): GateOutcome {
  const valueOk = !config.requireValue || (decision.kind === "boolean" && decision.value === true);
  if (decision.confidence >= config.threshold && valueOk) return "pass";
  if (config.reviewBand === undefined) return "review";
  if (!valueOk) return "fail";
  return decision.confidence < config.threshold - config.reviewBand ? "fail" : "review";
}

// ---------------------------------------------------------------------------
// Workflow graph (as the canvas sees it)
// ---------------------------------------------------------------------------

export interface PortView {
  /** Port name (`PortName`: snake_case); the handle id is `in:<id>` / `out:<id>` (`handleId`). */
  id: string;
  label: string;
  /** Short type label shown on the handle: a JSON Schema `type` or a named type such as "decision", "message", "any". */
  type: string;
  /**
   * The port's JSON Schema (manifest `PortSpec.schema`, or the plan's resolved port schema). Connection
   * validation runs `isSubschema(source.schema, target.schema)` on it; a port without one is unconstrained
   * (`{}`, or `{ type }` when `type` names a JSON Schema primitive), so connections to it are unverified.
   */
  schema?: ContractJsonSchema;
  required?: boolean;
  description?: string;
}

/** A named control-out (`ctl:<id>`): branch cases, gate outcomes, router options, human outcomes, `done`, `failed`, … */
export interface ControlPortView {
  /** Control port name (`PortName`); the handle id is `ctl:<id>`. */
  id: string;
  label: string;
  /** Expression or rule shown after the label. */
  condition?: string;
}

/**
 * A workflow node as the canvas projects it (UI.md §4.2). `kind` is the CONTRACTS `NodeKind` and
 * `nodeType` the manifest id of a task node; together with the manifest they pick the card variant
 * (`cardVariantFor`).
 */
export interface WorkflowNodeView {
  id: string;
  /** Contract node kind: `input | output | task | branch | join | loop | foreach | subflow | wait | human | note`. */
  kind: NodeKind;
  /** Manifest id of a `task` node, e.g. "flowaid.decision.choice"; absent for structural kinds. */
  nodeType?: NodeTypeId;
  category: NodeCategory;
  name: string;
  /** One-line purpose shown on the card (the text of a note). */
  description?: string;
  /** Provider/model label, e.g. "jev-latest" or "gpt-5-mini". */
  provider?: string;
  /** Short key/value pairs shown on the card. */
  meta?: Array<{ label: string; value: string }>;
  inputs: PortView[];
  outputs: PortView[];
  /**
   * Named control-outs (`ctl:<id>`). When absent the card draws the kind's default control-outs
   * (`controlOutsFor`): `done` for most nodes, `true`/`false` for a branch, `approved`/`rejected` for a
   * human node, the gate outcomes for a confidence gate.
   */
  routes?: ControlPortView[];
  /** Container (loop/foreach) the node sits in; control edges never cross a container boundary. */
  parent?: string;
  disabled?: boolean;
  /** Loop bounds when the node is iterative. */
  bounds?: { maxIterations?: number; timeoutMs?: number; maxCostUsd?: number };
  /** Compiler diagnostics that point at this node. */
  diagnostics?: Diagnostic[];
}

/** How a data edge is derived from its binding (`DataDependency.via`): only `ref` edges are drawn solid and selectable. */
export type DataEdgeVia = DataDependency["via"];

/**
 * An edge as the canvas projects it: a control edge (`ctl:<port>` → `ctl-in`, from `definition.edges`)
 * or a data edge (`out:<port>` → `in:<port>`, from `plan.dataEdges`).
 */
export interface WorkflowEdgeView {
  id: string;
  source: string;
  /** Prefixed handle id: `ctl:<port>` for control edges, `out:<port>` for data edges. */
  sourceHandle?: string;
  target: string;
  /** Prefixed handle id: `ctl-in` for control edges, `in:<port>` for data edges. */
  targetHandle?: string;
  /** Control port the edge leaves (defaults to the port of `sourceHandle`). */
  route?: string;
  label?: string;
  /** Defaults to the kind the handle ids name (`ctl:*` → control, otherwise data). */
  kind?: "data" | "control";
  /** Data edges: the binding that produced the edge. Absent means `ref`. */
  via?: DataEdgeVia;
  /** Data edges: the producer may be pruned; the binding carries a default. */
  optional?: boolean;
  /** Data edges: JSON Pointer into the source port's value. */
  path?: string;
  /** Data edges: the schema of the value that flows (shown in the tooltip). */
  schema?: ContractJsonSchema;
  /** Router exits: probability of the route; the edge is drawn weighted. */
  probability?: number;
}

/** The part of a `NodeManifest` the canvas reads to pick a card: the catalog category and the decision kind. */
export type CardManifest = Pick<NodeManifest, "decision"> & {
  metadata: Pick<NodeManifest["metadata"], "category">;
};

// ---------------------------------------------------------------------------
// Environments
// ---------------------------------------------------------------------------

/** Environments are workspace data, not an enum: an id, a display name and whether switching to it asks first. */
export type EnvironmentId = string;

export interface EnvironmentView {
  id: EnvironmentId;
  name: string;
  /** Production-like: the switcher confirms before targeting it. */
  protected: boolean;
}

// ---------------------------------------------------------------------------
// Runs and traces
// ---------------------------------------------------------------------------

/** A tool invocation folded from `TOOL_CALLED` / `TOOL_RETURNED`. */
export interface ToolCallView {
  name: string;
  args: unknown;
  result?: unknown;
  ok?: boolean;
  error?: ErrorInfo;
  /** HTTP status for `flowaid.tools.http` calls. */
  statusCode?: number;
  durationMs?: number;
}

/**
 * A node run as the timeline, canvas and inspector show it: the `NodeRun`
 * projection joined with the node's category and folded with the tool call
 * and log lines of its events. `toNodeRunView` / `foldRunEvents` build it.
 */
export interface NodeRunView {
  id: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  category: NodeCategory;
  status: NodeRunStatus;
  attempt: number;
  /** Scope path of the attempt, e.g. "research#0/search_all#1". */
  scope?: ScopePath;
  /** Iteration indices parsed from `scope`, e.g. [0, 1]. */
  iteration?: number[];
  parentNodeRunId?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  queueLatencyMs?: number;
  decision?: DecisionResult;
  /** The question the decision answered (`DECISION_COMPLETED.question`); the result itself does not carry it. */
  decisionQuestion?: string;
  /** Control ports fired by the node. */
  firedPorts?: PortName[];
  /** The route taken by a branch/router/gate node: its first fired control port other than `done`. */
  routeTaken?: string;
  toolCall?: ToolCallView;
  usage?: TokenUsage;
  costUsd?: number;
  error?: ErrorInfo;
  /** Set when the status is `reused`. */
  reusedFromNodeRunId?: string;
  input?: unknown;
  output?: unknown;
  logs?: LogLineView[];
  /** Loop / foreach progress, folded from `LOOP_ITERATION_*`, `LOOP_EXITED` and `FOREACH_*` events. */
  progress?: IterationProgress;
}

/** Why a loop stopped iterating (`LOOP_EXITED.reason`). */
export type LoopExitReason = RunEventOf<"LOOP_EXITED">["reason"];

/** One iteration (loop) or item (foreach) of a container node run. */
export interface IterationView {
  /** 0-based iteration or item index. */
  index: number;
  /** Scope path of the iteration's body, e.g. "research#1" or "research#1/search_all#3". */
  scope: ScopePath;
  status: "running" | "completed" | "failed" | "skipped";
}

/**
 * Progress of a loop or foreach node run. `started`/`completed` count
 * iterations (loop) or items (foreach); a loop is bounded by
 * `bounds.maxIterations`, a foreach by its `itemCount` (`total`).
 */
export interface IterationProgress {
  mode: "loop" | "foreach";
  /** Iterations started, or items seen (foreach items report only on completion). */
  started: number;
  /** Iterations or items finished (any status). */
  completed: number;
  /** Items that failed (foreach) or iterations whose body failed. */
  failed: number;
  /** Items to process (`FOREACH_STARTED.itemCount`). */
  total?: number;
  /** Items processed at once (`FOREACH_STARTED.concurrency`). */
  concurrency?: number;
  /** Every iteration seen, by ascending index; the iteration stepper walks these. */
  iterations: IterationView[];
  /** Set once the loop exited (`LOOP_EXITED.reason`). */
  exitReason?: LoopExitReason;
}

/**
 * A run with the joins the run page needs: the workflow's name and version
 * and the environment's name. Everything else mirrors `Run`.
 */
export interface RunView {
  id: string;
  workflowId: string;
  workflowName: string;
  version: number | "draft";
  environment?: EnvironmentView;
  status: RunStatus;
  origin: RunOrigin;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  costUsd?: number;
  usage?: TokenUsage;
  nodeRuns: NodeRunView[];
  input?: unknown;
  output?: unknown;
  error?: ErrorInfo;
  /** Present while a human task is open. */
  pendingApproval?: ApprovalRequestView;
}

/** One row of `GET /v1/runs/:id/trace` (UI.md §7.1), built by `@flowaid/observability` `buildTimeline()`. */
export interface Span {
  /** nodeRunId */
  id: string;
  /** Enclosing loop/foreach node run, or the subflow parent. */
  parentId: string | null;
  nodeId: NodeId;
  scope: ScopePath;
  attempt: number;
  name: string;
  kind: string;
  nodeType: NodeTypeId | null;
  category: NodeCategory;
  status: NodeRunStatus;
  startedAt: string | null;
  endedAt: string | null;
  latencyMs: number | null;
  queueLatencyMs: number | null;
  costUsd: number;
  usage: TokenUsage | null;
  decision: DecisionResult | null;
  firedPorts: PortName[];
  reused: boolean;
  /** Retries, tool calls, human waits, failovers and delegations inside the span. */
  markers: Array<{ seq: number; type: RunEventType; at: string }>;
  children: string[];
}

/** `GET /v1/runs/:id/trace`. */
export interface Trace {
  run: Run;
  spans: Span[];
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogLineView {
  at: string;
  level: LogLevel;
  message: string;
  nodeId?: string;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Human-in-the-loop
// ---------------------------------------------------------------------------

/**
 * A human task as the review surfaces see it: the task row's identity, the
 * redacted `HumanRequest` the runtime stored, and the joins that explain it
 * (node name, the decision that triggered it, a one-line reason).
 */
export interface ApprovalRequestView {
  /** Human task id. */
  id: string;
  runId: string;
  nodeId: string;
  nodeName: string;
  request: HumanRequest;
  requestedAt: string;
  /** Why the run stopped here, e.g. "Confidence 0.71 below the pass threshold 0.90". Derived from `request.origin`. */
  reason?: string;
  /** The decision that sent the run here, when one did. */
  decision?: DecisionResult;
}

// ---------------------------------------------------------------------------
// Versions and diffs
// ---------------------------------------------------------------------------

export interface WorkflowVersionView {
  id: string;
  version: number;
  status: "draft" | "published" | "production" | "archived";
  createdAt: string;
  createdBy?: string;
  message?: string;
  nodeCount: number;
}

/**
 * `diff(a, b)` from the compiler (ARCHITECTURE.md §4.7), served by
 * `GET /v1/workflow-versions/:id/diff/:other`. Node changes carry an RFC 6902
 * patch from the old node to the new one; the other sections are patches of
 * that top-level field.
 */
export interface WorkflowDiff {
  nodes: {
    added: string[];
    removed: string[];
    changed: Array<{ id: string; patch: JsonPatch }>;
  };
  edges: { added: string[]; removed: string[] };
  inputs: JsonPatch;
  outputs: JsonPatch;
  variables: JsonPatch;
  secrets: JsonPatch;
  execution: JsonPatch;
  /** Only `layout` differs. */
  layoutOnly: boolean;
}

// ---------------------------------------------------------------------------
// Schemas and forms
// ---------------------------------------------------------------------------

/** JSON Schema (2020-12 subset) as emitted by Zod's `z.toJSONSchema`. */
export interface JsonSchema {
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null" | Array<string>;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  const?: unknown;
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  minProperties?: number;
  maxProperties?: number;
  propertyNames?: JsonSchema;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  discriminator?: { propertyName: string };
  /** Inspector hints (CONTRACTS.ts §1 `UiHintsSchema`), the only hint key node manifests carry. */
  "x-ui"?: UiHints;
  /**
   * Forms-only extension hints for schemas the app writes itself (credential dialogs, human-task
   * forms, policy editors): the extension widgets (`radio`, `secret`, `credential`, `expression`,
   * `threshold`, `retry-policy` or any `registerWidget` name) and their options. Never in a manifest.
   */
  "x-ui-ext"?: FormExtensionHints;
  /** Deprecated alias of `x-ui` read by the forms group for one release (untyped: the forms group validates it). */
  "x-flowaid"?: Record<string, unknown>;
  /** CONTRACTS.ts `JsonSchema['x-secret']`: the value is a secret (masked input). */
  "x-secret"?: boolean;
}

/** Forms-only hints under `x-ui-ext` (see `JsonSchema["x-ui-ext"]`). */
export interface FormExtensionHints {
  /** An extension widget or any name registered with `registerWidget`. */
  widget?: string;
  /** `credential` widget: the credential type to offer. */
  credentialType?: string;
  /** `model` widget: which models to offer. */
  modelKind?: "decision" | "generation" | "embedding";
  /** `code` widget language. */
  language?: "javascript" | "typescript" | "json" | "yaml";
}

/** Upstream references available to an expression field. */
export interface ExpressionScope {
  inputs: PortView[];
  variables: Array<{ name: string; type: string }>;
  nodes: Array<{ id: string; name: string; outputs: PortView[] }>;
}

export interface CredentialView {
  id: string;
  name: string;
  type: string;
  environment?: string;
  lastUsedAt?: string;
}

export interface ModelView {
  id: string;
  provider: string;
  name: string;
  kind: "decision" | "generation" | "embedding";
  contextTokens?: number;
  inputCostPerMTok?: number;
  outputCostPerMTok?: number;
  health?: "healthy" | "degraded" | "down" | "unknown";
  local?: boolean;
}

// ---------------------------------------------------------------------------
// Evaluations, analysis
// ---------------------------------------------------------------------------

export interface EvaluationMetricView {
  key: string;
  label: string;
  /** Baseline (production) value. */
  base?: number;
  /** Candidate value. */
  candidate: number;
  unit?: "ratio" | "ms" | "usd" | "count";
  /** True when higher is better. */
  higherIsBetter: boolean;
}

export interface EvaluationCaseResultView {
  id: string;
  name: string;
  passed: boolean;
  expected?: unknown;
  actual?: unknown;
  branch?: { expected?: string; actual?: string };
  durationMs?: number;
  costUsd?: number;
  regression?: boolean;
}

export interface CriticFindingView {
  id: string;
  severity: "error" | "warning" | "suggestion";
  category: "cost" | "safety" | "reliability" | "correctness" | "performance" | "style";
  title: string;
  detail: string;
  nodeIds?: string[];
  /** Estimated saving when applied, if any. */
  savings?: { costUsd?: number; latencyMs?: number; calls?: number };
  fixAvailable?: boolean;
}

/** Type-level exhaustiveness guard for switches over closed unions. */
export function assertNever(value: never, what = "value"): never {
  throw new Error(`Unhandled ${what}: ${JSON.stringify(value)}`);
}

/** Narrowing helper used by the RFC 6902 views: a JSON patch op with a `value`. */
export function patchOpValue(op: JsonPatchOp): JsonValue | undefined {
  return op.op === "add" || op.op === "replace" || op.op === "test" ? op.value : undefined;
}
