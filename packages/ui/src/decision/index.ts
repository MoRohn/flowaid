// decision components. Every export here is re-exported from @flowaid/ui.
export {
  normalizeDistribution,
  argmax as distributionArgmax,
  rampVar as probabilityRampVar,
  scoreLevels,
  scoreLegend,
  scoreReadout,
  noulReadout,
  noulProbability,
  decisionSummary,
  type DistributionEntry,
  type DistributionInput,
  type NormalizeOptions,
} from "./distribution";
export {
  GATE_LABEL,
  GATE_TONE,
  GATE_ORDER,
  gateColorVar,
  gateSoftVar,
  gateDescription,
  clampThresholds,
  validateThresholds,
  gateShares,
  gateModel,
  histogramBins as confidenceHistogramBins,
  type GateTone,
  type GateModel,
} from "./gate";

export {
  ProbabilityRuler,
  type ProbabilityRulerProps,
  type ProbabilityRulerSize,
} from "./ProbabilityRuler";
export { DistributionList, type DistributionListProps } from "./DistributionList";
export {
  ConfidenceMeter,
  GateBadge,
  type ConfidenceMeterProps,
  type ConfidenceMeterSize,
} from "./ConfidenceMeter";
export { ConfidenceSparkbar, type ConfidenceSparkbarProps } from "./ConfidenceSparkbar";
export { NoulGauge, noulIsUndecided, type NoulGaugeProps } from "./NoulGauge";
export {
  ScoreScale,
  scorePointerFraction,
  scoreLevelIndex,
  type ScoreScaleProps,
} from "./ScoreScale";
export { DecisionBadge, decisionTooltipRows, type DecisionBadgeProps } from "./DecisionBadge";
export {
  FailoverNotice,
  failoverSentence,
  failoverFromAttempts,
  attemptReason,
  type FailoverNoticeProps,
} from "./FailoverNotice";
export { DecisionCard, DecisionVisual, type DecisionCardProps } from "./DecisionCard";
export {
  DecisionBundle,
  bundleCost as decisionBundleCost,
  type DecisionBundleProps,
  type DecisionBundleItem,
} from "./DecisionBundle";
export { ConfidenceGateEditor, type ConfidenceGateEditorProps } from "./ConfidenceGateEditor";
export {
  CalibrationChart,
  expectedCalibrationError,
  type CalibrationChartProps,
  type CalibrationBin,
} from "./CalibrationChart";
export {
  DistributionPopover,
  DistributionPanel,
  type DistributionPopoverProps,
} from "./DistributionPopover";
export {
  ConfusionMatrix,
  confusionModel,
  type ConfusionMatrixProps,
  type ConfusionModel,
  type ConfusionPair,
} from "./ConfusionMatrix";
