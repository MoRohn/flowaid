/**
 * Label sampling and adjudication (JEV_ENGINEERING.md §7.1).
 *
 * A receipt enters the labeling queue when a deterministic hash of its id falls below the highest
 * rate of the strata it matches (or the base rate). The inclusion probability is recorded so
 * metrics can weight by `1/π`. Disagreement is preserved, not forced into consensus (§IX.E).
 */
import { sha256Hex } from "@flowaid/shared";
import type { ConsequenceClass, JevRoute } from "../wire.js";
import {
  LabelSamplingPolicySchema,
  type DecisionLabel,
  type LabelSamplingPolicy,
  type LabelStratum,
} from "./schemas.js";

export interface StratumFacts {
  confidence: number;
  /** Automation threshold in force; `null` when the decision cannot auto-act. */
  autoAt: number | null;
  /** Share of this outcome among recent decisions of the contract version. */
  outcomeShare: number | null;
  consequenceClass: ConsequenceClass;
  escape: boolean;
  route: JevRoute;
  /** The contract version is younger than its first full calibration window. */
  newVersion: boolean;
  /** A shadow evaluation disagreed with the production answer. */
  shadowDisagreement: boolean;
}

/** The strata a decision matches under `policy`. */
export function matchStrata(
  facts: StratumFacts,
  policy?: Partial<LabelSamplingPolicy>,
): LabelStratum[] {
  const p = LabelSamplingPolicySchema.parse(policy ?? {});
  const out: LabelStratum[] = [];
  if (facts.autoAt !== null && Math.abs(facts.confidence - facts.autoAt) < p.nearThresholdBand) {
    out.push("near_threshold");
  }
  if (facts.outcomeShare !== null && facts.outcomeShare < p.rareOutcomeShare)
    out.push("rare_outcome");
  if (facts.consequenceClass === "high" || facts.consequenceClass === "irreversible") {
    out.push("consequence_high");
  }
  if (facts.escape) out.push("escape_outcome");
  if (facts.route === "auto") out.push("auto_route");
  if (facts.newVersion) out.push("new_version");
  if (facts.shadowDisagreement) out.push("shadow_disagreement");
  return out;
}

/** Deterministic uniform draw in [0,1) from a receipt id (and optional salt). */
export function sampleDraw(receiptId: string, salt = ""): number {
  const hex = sha256Hex(`${salt}:${receiptId}`).slice(0, 13); // 52 bits
  return parseInt(hex, 16) / 2 ** 52;
}

export interface SampleDecision {
  include: boolean;
  inclusionProbability: number;
  strata: LabelStratum[];
}

/** Decides whether a receipt enters the labeling queue and with what inclusion probability. */
export function sampleForLabel(
  receiptId: string,
  strata: readonly LabelStratum[],
  policy?: Partial<LabelSamplingPolicy>,
  salt = "",
): SampleDecision {
  const p = LabelSamplingPolicySchema.parse(policy ?? {});
  let rate = p.baseRate;
  for (const s of strata) {
    const rule = p.strata.find((r) => r.when === s);
    if (rule !== undefined && rule.rate > rate) rate = rule.rate;
  }
  return {
    include: sampleDraw(receiptId, salt) < rate,
    inclusionProbability: rate,
    strata: [...strata],
  };
}

export type AdjudicationStatus = "unlabeled" | "single" | "agreed" | "disputed" | "adjudicated";

export interface Adjudication {
  receiptId: string;
  status: AdjudicationStatus;
  /** The label calibration may use; `null` while unlabeled or disputed. */
  outcome: string | null;
  labelers: number;
  /** True when independent labelers disagreed (counted in inter-rater disagreement even after adjudication). */
  disagreed: boolean;
}

/**
 * Folds the labels of one receipt. Fixture labels are ignored (they never mix with production
 * calibration). The latest label per labeler counts; an `adjudication` label resolves disputes.
 */
export function adjudicate(receiptId: string, labels: readonly DecisionLabel[]): Adjudication {
  const own = labels.filter((l) => l.receiptId === receiptId && l.source !== "fixture");
  const adjudications = own
    .filter((l) => l.source === "adjudication")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latest = new Map<string, DecisionLabel>();
  for (const l of own) {
    if (l.source === "adjudication") continue;
    const prev = latest.get(l.labeler);
    if (prev === undefined || prev.createdAt <= l.createdAt) latest.set(l.labeler, l);
  }
  const outcomes = new Set([...latest.values()].map((l) => l.outcome));
  const disagreed = latest.size >= 2 && outcomes.size > 1;
  const resolved = adjudications.at(-1);
  if (resolved !== undefined) {
    return {
      receiptId,
      status: "adjudicated",
      outcome: resolved.outcome,
      labelers: latest.size,
      disagreed,
    };
  }
  if (latest.size === 0)
    return { receiptId, status: "unlabeled", outcome: null, labelers: 0, disagreed: false };
  const first = [...outcomes][0] ?? null;
  if (latest.size === 1)
    return { receiptId, status: "single", outcome: first, labelers: 1, disagreed: false };
  return disagreed
    ? { receiptId, status: "disputed", outcome: null, labelers: latest.size, disagreed }
    : { receiptId, status: "agreed", outcome: first, labelers: latest.size, disagreed };
}

/** Share of multiply-labeled receipts whose independent labelers disagreed; `null` when none. */
export function interRaterDisagreement(results: readonly Adjudication[]): number | null {
  const multi = results.filter((r) => r.labelers >= 2);
  if (multi.length === 0) return null;
  return multi.filter((r) => r.disagreed).length / multi.length;
}
