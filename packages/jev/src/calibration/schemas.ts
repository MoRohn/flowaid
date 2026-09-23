/**
 * Calibration schemas (JEV_ENGINEERING.md §7.1, §7.2, §7.4).
 *
 * Calibration is measured per contract version and segment, never globally: "a global average can
 * hide the branch that matters most" (handbook §V.D).
 */
import { z } from "zod";
import {
  ConsequenceClassSchema,
  ContractRefSchema,
  JevRouteSchema,
  RolloutDispositionSchema,
} from "../wire.js";

export const LabelSourceSchema = z.enum([
  "reviewer",
  "override",
  "sampled_review",
  "fixture",
  "adjudication",
]);
export type LabelSource = z.infer<typeof LabelSourceSchema>;

export const DecisionLabelSchema = z.object({
  id: z.uuid(),
  receiptId: z.uuid(),
  /** User id; `system` for fixtures. */
  labeler: z.string(),
  source: LabelSourceSchema,
  /** The semantic answer under the contract (option key | 'true'/'false' | band port | level index). */
  outcome: z.string(),
  /** Dual label for consequence ≥ medium: the route the case should have taken. */
  permittedRoute: JevRouteSchema.nullable(),
  /** Version of the written labeling rubric. */
  rubricVersion: z.string(),
  /** Short human rationale, never a chain of thought. */
  rationale: z.string().max(1000).nullable(),
  /** Inclusion probability when the receipt reached the labeler through sampling. */
  inclusionProbability: z.number().min(0).max(1).nullable(),
  createdAt: z.iso.datetime(),
});
export type DecisionLabel = z.infer<typeof DecisionLabelSchema>;

export const LabelStratumSchema = z.enum([
  "near_threshold",
  "rare_outcome",
  "consequence_high",
  "escape_outcome",
  "auto_route",
  "new_version",
  "shadow_disagreement",
]);
export type LabelStratum = z.infer<typeof LabelStratumSchema>;

export const LabelSamplingPolicySchema = z.object({
  baseRate: z.number().min(0).max(1).default(0.02),
  strata: z.array(z.object({ when: LabelStratumSchema, rate: z.number().min(0).max(1) })).default([
    { when: "near_threshold", rate: 0.25 },
    { when: "rare_outcome", rate: 0.5 },
    { when: "consequence_high", rate: 0.5 },
    { when: "escape_outcome", rate: 0.2 },
    { when: "auto_route", rate: 0.05 },
    { when: "new_version", rate: 0.2 },
    { when: "shadow_disagreement", rate: 0.5 },
  ]),
  nearThresholdBand: z.number().min(0).max(0.2).default(0.03),
  rareOutcomeShare: z.number().min(0).max(0.2).default(0.02),
});
export type LabelSamplingPolicy = z.infer<typeof LabelSamplingPolicySchema>;

export const ReliabilityBinSchema = z.object({
  lo: z.number(),
  hi: z.number(),
  weight: z.number(),
  labeled: z.int(),
  meanConfidence: z.number().nullable(),
  accuracy: z.number().nullable(),
});
export type ReliabilityBin = z.infer<typeof ReliabilityBinSchema>;

export const CalibrationMetricsSchema = z.object({
  decisions: z.int().min(0),
  labeled: z.int().min(0),
  accuracy: z.number().nullable(),
  ece: z.number().nullable(),
  ace: z.number().nullable(),
  mce: z.number().nullable(),
  brier: z.number().nullable(),
  rps: z.number().nullable(),
  classwise: z
    .record(
      z.string(),
      z.object({
        support: z.int(),
        ece: z.number().nullable(),
        accuracy: z.number().nullable(),
        meanConfidence: z.number().nullable(),
      }),
    )
    .nullable(),
  bins: z.array(ReliabilityBinSchema),
  routeShare: z.object({ auto: z.number(), improve: z.number(), human: z.number() }),
  autoPrecision: z.object({ value: z.number(), lower95: z.number(), n: z.int() }).nullable(),
  routeCorrectness: z.number().nullable(),
  nearThreshold: z.object({ band: z.number(), above: z.number(), below: z.number() }),
  confidenceHistogram: z.array(z.object({ lo: z.number(), hi: z.number(), count: z.int() })),
  psi: z.number().nullable(),
  monotonicity: z.object({ ladders: z.int(), violations: z.int() }).nullable(),
  rates: z.object({
    escape: z.number(),
    override: z.number(),
    staleOption: z.number(),
    blindRetryBlocked: z.number(),
    interRaterDisagreement: z.number().nullable(),
  }),
});
export type CalibrationMetrics = z.infer<typeof CalibrationMetricsSchema>;

export const CalibrationSegmentSchema = z.object({
  environmentId: z.uuid().nullable(),
  consequenceClass: ConsequenceClassSchema.nullable(),
  language: z.string().nullable(),
  outcome: z.string().nullable(),
  resolvedModel: z.string().nullable(),
  mode: z.enum(["live", "shadow"]).nullable(),
  disposition: RolloutDispositionSchema.nullable(),
});
export type CalibrationSegment = z.infer<typeof CalibrationSegmentSchema>;

export const DriftAlarmKindSchema = z.enum([
  "ece_rise",
  "review_rate_rise",
  "escape_rate_rise",
  "near_threshold_mass",
  "confidence_shift",
  "override_rate",
  "model_version_changed",
  "label_disagreement",
  "stale_options",
  "monotonicity",
]);
export type DriftAlarmKind = z.infer<typeof DriftAlarmKindSchema>;

export const InspectFirstSchema = z.enum([
  "state_freshness",
  "menu_completeness",
  "new_option_class",
  "evidence",
  "calibration",
  "contract_wording",
  "policy_order",
]);
export type InspectFirst = z.infer<typeof InspectFirstSchema>;

export const DriftAlarmSchema = z.object({
  kind: DriftAlarmKindSchema,
  severity: z.enum(["info", "warning", "critical"]),
  value: z.number(),
  baseline: z.number().nullable(),
  threshold: z.number(),
  message: z.string(),
  inspectFirst: z.array(InspectFirstSchema),
});
export type DriftAlarm = z.infer<typeof DriftAlarmSchema>;

export const CalibrationSnapshotSchema = z.object({
  id: z.uuid(),
  contract: ContractRefSchema,
  segment: CalibrationSegmentSchema,
  window: z.object({
    kind: z.enum(["rolling_7d", "rolling_28d", "shadow_baseline", "canary", "evaluation"]),
    from: z.iso.datetime(),
    to: z.iso.datetime(),
  }),
  metrics: CalibrationMetricsSchema,
  alarms: z.array(DriftAlarmSchema),
  baselineSnapshotId: z.uuid().nullable(),
  computedAt: z.iso.datetime(),
});
export type CalibrationSnapshot = z.infer<typeof CalibrationSnapshotSchema>;

export const ThresholdRecommendationSchema = z.object({
  consequenceClass: ConsequenceClassSchema,
  current: z.object({ autoAt: z.number().nullable(), improveAt: z.number().nullable() }),
  recommended: z.object({ autoAt: z.number().nullable(), improveAt: z.number().nullable() }),
  target: z.object({ precision: z.number(), minLabeled: z.int(), maxEce: z.number() }),
  achieved: z
    .object({ precision: z.number(), lower95: z.number(), coverage: z.number(), n: z.int() })
    .nullable(),
  nearThresholdMass: z.number().nullable(),
  basis: z.object({ labeled: z.int(), decisions: z.int() }),
  warnings: z.array(z.string()),
});
export type ThresholdRecommendation = z.infer<typeof ThresholdRecommendationSchema>;
