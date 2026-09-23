// builder components. Every export here is re-exported from @flowaid/ui.
import "./builder.css";

export {
  MiniGraph,
  layoutMiniGraph,
  type MiniGraphProps,
  type MiniGraphNode,
  type MiniGraphEdge,
  type MiniGraphLayout,
  type MiniGraphLayoutOptions,
  type MiniGraphPosition,
} from "./MiniGraph";
export {
  MetricsDeltaStrip,
  computeMetricDelta,
  type MetricsDeltaStripProps,
  type MetricDelta,
  type MetricDeltaTone,
} from "./MetricsDeltaStrip";
export { ThresholdMeter, type ThresholdMeterProps } from "./ThresholdMeter";
export {
  SideBySideDiff,
  diffLines,
  type SideBySideDiffProps,
  type DiffRow,
} from "./SideBySideDiff";
export { BottomPanel, type BottomPanelProps, type BottomPanelTab } from "./BottomPanel";
export {
  AIBuilderPanel,
  type AIBuilderPanelProps,
  type AIBuilderStatus,
  type BuilderPlan,
  type BuilderPlanDecision,
  type BuilderPlanTool,
  type BuilderPlanRisk,
  type BuilderPlanThreshold,
  type BuilderPlanNode,
  type BuilderPlanEdge,
} from "./AIBuilderPanel";
export {
  WorkflowCriticPanel,
  criticSummary,
  formatSavings,
  CRITIC_CATEGORIES,
  CRITIC_CATEGORY_LABEL,
  type WorkflowCriticPanelProps,
  type CriticSummary,
  type CriticSeverity,
  type CriticCategory,
} from "./WorkflowCriticPanel";
export {
  CostOptimizerPanel,
  totalSavingsPer1k,
  type CostOptimizerPanelProps,
  type CostOptimizationView,
  type CostOptimizationKind,
} from "./CostOptimizerPanel";
export {
  TemplateGallery,
  filterTemplates,
  type TemplateGalleryProps,
  type WorkflowTemplateView,
} from "./TemplateGallery";
export { BUILDER_SAMPLE_TEMPLATES } from "./sampleTemplates";
export { VersionCompare, VersionBadge, type VersionCompareProps } from "./VersionCompare";
export {
  EvaluationReport,
  type EvaluationReportProps,
  type EvaluationGate,
} from "./EvaluationReport";
export {
  ImportDialog,
  type ImportDialogProps,
  type ImportDialogStatus,
  type ImportMigrationReport,
  type ImportNodeReport,
  type ImportNodeStatus,
} from "./ImportDialog";
