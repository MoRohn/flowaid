import { forwardRef, useMemo, useState, type HTMLAttributes } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { GridLines, SrTable, XAxis, YAxis, measureGutter, roundedBarPath } from "./axes";
import { ChartTooltip } from "./ChartTooltip";
import {
  formatAxisTick,
  formatUnitValue,
  makeLinearScale,
  niceDomain,
  seriesColor,
  stackSeries,
  type ChartUnit,
} from "./chartMath";

export interface StackedBarSeries {
  id: string;
  label: string;
  /** One value per category. */
  values: readonly number[];
  color?: string;
}

export interface StackedBarChartProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Category labels along the x axis (days, workflows). */
  categories: readonly string[];
  series: readonly StackedBarSeries[];
  width: number;
  height: number;
  unit?: ChartUnit;
  hiddenSeries?: readonly string[];
  /** Maximum column thickness in px. */
  maxThickness?: number;
  formatValue?: (value: number) => string;
  label?: string;
}

/**
 * Stacked columns, e.g. runs by status per day. Segments stack bottom-up in
 * series order with a 2px surface gap between them and a rounded cap on the
 * top segment. The whole column is the hit target; the tooltip lists every
 * segment and the total.
 */
export const StackedBarChart = forwardRef<HTMLDivElement, StackedBarChartProps>(
  function StackedBarChart(
    {
      categories,
      series,
      width,
      height,
      unit = "count",
      hiddenSeries = [],
      maxThickness = 28,
      formatValue,
      label,
      className,
      ...rest
    },
    ref,
  ) {
    const reduced = useReducedMotion();
    const [active, setActive] = useState<number | null>(null);
    const fmt = formatValue ?? ((v: number) => formatUnitValue(v, unit));

    const visible = useMemo(
      () =>
        series
          .map((s, i) => ({ ...s, color: s.color ?? seriesColor(i) }))
          .filter((s) => !hiddenSeries.includes(s.id)),
      [series, hiddenSeries],
    );
    const stacks = useMemo(() => stackSeries(visible.map((s) => s.values)), [visible]);
    const totals = categories.map((_, i) =>
      visible.reduce((acc, s) => acc + Math.max(0, s.values[i] ?? 0), 0),
    );
    const maxTotal = totals.reduce((m, t) => Math.max(m, t), 0);
    const domain = niceDomain(0, maxTotal);
    const yTicks = makeLinearScale(domain, [0, 1], false).ticks(4);
    const margin = {
      top: 10,
      right: 8,
      bottom: 22,
      left: measureGutter(yTicks.map((t) => formatAxisTick(t, unit))),
    };
    const plotW = Math.max(0, width - margin.left - margin.right);
    const plotH = Math.max(0, height - margin.top - margin.bottom);
    const y = makeLinearScale(domain, [margin.top + plotH, margin.top], false);
    const n = Math.max(1, categories.length);
    const band = plotW / n;
    const thickness = Math.min(maxThickness, band * 0.6);
    const xStart = (i: number) => margin.left + i * band + (band - thickness) / 2;
    const transition = reduced ? { duration: 0 } : { duration: 0.45, ease: "easeOut" as const };
    const labelEvery = Math.max(1, Math.ceil(52 / band));

    return (
      <div ref={ref} className={cn("relative", className)} style={{ width, height }} {...rest}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="list"
          aria-label={label ?? "Stacked bar chart"}
          className="block overflow-visible"
        >
          <GridLines ticks={yTicks} scale={y} x0={margin.left} x1={margin.left + plotW} />
          <YAxis
            ticks={yTicks}
            scale={y}
            x={margin.left - 6}
            format={(t) => formatAxisTick(t, unit)}
          />
          <XAxis
            ticks={categories.map((_, i) => i).filter((i) => i % labelEvery === 0)}
            scale={(i) => xStart(i) + thickness / 2}
            y={height - 6}
            format={(i) => categories[i] ?? ""}
          />
          {categories.map((cat, ci) => {
            const isActive = active === ci;
            const segments = visible
              .map((s, si) => {
                const st = stacks[si]?.[ci];
                if (!st || st.y1 === st.y0) return null;
                return { s, st };
              })
              .filter((x): x is NonNullable<typeof x> => x !== null);
            const topIndex = segments.length - 1;
            return (
              <g
                key={cat}
                role="listitem"
                tabIndex={0}
                aria-label={`${cat}: ${fmt(totals[ci] ?? 0)} total`}
                onFocus={() => setActive(ci)}
                onBlur={() => setActive(null)}
                onPointerEnter={() => setActive(ci)}
                onPointerLeave={() => setActive(null)}
                className="outline-none"
              >
                <rect
                  x={margin.left + ci * band}
                  y={margin.top}
                  width={band}
                  height={plotH}
                  fill={isActive ? "var(--surface-3)" : "transparent"}
                  rx={3}
                />
                {segments.map(({ s, st }, k) => {
                  const top = y(st.y1);
                  const bottom = y(st.y0);
                  // 2px surface gap between segments: shave the top of every segment except the cap.
                  const gap = k === topIndex ? 0 : 2;
                  const h = Math.max(0, bottom - top - gap);
                  const d =
                    k === topIndex
                      ? roundedBarPath(xStart(ci), top, thickness, h, "vertical")
                      : `M${xStart(ci)},${top + gap}h${thickness}v${h}h${-thickness}Z`;
                  return (
                    <motion.path
                      key={s.id}
                      d={d}
                      fill={s.color}
                      initial={reduced ? false : { opacity: 0 }}
                      animate={{ opacity: isActive ? 0.85 : 1 }}
                      transition={transition}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
        {active !== null ? (
          <ChartTooltip
            x={xStart(active) + thickness / 2}
            y={y(totals[active] ?? 0)}
            bounds={{ width, height }}
            side="top"
            title={categories[active]}
            rows={[...visible].reverse().map((s) => ({
              id: s.id,
              label: s.label,
              value: fmt(s.values[active] ?? 0),
              color: s.color,
              swatch: "rect" as const,
              muted: (s.values[active] ?? 0) === 0,
            }))}
            footer={`Total ${fmt(totals[active] ?? 0)}`}
          />
        ) : null}
        <SrTable
          caption={label ?? "Stacked bar values"}
          head={["Category", ...visible.map((s) => s.label), "Total"]}
          rows={categories.map((c, i) => [
            c,
            ...visible.map((s) => fmt(s.values[i] ?? 0)),
            fmt(totals[i] ?? 0),
          ])}
        />
      </div>
    );
  },
);
