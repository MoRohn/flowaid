import { forwardRef } from "react";
import { TimeSeriesChart, type TimeSeriesChartProps } from "./TimeSeriesChart";

export type StackedAreaChartProps = Omit<TimeSeriesChartProps, "stacked" | "area">;

/**
 * Stacked area over time (cost by provider, tokens by model). A thin
 * `TimeSeriesChart` preset: layers are stacked bottom-up in series order and
 * separated by a surface-coloured hairline; the tooltip adds a total. The plot is
 * one `role="img"` graphic with a `<title>` (the `label`, or "<series> stacked over
 * time"), and a visually hidden table carries the values.
 */
export const StackedAreaChart = forwardRef<HTMLDivElement, StackedAreaChartProps>(
  function StackedAreaChart({ label, series, ...props }, ref) {
    const accessibleLabel = label ?? `${series.map((s) => s.label).join(", ")} stacked over time`;
    return (
      <TimeSeriesChart ref={ref} stacked area series={series} label={accessibleLabel} {...props} />
    );
  },
);
