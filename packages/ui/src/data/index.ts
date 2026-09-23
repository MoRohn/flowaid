// data components: lists, tables and the JSON/diff viewers. Every export here is re-exported from @flowaid/ui.

export { JsonView, buildJsonPath, type JsonViewProps, type JsonPathSegment } from "./JsonView";
export { DiffView, toDiffText, type DiffViewProps, type DiffMode } from "./DiffView";
export {
  diffTextLines,
  diffSequences,
  diffStats,
  diffTokens,
  chunkDiff,
  toSplitRows,
  splitLines,
  tokenize,
  type DiffOp,
  type DiffOpType,
  type DiffStats,
  type DiffChunk,
  type SplitRow,
  type TokenSpan,
} from "./textDiff";

export {
  DataTable,
  dataTableFeatures,
  createDataTableColumns,
  DATA_TABLE_ROW_HEIGHT,
  DATA_TABLE_SELECT_COLUMN,
  type DataTableProps,
  type DataTableFeatures,
  type DataTableColumns,
  type DataTableColumnMeta,
  type DataTableDensity,
  type DataTableErrorState,
  type DataTableSelection,
  type DataTablePaginationOptions,
  type DataTableRow,
  type DataTableCell,
  type DataTableHeader,
} from "./DataTable";
export { SortableHeader, type SortableHeaderProps, type SortDirection } from "./SortableHeader";
export {
  Pagination,
  pageRange,
  formatPageRange,
  type PaginationProps,
  type PageRange,
} from "./Pagination";
export {
  RelativeTime,
  formatRelativeTime,
  formatAbsoluteTime,
  relativeTimeRefreshMs,
  useRelativeTime,
  useNowTick,
  type RelativeTimeProps,
  type RelativeTimeStyle,
} from "./RelativeTime";
export {
  DateRangePicker,
  DateRangePanel,
  RangeCalendar,
  DATE_RANGE_PRESETS,
  resolveDateRange,
  customDateRange,
  formatDateRangeLabel,
  serializeDateRangeValue,
  parseDateRangeValue,
  isDateRangePresetKey,
  type DateRangePickerProps,
  type DateRangePanelProps,
  type RangeCalendarProps,
  type DateRangeValue,
  type DateRangePreset,
  type DateRangePresetKey,
  type ResolvedDateRange,
  type DayRange,
} from "./DateRangePicker";
export {
  FilterBar,
  serializeFilters,
  parseFilters,
  normalizeFilters,
  countActiveFilters,
  applyRunFilters,
  FACET_LABEL,
  RUN_FILTER_FACETS,
  DEFAULT_STATUS_OPTIONS,
  DEFAULT_ORIGIN_OPTIONS,
  environmentOptions,
  type FilterBarProps,
  type FilterBarOptions,
  type FilterFacetOption,
  type RunFilters,
  type RunFilterFacet,
} from "./FilterBar";
export {
  RunsTable,
  RunConfidenceCell,
  ORIGIN_ICON,
  lowestConfidence,
  runIsActive,
  DEFAULT_CONFIDENCE_THRESHOLDS,
  type RunsTableProps,
  type RunConfidenceCellProps,
  type LowestConfidence,
} from "./RunsTable";
export {
  RunsSparkline,
  sparklineGeometry,
  type RunsSparklineProps,
  type SparklineGeometry,
} from "./RunsSparkline";
export {
  WorkflowCard,
  VersionStatusBadge,
  EnvironmentDots,
  environmentAbbreviation,
  VERSION_STATUS_LABEL,
  type WorkflowCardProps,
  type WorkflowListItemView,
  type WorkflowDeploymentView,
  type WorkflowVersionStatus,
} from "./WorkflowCard";
export {
  WorkflowsTable,
  WorkflowsBrowser,
  WorkflowsViewToggle,
  type WorkflowsTableProps,
  type WorkflowsBrowserProps,
  type WorkflowsViewToggleProps,
  type WorkflowsView,
} from "./WorkflowsTable";
export {
  CredentialsTable,
  ScopeChips,
  type CredentialsTableProps,
  type CredentialListItemView,
  type CredentialStatus,
} from "./CredentialsTable";
export {
  ApprovalsTable,
  SlaIndicator,
  REVIEW_MODE_LABEL,
  slaStatus,
  formatWaiting,
  type ApprovalsTableProps,
  type PendingApprovalView,
  type SlaStatus,
  type SlaTone,
} from "./ApprovalsTable";
