/**
 * View types of the `jev` group. They mirror the schemas of
 * docs/design/JEV_ENGINEERING.md (§4 contracts, §5 packets, §6 routing, §7
 * calibration, §10 option sets, §11 shadow, §12 receipts) as plain
 * TypeScript, so this presentational group has no runtime dependency on
 * `@flowaid/jev`. Field names and enums are the addendum's; defaults the
 * schemas fill in are required here (a view renders a parsed value).
 */

// ---------------------------------------------------------------------------
// Wire enums (§12.1, RFC-0013)
// ---------------------------------------------------------------------------

/** Stakes of the action a judgment may authorise (§6.1), ordered low → irreversible. */
export type ConsequenceClass = "low" | "medium" | "high" | "irreversible";
/** Table III "Records auto, improve, or human". */
export type JevRoute = "auto" | "improve" | "human";
/** What rollout allowed for one decision (§6.7). */
export type RolloutDisposition = "active" | "canary" | "holdback" | "shadow";
export type DecisionMode = "live" | "shadow" | "replay" | "evaluation";
export type PolicyVerdict = "allow" | "review" | "deny";
/** Escape hatch kinds (§II.A, §X.B). */
export type EscapeKind = "none" | "other" | "stop" | "review" | "escalate";
/** Data classes, ordered public → pii (workflow-core `DataClassSchema`). */
export type JevDataClass = "public" | "internal" | "sensitive" | "pii";

export type RouteReason =
  | "zone_auto"
  | "zone_improve"
  | "zone_human"
  | "margin_below_min"
  | "thresholds_illustrative"
  | "consequence_irreversible"
  | "outcome_not_automatable"
  | "escape_outcome"
  | "stop_outcome"
  | "provider_uncalibrated"
  | "model_version_changed"
  | "improve_budget_exhausted"
  | "blind_retry_blocked"
  | "packet_over_budget"
  | "stale_evidence"
  | "stale_option"
  | "state_race"
  | "fallback_outcome"
  | "rollout_shadow"
  | "rollout_holdback"
  | "rollout_scope"
  | "policy_review"
  | "policy_deny"
  | "legacy_gate";

/** `key@version` + canonical body hash (§12.1 `ContractRef`). */
export interface JevContractRef {
  key: string;
  version: number;
  hash: string;
  origin: "registry" | "implicit";
}

// ---------------------------------------------------------------------------
// Decision contract (§4.2)
// ---------------------------------------------------------------------------

export interface JevOutcomeSpec {
  /** Evidence conditions under which this outcome is the correct branch. */
  description: string;
  escape?: EscapeKind;
  consequenceClass?: ConsequenceClass;
  automatable: boolean;
}

export interface JevStaticMenu {
  source: "static";
  outcomes: Record<string, JevOutcomeSpec>;
}

export interface JevDynamicMenu {
  source: "dynamic";
  escapes: Record<string, JevOutcomeSpec & { escape: EscapeKind }>;
  maxOptions: number;
  keyStrategy: "ordinal" | "slug";
  maxAgeMs: number;
  descriptionGuidance?: string;
}

export interface JevScoreBand {
  port: string;
  minLevel: number;
  maxLevel: number;
  consequenceClass?: ConsequenceClass;
  automatable: boolean;
}

export type JevContractQuestion =
  | { kind: "choice"; instructions: string; menu: JevStaticMenu | JevDynamicMenu }
  | { kind: "score"; instructions: string; levels: string[]; bands?: JevScoreBand[] }
  | {
      kind: "boolean";
      instructions: string;
      outcomes: { true: Omit<JevOutcomeSpec, "escape">; false: Omit<JevOutcomeSpec, "escape"> };
      yesAt: number;
    };

/** Operating zones of one consequence class (§V.A, Table V). */
export interface JevZoneThresholds {
  /** confidence ≥ autoAt ⇒ auto; null ⇒ this class never automates. */
  autoAt: number | null;
  /** improveAt ≤ confidence < autoAt ⇒ improve; null ⇒ no improve zone. Below ⇒ human. */
  improveAt: number | null;
  /** top1 − top2 below this demotes one zone. */
  minMargin?: number;
}

export type RollbackMetric =
  | "override_rate"
  | "auto_error_rate"
  | "review_rate"
  | "escape_rate"
  | "ece"
  | "stale_option_rate"
  | "recovery_cost_usd";

export interface JevRollbackTrigger {
  metric: RollbackMetric;
  op: ">" | ">=";
  value: number;
  window: "1h" | "24h" | "7d";
  minSamples: number;
  action: "pause_candidate" | "rollback_active" | "pause_active" | "alert_only";
}

export interface JevThresholdGovernance {
  owner: string;
  rationale: string;
  evaluationWindow: {
    from: string;
    to: string;
    source: "shadow" | "canary" | "production" | "evaluation" | "illustrative";
    labeled: number;
    calibrationSnapshotIds: string[];
  };
  rollbackCondition: JevRollbackTrigger;
  approvedBy: string | null;
  approvedAt: string | null;
}

export type ImproveActionKind =
  "collect_evidence" | "deterministic_check" | "narrow_options" | "ask_user" | "stronger_model";

export interface JevImproveAction {
  kind: ImproveActionKind;
  description: string;
}

/** The configurable classes; `irreversible` is always human and never configured. */
export type ConfigurableConsequence = Exclude<ConsequenceClass, "irreversible">;

export interface JevRoutingPolicy {
  consequenceClass: ConsequenceClass;
  thresholds: Partial<Record<ConfigurableConsequence, JevZoneThresholds>>;
  governance?: JevThresholdGovernance;
  escapeRoutes: { none: "improve" | "human"; other: "improve" | "human"; stop: "auto" | "human" };
  improve?: { actions: JevImproveAction[]; maxRounds: number };
  uncalibratedProviders: "human" | "improve" | "allow";
  onModelChange: "continue" | "human";
}

export type ActionKind =
  | "internal_routing"
  | "select_model"
  | "select_worker"
  | "retrieval_filter"
  | "annotate"
  | "tool_call"
  | "external_message"
  | "publish"
  | "purchase"
  | "delete"
  | "permission_change"
  | "data_write"
  | "money_movement"
  | "represent_user";

export interface JevAllowedAction {
  kinds: ActionKind[];
  capabilities: string[];
  maxConsequence: ConsequenceClass;
  externalSideEffects: boolean;
}

export interface JevEscalation {
  assignees: string[];
  mode: "choice" | "approval";
  expiresInMs?: number;
  onExpire: "fail" | "route" | "escalate";
  rubric: string;
}

export interface JevProviderHop {
  provider: "typesafe" | "llm" | "rule" | "human" | "custom";
  model?: string;
}

export interface JevContractModel {
  primary: JevProviderHop;
  failover: JevProviderHop[];
  expectResolved?: string;
}

export type FixtureCategory =
  | "normal"
  | "ambiguous"
  | "missing_evidence"
  | "adversarial"
  | "stale_options"
  | "rare_class"
  | "no_fit"
  | "incident"
  | "ladder";

export interface JevContractTests {
  requiredCategories: FixtureCategory[];
  minPerCategory: number;
  minAccuracy: number;
  requireMonotonicity: boolean;
}

// ---------------------------------------------------------------------------
// State spec (§5.2) and packets (§5.1)
// ---------------------------------------------------------------------------

export type PacketRole = "goal" | "fact" | "artifact" | "evidence" | "constraint" | "option";
export type LatencyClass = "interactive" | "standard" | "batch";

export interface JevPacketFieldSpec {
  role: PacketRole;
  /** Why the field is present (§IV.E). */
  description: string;
  schema: Record<string, unknown>;
  required: boolean;
  dataClass: JevDataClass;
  redact: "error" | "mask" | "hash" | "drop";
  maxChars?: number;
  overflow: "error" | "truncate_marked";
  freshness?: { maxAgeMs: number; requireVersion: boolean };
  selection?: { maxItems: number; order: "as_bound" | "observed_desc" };
}

export interface JevStateSpec {
  goal?: string;
  fields: Record<string, JevPacketFieldSpec>;
  maxTokens: number;
  privacyClass: JevDataClass;
  latencyClass: LatencyClass;
  consistency: "record" | "strict";
}

export interface JevContractBody {
  key: string;
  version: number;
  title: string;
  purpose: string;
  owner: string;
  question: JevContractQuestion;
  fallbackOutcome: string | null;
  state: JevStateSpec;
  routing: JevRoutingPolicy;
  allowedAction: JevAllowedAction;
  escalation: JevEscalation;
  model: JevContractModel;
  tests: JevContractTests;
  changelog: string;
  tags: string[];
}

export type ContractVersionStatus = "in_review" | "approved" | "rejected" | "deprecated";

/** One deployment chip per environment (UI addendum §17: "active v·stage, candidate v·stage"). */
export interface JevDeploymentChip {
  environment: string;
  protected: boolean;
  active: { version: number; stage: "shadow" | "active" | "paused" } | null;
  candidate: { version: number; stage: "shadow" | "canary" } | null;
}

export interface JevEvidenceItem {
  id: string;
  kind: string;
  supports: string[];
  summary?: string;
  source?: { uri?: string; ref?: string };
  observedAt?: string;
  version?: string;
  verified?: boolean;
}

export interface JevArtifactItem {
  id: string;
  kind: string;
  ref?: string;
  hash?: string;
  summary?: string;
}

/** The object sent as TypeSafe `state` (§5.1), sections in canonical order. */
export interface JevStatePacket {
  goal?: string;
  facts?: Record<string, unknown>;
  artifacts?: JevArtifactItem[];
  evidence?: JevEvidenceItem[];
  constraints?: Record<string, unknown>;
  options?: Record<string, unknown>;
  stateVersion: string;
}

/** `PacketReport` (§5.3 step 9) as the packet viewer needs it. */
export interface JevPacketReport {
  included: string[];
  excluded: { field: string; reason: "undeclared" | "data_class" | "empty_optional" }[];
  redacted: { field: string; mode: "mask" | "hash" | "drop"; dataClass: JevDataClass }[];
  truncated: { field: string; originalChars: number; keptChars: number }[];
  droppedEvidence: string[];
  stale: { id: string; ageMs: number }[];
  tokens: number;
  effectiveDataClass: JevDataClass;
  /** field → formatted refs of the producing node outputs (§5.5). */
  provenance: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Option sets (§10.1)
// ---------------------------------------------------------------------------

export interface JevOptionEntry {
  key: string;
  sourceId: string;
  label?: string;
  description: string;
  escape?: EscapeKind;
  observedAt?: string;
}

export interface JevOptionCounts {
  original: number;
  kept: number;
  eligible: number;
  shortlisted: number;
  final: number;
}

export interface JevOptionSet {
  version: string;
  entries: JevOptionEntry[];
  counts: JevOptionCounts;
  builtAt: string;
  builtAtSeq: number;
}

// ---------------------------------------------------------------------------
// Receipts (§12.1)
// ---------------------------------------------------------------------------

export interface JevThresholdApplied {
  consequenceClass: ConsequenceClass;
  autoAt: number | null;
  improveAt: number | null;
  minMargin: number | null;
  confidence: number | null;
  margin: number | null;
  illustrative: boolean;
  source: string;
}

export type JevAuthorizedAction =
  | { kind: "fire_port"; port: string }
  | { kind: "tool_call"; tool: string; proposalHash: string }
  | { kind: "human_review"; port: string | null; inline: boolean }
  | { kind: "improve"; port: string }
  | { kind: "legacy"; port: string }
  | { kind: "none"; reason: "shadow" | "denied" | "external_routing" };

export interface JevPolicyRecord {
  id: string;
  verdict: PolicyVerdict;
  checks: { name: string; ok: boolean; detail: string | null }[];
  proofId: string | null;
}

export interface JevRoutingRecord {
  routedBy: { nodeId: string; nodeRunId: string };
  consequenceClass: ConsequenceClass;
  threshold: JevThresholdApplied;
  route: JevRoute;
  reasons: RouteReason[];
  disposition: RolloutDisposition;
  policy: JevPolicyRecord;
  authorizedAction: JevAuthorizedAction;
  at: string;
}

export interface JevExecutedAction {
  kind: "node" | "tool_call" | "human_task";
  nodeId: string | null;
  nodeRunId: string | null;
  toolCallId: string | null;
  humanTaskId: string | null;
  status: "completed" | "failed" | "skipped" | "cancelled";
  failure: "stale_option" | "error" | null;
  at: string;
}

export interface JevDecisionOverride {
  by: string;
  at: string;
  from: string | null;
  to: string;
  route: JevRoute | null;
  reason: string | null;
  source: "human_task" | "api";
}

export interface JevOptionSetRef {
  version: string;
  source: "static" | "dynamic";
  size: number;
  escapeKeys: string[];
  counts: JevOptionCounts | null;
  ageMs: number | null;
}

/** `DecisionReceipt` plus the projections the receipt page joins (executed action, overrides). */
export interface JevReceipt {
  receiptId: string;
  runId: string;
  nodeRunId: string;
  nodeId: string;
  question: string;
  bundleId: string;
  batchId: string | null;
  mode: DecisionMode;
  contract: JevContractRef;
  kind: "boolean" | "choice" | "score";
  stateReference: {
    stateVersion: string;
    packetHash: string;
    snapshotId: string | null;
    fidelity: "exact" | "redacted" | "not_persisted";
  };
  evidenceScope: { fields: string[]; evidenceIds: string[] };
  optionSet: JevOptionSetRef | null;
  rubric: string[] | null;
  outcome: string | null;
  escape: EscapeKind | null;
  distribution: Record<string, number>;
  bandMass: Record<string, number> | null;
  value: string | number | boolean | null;
  confidence: number | null;
  model: { provider: string; requested: string; resolved: string | null };
  requestId: string | null;
  latencyMs: number;
  costUsd: number;
  reused: boolean;
  staleness: { optionSetAgeMs: number | null; staleEvidence: string[]; raceRecorded: boolean };
  routings: JevRoutingRecord[];
  at: string;
  executedAction?: JevExecutedAction | null;
  overrides?: JevDecisionOverride[];
}

// ---------------------------------------------------------------------------
// Shadow (§11.2)
// ---------------------------------------------------------------------------

export type ProductionSource = "llm" | "rule" | "code" | "human" | "jev";

export interface JevShadowComparison {
  id: string;
  receiptId: string;
  contract: JevContractRef;
  runId: string;
  question: string;
  stateHash: string;
  jevModel: string;
  shadow: {
    outcome: string;
    confidence: number;
    distribution: Record<string, number>;
    wouldRoute: JevRoute;
  };
  production: {
    source: ProductionSource;
    nodeId: string;
    answer: string | null;
    confidence: number | null;
  };
  agree: boolean | null;
  humanLabel: string | null;
  actionTaken: false;
  deferred: boolean;
  at: string;
}

/** Measured cost and latency of each path over the same window (§14.4: flowaid's own measurements). */
export interface JevPathEconomics {
  decisions: number;
  costUsdPerDecision: number;
  p50Ms: number;
  p95Ms: number;
}

// ---------------------------------------------------------------------------
// Calibration (§7.2, §7.4, §7.6)
// ---------------------------------------------------------------------------

export interface JevReliabilityBin {
  lo: number;
  hi: number;
  weight: number;
  labeled: number;
  meanConfidence: number | null;
  accuracy: number | null;
}

export interface JevCalibrationMetrics {
  decisions: number;
  labeled: number;
  accuracy: number | null;
  ece: number | null;
  ace: number | null;
  mce: number | null;
  brier: number | null;
  rps: number | null;
  classwise: Record<
    string,
    { support: number; ece: number | null; accuracy: number | null; meanConfidence: number | null }
  > | null;
  bins: JevReliabilityBin[];
  routeShare: Record<JevRoute, number>;
  autoPrecision: { value: number; lower95: number; n: number } | null;
  routeCorrectness: number | null;
  nearThreshold: { band: number; above: number; below: number };
  psi: number | null;
  rates: {
    escape: number;
    override: number;
    staleOption: number;
    blindRetryBlocked: number;
    interRaterDisagreement: number | null;
  };
}

export type DriftAlarmKind =
  | "ece_rise"
  | "review_rate_rise"
  | "escape_rate_rise"
  | "near_threshold_mass"
  | "confidence_shift"
  | "override_rate"
  | "model_version_changed"
  | "label_disagreement"
  | "stale_options"
  | "monotonicity";

export type InspectFirst =
  | "state_freshness"
  | "menu_completeness"
  | "new_option_class"
  | "evidence"
  | "calibration"
  | "contract_wording"
  | "policy_order";

export interface JevDriftAlarm {
  kind: DriftAlarmKind;
  severity: "info" | "warning" | "critical";
  value: number;
  baseline: number | null;
  threshold: number;
  message: string;
  inspectFirst: InspectFirst[];
}

export interface JevCalibrationSegment {
  environment: string | null;
  consequenceClass: ConsequenceClass | null;
  language: string | null;
  outcome: string | null;
  resolvedModel: string | null;
  mode: "live" | "shadow" | null;
}

/** `ThresholdRecommendation` (§7.6). Never applied automatically. */
export interface JevThresholdRecommendation {
  consequenceClass: ConfigurableConsequence;
  current: JevZoneThresholds | null;
  recommended: JevZoneThresholds | null;
  target: { precision: number; minLabeled: number; maxEce: number };
  achieved: { precision: number; lower95: number; coverage: number; n: number } | null;
  nearThresholdMass: number;
  basis: { labeled: number; window: string };
  warnings: string[];
}
