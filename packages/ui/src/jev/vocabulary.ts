/**
 * Labels, orderings, tones and limits shared by the `jev` components. Tones
 * follow the UI addendum (JEV_ENGINEERING.md §17): routes reuse the gate tones
 * (auto = ok, improve = info, human = warn); consequence badges are low ink,
 * medium warn, high danger-soft, irreversible danger.
 */
import type {
  ConfigurableConsequence,
  ConsequenceClass,
  DriftAlarmKind,
  ImproveActionKind,
  InspectFirst,
  JevDataClass,
  JevRoute,
  JevZoneThresholds,
  RolloutDisposition,
  RouteReason,
} from "./types";

/** Limits of the live Jev API (docs/design/TYPESAFE_API.md) and the addendum's packet budget (§5.4). */
export const JEV_LIMITS = {
  /** A choice question accepts at most 255 options, escapes included. */
  maxChoiceOptions: 255,
  /** A score question takes 2–10 ordered level descriptions. */
  minScoreLevels: 2,
  maxScoreLevels: 10,
  /** State plus the longest question, in tokens. */
  stateAndQuestionTokens: 32_000,
  /** Whole request, in tokens. */
  requestTokens: 64_000,
  /** Highest `state.maxTokens` a contract may declare (leaves ≥ 2 000 for the question). */
  maxPacketTokens: 30_000,
  minPacketTokens: 256,
  /** flowaid's chars → tokens estimator (ARCH §6.3). */
  charsPerToken: 3.5,
} as const;

export const CONSEQUENCE_ORDER: readonly ConsequenceClass[] = [
  "low",
  "medium",
  "high",
  "irreversible",
];
export const CONFIGURABLE_CONSEQUENCES: readonly ConfigurableConsequence[] = [
  "low",
  "medium",
  "high",
];

export const CONSEQUENCE_LABEL: Record<ConsequenceClass, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  irreversible: "Irreversible",
};

export const CONSEQUENCE_MEANING: Record<ConsequenceClass, string> = {
  low: "Internal and reversible; no customer-visible or external effect.",
  medium: "Reversible external effect or bounded cost; correctable.",
  high: "Represents the user or organisation, moves money, changes access or exposes data.",
  irreversible: "Cannot be undone. Human review at every confidence.",
};

/** Rank for comparisons: a route node may only raise the class. */
export function consequenceRank(c: ConsequenceClass): number {
  return CONSEQUENCE_ORDER.indexOf(c);
}

export function maxConsequence(
  ...classes: (ConsequenceClass | null | undefined)[]
): ConsequenceClass {
  let best: ConsequenceClass = "low";
  for (const c of classes) if (c && consequenceRank(c) > consequenceRank(best)) best = c;
  return best;
}

export const DATA_CLASS_ORDER: readonly JevDataClass[] = ["public", "internal", "sensitive", "pii"];

export function dataClassRank(c: JevDataClass): number {
  return DATA_CLASS_ORDER.indexOf(c);
}

export const ROUTE_ORDER: readonly JevRoute[] = ["auto", "improve", "human"];

export const ROUTE_LABEL: Record<JevRoute, string> = {
  auto: "Auto",
  improve: "Improve",
  human: "Human",
};

export type JevTone = "ok" | "info" | "warn" | "danger" | "neutral" | "accent";

export const ROUTE_TONE: Record<JevRoute, JevTone> = { auto: "ok", improve: "info", human: "warn" };

export const DISPOSITION_LABEL: Record<RolloutDisposition, string> = {
  active: "Active",
  canary: "Canary",
  holdback: "Holdback",
  shadow: "Shadow",
};

/** Strong and soft colour tokens for a tone. */
export function toneVar(tone: JevTone, soft = false): string {
  if (tone === "neutral") return soft ? "var(--surface-3)" : "var(--ink-2)";
  return soft ? `var(--${tone}-soft)` : `var(--${tone})`;
}

/** Table V as flowaid reads it (§6.3). Applied when a contract omits a class; routes then carry `thresholds_illustrative`. */
export const ILLUSTRATIVE_THRESHOLDS: Record<ConfigurableConsequence, JevZoneThresholds> = {
  low: { autoAt: 0.9, improveAt: 0.7 },
  medium: { autoAt: null, improveAt: 0.7 },
  high: { autoAt: null, improveAt: null },
};

export const ROUTE_REASON_LABEL: Record<RouteReason, string> = {
  zone_auto: "Confidence in the auto zone",
  zone_improve: "Confidence in the improve zone",
  zone_human: "Confidence below the improve floor",
  margin_below_min: "Top-two margin below the minimum",
  thresholds_illustrative: "Illustrative thresholds (not governed)",
  consequence_irreversible: "Irreversible: human at every confidence",
  outcome_not_automatable: "Outcome is not automatable",
  escape_outcome: "Escape outcome",
  stop_outcome: "Stop outcome",
  provider_uncalibrated: "Provider or version uncalibrated",
  model_version_changed: "Resolved model changed",
  improve_budget_exhausted: "Improve budget exhausted",
  blind_retry_blocked: "Blind retry blocked (same evidence)",
  packet_over_budget: "Packet over its token budget",
  stale_evidence: "Stale evidence",
  stale_option: "Stale option set",
  state_race: "State changed during evaluation",
  fallback_outcome: "Fallback outcome",
  rollout_shadow: "Rollout: shadow only",
  rollout_holdback: "Rollout: held back",
  rollout_scope: "Rollout: outside guardrail scope",
  policy_review: "Policy requires review",
  policy_deny: "Policy denied",
  legacy_gate: "Routed by a legacy gate",
};

export const IMPROVE_ACTION_LABEL: Record<ImproveActionKind, string> = {
  collect_evidence: "Collect evidence",
  deterministic_check: "Deterministic check",
  narrow_options: "Narrow options",
  ask_user: "Ask the user",
  stronger_model: "Stronger model",
};

export const DRIFT_ALARM_LABEL: Record<DriftAlarmKind, string> = {
  ece_rise: "ECE rising",
  review_rate_rise: "Review rate rising",
  escape_rate_rise: "Escape rate rising",
  near_threshold_mass: "Mass near the auto threshold",
  confidence_shift: "Confidence distribution shifted",
  override_rate: "Override rate",
  model_version_changed: "Model version changed",
  label_disagreement: "Labelers disagree",
  stale_options: "Stale options",
  monotonicity: "Monotonicity violations",
};

/** Table IX "inspect first" wording. */
export const INSPECT_FIRST_LABEL: Record<InspectFirst, string> = {
  state_freshness: "State freshness",
  menu_completeness: "Menu completeness",
  new_option_class: "New option class",
  evidence: "Evidence",
  calibration: "Calibration",
  contract_wording: "Contract wording",
  policy_order: "Policy order",
};

/** `support.router@4` */
export function contractLabel(ref: { key: string; version: number }): string {
  return `${ref.key}@${ref.version}`;
}

/** First 8 hex characters of a hash, for chips. */
export function shortHash(hash: string, length = 8): string {
  return hash.replace(/^sha256:/, "").slice(0, length);
}
