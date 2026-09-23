// observability components. Every export here is re-exported from @flowaid/ui.
export {
  DECISION_SERIES_COLOR,
  DEFAULT_SERIES_COLOR,
  SERIES_COLORS,
  binValues,
  confidenceZoneCounts,
  deltaInfo,
  extent,
  formatAxisTick,
  formatUnitValue,
  heatRamp,
  heatRampColor,
  makeLinearScale,
  makeLogScale,
  mulberry32,
  nearestIndex,
  niceDomain,
  niceTicks,
  percentile,
  seriesColor,
  stackSeries,
  timeTicks,
  type BinOptions,
  type ChartUnit,
  type DeltaDirection,
  type DeltaInfo,
  type DeltaTone,
  type HistogramBin,
  type NumericScale,
  type RampStop,
  type StackedPoint,
  type TimeTicks,
  type ZoneCounts,
} from "./chartMath";
export { useMeasure, type MeasuredSize } from "./useMeasure";
export {
  ChartTooltip,
  placeTooltip,
  type ChartTooltipProps,
  type ChartTooltipRow,
  type TooltipSwatch,
} from "./ChartTooltip";
export { Legend, LegendSwatch, type LegendItem, type LegendProps } from "./Legend";
export { ChartFrame, type ChartFrameProps } from "./ChartFrame";
export { Sparkline, type SparklineProps } from "./Sparkline";
export {
  MetricTile,
  DeltaChip,
  type MetricTileProps,
  type MetricTileSize,
  type MetricTileDelta,
} from "./MetricTile";
export { MetricsGrid, type MetricsGridProps } from "./MetricsGrid";
export {
  TimeSeriesChart,
  formatTimestamp,
  type TimeSeriesChartProps,
  type TimeSeriesData,
} from "./TimeSeriesChart";
export { StackedAreaChart, type StackedAreaChartProps } from "./StackedAreaChart";
export { BarChart, type BarChartProps, type BarDatum } from "./BarChart";
export {
  StackedBarChart,
  type StackedBarChartProps,
  type StackedBarSeries,
} from "./StackedBarChart";
export {
  LatencyHistogram,
  logTicks,
  packLabels,
  type LatencyHistogramProps,
  type PackedLabel,
} from "./LatencyHistogram";
export {
  ConfidenceHistogram,
  GATE_ZONE,
  type ConfidenceHistogramProps,
} from "./ConfidenceHistogram";
export {
  CalibrationMini,
  type CalibrationMiniProps,
  type CalibrationPoint,
} from "./CalibrationMini";
export { Heatmap, type HeatmapProps } from "./Heatmap";
export {
  ProviderHealthCard,
  type ProviderHealthCardProps,
  type ProviderHealthView,
  type ProviderHealthStatus,
  type ProviderDayStatus,
} from "./ProviderHealthCard";
export {
  DashboardFilters,
  TIME_RANGE_PRESETS,
  type DashboardFiltersProps,
  type DashboardFilterState,
  type DashboardEnvironment,
  type TimeRangePreset,
} from "./DashboardFilters";
