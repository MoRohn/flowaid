// inspector components. Every export here is re-exported from @flowaid/ui.
/**
 * `JsonView`, `DiffView` and the text-diff helpers moved to `@flowaid/ui/data`
 * (P0-15). These re-exports keep the old import path working for one release.
 * @deprecated import them from `@flowaid/ui/data`.
 */
export {
  JsonView,
  buildJsonPath,
  DiffView,
  toDiffText,
  diffTextLines,
  diffSequences,
  diffStats,
  diffTokens,
  chunkDiff,
  toSplitRows,
  splitLines,
  tokenize,
  type JsonViewProps,
  type JsonPathSegment,
  type DiffViewProps,
  type DiffMode,
  type DiffOp,
  type DiffOpType,
  type DiffStats,
  type DiffChunk,
  type SplitRow,
  type TokenSpan,
} from "@/data";
export { CodeBlock, type CodeBlockProps, type CodeBlockLanguage } from "./CodeBlock";
export { flowaidCodeMirrorTheme, yamlLanguage } from "./codeMirrorTheme";
export { WorkflowDiffSummary, type WorkflowDiffSummaryProps } from "./WorkflowDiffSummary";
export { KeyValueList, type KeyValueListProps, type KeyValueItem } from "./KeyValueList";
export {
  TimingBreakdown,
  timingSegments,
  type TimingBreakdownProps,
  type TimingSegment,
  type TimingPhase,
  type NodeTiming,
} from "./TimingBreakdown";
export {
  PortTypeLabel,
  portTypeFamily,
  type PortTypeLabelProps,
  type PortTypeFamily,
} from "./PortTypeLabel";
export { SchemaTree, schemaTypeLabel, resolveSchemaRef, type SchemaTreeProps } from "./SchemaTree";
export {
  Inspector,
  DiagnosticList,
  diagnosticLocationLabel,
  INSPECTOR_TABS,
  isInspectorTab,
  type InspectorProps,
  type InspectorTabId,
} from "./Inspector";
export { NodeSummaryStrip, type NodeSummaryStripProps } from "./NodeSummaryStrip";
