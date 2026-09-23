// jev components (JEV_ENGINEERING.md §17, J-17). Every export here is re-exported from @flowaid/ui.
// Presentational only: view types mirror the addendum's schemas locally (./types), so this
// group does not depend on @flowaid/jev.
export type * from "./types";
export {
  JEV_LIMITS,
  CONSEQUENCE_ORDER,
  CONFIGURABLE_CONSEQUENCES,
  CONSEQUENCE_LABEL,
  CONSEQUENCE_MEANING,
  ROUTE_ORDER,
  ROUTE_LABEL,
  ROUTE_TONE,
  DISPOSITION_LABEL,
  ILLUSTRATIVE_THRESHOLDS,
  ROUTE_REASON_LABEL,
  IMPROVE_ACTION_LABEL,
  DRIFT_ALARM_LABEL,
  INSPECT_FIRST_LABEL,
  consequenceRank,
  maxConsequence,
  contractLabel,
  type JevTone,
} from "./vocabulary";
export {
  JEV_RESERVED_PORTS,
  validateContract,
  validateZones,
  contractOutcomes,
  escapeKeys,
  reachableConsequences,
  menuSize as contractMenuSize,
  contractSummary,
  descriptionSimilarity,
  issuesAt as contractIssuesAt,
  type ContractIssue,
  type ContractIssueSeverity,
} from "./contract";
export {
  ROUTING_CELL_LABEL,
  ROUTING_CELL_DESCRIPTION,
  ROUTING_CELL_ROUTE,
  effectiveZones,
  routingCell,
  routingMatrix,
  cellCoverage,
  previewRoute,
  type RoutingCell,
  type RoutingSegment,
  type RoutingMatrixRow,
  type EffectiveZones,
  type RoutePreviewInput,
  type RoutePreview,
} from "./routing";
export {
  canonicalJson,
  estimatePacketTokens,
  tokenBudget,
  packetSections,
  evidenceAgeMs,
  PACKET_SECTION_ORDER,
  PACKET_SECTION_LABEL,
  type TokenBudget,
  type BudgetStatus,
  type PacketSection,
  type PacketSectionKey,
} from "./packet";
export {
  summarizeShadowComparisons,
  matrixCount as shadowMatrixCount,
  compareEconomics,
  type ShadowSummary,
  type SideAccuracy,
  type EconomicsComparison,
} from "./shadow";
export { toCalibrationBins, eceTone, sortAlarms, ECE_TARGET } from "./calibration";
export {
  splitMenu,
  menuFunnel,
  menuFreshness,
  menuHeadroom,
  type MenuSplit,
  type FunnelStep,
  type MenuFreshness,
} from "./menu";
export {
  receiptTimeline,
  distributionMargin,
  authorizedActionLabel,
  RECEIPT_STAGE_LABEL,
  type ReceiptStage,
  type ReceiptStepKind,
  type ReceiptTimelineStep,
} from "./receipt";

export {
  ConsequenceBadge,
  RouteChip,
  ContractRefChip,
  type ConsequenceBadgeProps,
  type RouteChipProps,
  type ContractRefChipProps,
} from "./badges";
export {
  DecisionContractCard,
  type DecisionContractCardProps,
  type DecisionContractStats,
} from "./DecisionContractCard";
export { DecisionContractEditor, type DecisionContractEditorProps } from "./DecisionContractEditor";
export {
  EvidencePacketView,
  TokenBudgetMeter,
  type EvidencePacketViewProps,
  type TokenBudgetMeterProps,
} from "./EvidencePacketView";
export { RoutingPolicyEditor, type RoutingPolicyEditorProps } from "./RoutingPolicyEditor";
export { DecisionReceiptView, type DecisionReceiptViewProps } from "./DecisionReceiptView";
export { ShadowModeReport, type ShadowModeReportProps } from "./ShadowModeReport";
export { CalibrationPanel, type CalibrationPanelProps } from "./CalibrationPanel";
export { LiveMenuPreview, type LiveMenuPreviewProps } from "./LiveMenuPreview";
