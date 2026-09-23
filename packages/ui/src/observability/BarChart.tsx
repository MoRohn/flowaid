import { forwardRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { GridLines, SrTable, XAxis, YAxis, measureGutter, roundedBarPath } from "./axes";
import { ChartTooltip } from "./ChartTooltip";
import {
  DEFAULT_SERIES_COLOR,
  extent,
  formatAxisTick,
  formatUnitValue,
  makeLinearScale,
  niceDomain,
  type ChartUnit,
} from "./chartMath";

export interface BarDatum {
  id: string;
  label: string;
  value: number;
  /** Per-bar colour override (emphasis: one ink bar, the rest ink-4). */
  color?: string;
  /** Extra tooltip line, e.g. a share or a count. */
  note?: ReactNode;
}

export interface BarChartProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  data: readonly BarDatum[];
  width: number;
  height: number;
  orientation?: "vertical" | "horizontal";
  unit?: ChartUnit;
  /** Single-series colour; defaults to graphite (`--ink-2`). Cobalt only for decision data. */
  color?: string;
  /** Show the value at the data end of each bar. Auto hides when it will not fit. */
  valueLabels?: boolean;
  /** Fixed value domain; defaults to a nice [0, max]. */
  domain?: [number, number];
  /** Maximum bar thickness in px (bars never fill the band). */
  maxThickness?: number;
  formatValue?: (value: number) => string;
  onBarSelect?: (datum: BarDatum) => void;
  label?: string;
}

/**
 * Single-series bar chart, vertical (columns) or horizontal (bars). Bars are
 * capped at 24px with a 4px rounded data-end, grow from one baseline and
 * carry their own hover/focus tooltip; each bar is keyboard focusable.
 */
export const BarChart = forwardRef<HTMLDivElement, BarChartProps>(function BarChart(
  {
    data,
    width,
    height,
    orientation = "vertical",
    unit = "count",
    color = DEFAULT_SERIES_COLOR,
    valueLabels = true,
    domain,
    maxThickness = 24,
    formatValue,
    onBarSelect,
    label,
    className,
    ...rest
  },
  ref,
) {
  const reduced = useReducedMotion();
  const [active, setActive] = useState<number | null>(null);
  const fmt = formatValue ?? ((v: number) => formatUnitValue(v, unit));
  const horizontal = orientation === "horizontal";
  const [, maxV] = extent(data.map((d) => d.value));
  const valueDomain = domain ?? niceDomain(0, maxV);
  const vTicks = makeLinearScale(valueDomain, [0, 1], false).ticks(4);
  const vLabels = vTicks.map((t) => formatAxisTick(t, unit));

  const catLabels = data.map((d) => d.label);
  const margin = horizontal
    ? { top: 6, right: 40, bottom: 20, left: measureGutter(catLabels, 40) }
    : { top: valueLabels ? 18 : 10, right: 8, bottom: 22, left: measureGutter(vLabels) };
  const plotW = Math.max(0, width - margin.left - margin.right);
  const plotH = Math.max(0, height - margin.top - margin.bottom);

  const v = horizontal
    ? makeLinearScale(valueDomain, [margin.left, margin.left + plotW], false)
    : makeLinearScale(valueDomain, [margin.top + plotH, margin.top], false);
  const n = Math.max(1, data.length);
  const bandSize = (horizontal ? plotH : plotW) / n;
  const thickness = Math.min(maxThickness, bandSize * 0.64);
  const bandStart = (i: number) =>
    (horizontal ? margin.top : margin.left) + i * bandSize + (bandSize - thickness) / 2;
  const zero = v(Math.max(valueDomain[0], 0));
  const transition = reduced ? { duration: 0 } : { duration: 0.45, ease: "easeOut" as const };

  const activeDatum = active === null ? undefined : data[active];

  return (
    <div ref={ref} className={cn("relative", className)} style={{ width, height }} {...rest}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="list"
        aria-label={label ?? "Bar chart"}
        className="block overflow-visible"
      >
        {horizontal ? (
          <>
            <g aria-hidden="true">
              {vTicks.map((t) => (
                <line
                  key={t}
                  x1={v(t)}
                  x2={v(t)}
                  y1={margin.top}
                  y2={margin.top + plotH}
                  stroke={t === 0 ? "var(--border-strong)" : "var(--border)"}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
              ))}
            </g>
            <XAxis
              ticks={vTicks}
              scale={v}
              y={height - 6}
              format={(t) => formatAxisTick(t, unit)}
            />
            <g aria-hidden="true" className="font-mono text-2xs tabular" fill="var(--ink-2)">
              {data.map((d, i) => (
                <text
                  key={d.id}
                  x={margin.left - 8}
                  y={bandStart(i) + thickness / 2}
                  dy="0.32em"
                  textAnchor="end"
                >
                  {truncate(d.label, Math.floor((margin.left - 8) / 6.6))}
                </text>
              ))}
            </g>
          </>
        ) : (
          <>
            <GridLines ticks={vTicks} scale={v} x0={margin.left} x1={margin.left + plotW} />
            <YAxis
              ticks={vTicks}
              scale={v}
              x={margin.left - 6}
              format={(t) => formatAxisTick(t, unit)}
            />
            <XAxis
              ticks={data.map((_, i) => i)}
              scale={(i) => bandStart(i) + thickness / 2}
              y={height - 6}
              format={(i) => truncate(data[i]?.label ?? "", Math.floor(bandSize / 6.6))}
            />
          </>
        )}
        {data.map((d, i) => {
          const start = bandStart(i);
          const end = v(d.value);
          const barColor = d.color ?? color;
          const isActive = active === i;
          const path = horizontal
            ? roundedBarPath(zero, start, end - zero, thickness, "horizontal")
            : roundedBarPath(start, end, thickness, zero - end, "vertical");
          const hit = horizontal
            ? { x: margin.left, y: start - (bandSize - thickness) / 2, w: plotW, h: bandSize }
            : { x: start - (bandSize - thickness) / 2, y: margin.top, w: bandSize, h: plotH };
          const text = fmt(d.value);
          const fits = horizontal ? true : text.length * 6.6 <= bandSize;
          return (
            <g
              key={d.id}
              role="listitem"
              tabIndex={0}
              aria-label={`${d.label}: ${text}`}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onClick={onBarSelect ? () => onBarSelect(d) : undefined}
              onKeyDown={
                onBarSelect
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onBarSelect(d);
                      }
                    }
                  : undefined
              }
              className={cn("outline-none", onBarSelect && "cursor-pointer")}
            >
              <rect x={hit.x} y={hit.y} width={hit.w} height={hit.h} fill="transparent" />
              <motion.path
                d={path}
                fill={barColor}
                initial={reduced ? false : { opacity: 0, scale: horizontal ? undefined : 1 }}
                animate={{ opacity: isActive ? 0.8 : 1 }}
                transition={transition}
                style={{ transformOrigin: horizontal ? `${zero}px 0px` : `0px ${zero}px` }}
              />
              {isActive ? (
                <path d={path} fill="none" stroke="var(--ink)" strokeWidth={1.5} opacity={0.6} />
              ) : null}
              {valueLabels && fits ? (
                <text
                  x={horizontal ? end + 6 : start + thickness / 2}
                  y={horizontal ? start + thickness / 2 : end - 5}
                  dy={horizontal ? "0.32em" : undefined}
                  textAnchor={horizontal ? "start" : "middle"}
                  className="font-mono text-2xs tabular"
                  fill="var(--ink-2)"
                  aria-hidden="true"
                >
                  {text}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {activeDatum && active !== null ? (
        <ChartTooltip
          x={horizontal ? v(activeDatum.value) : bandStart(active) + thickness / 2}
          y={horizontal ? bandStart(active) + thickness / 2 : v(activeDatum.value)}
          bounds={{ width, height }}
          side={horizontal ? "right" : "top"}
          rows={[
            {
              id: activeDatum.id,
              label: activeDatum.label,
              value: fmt(activeDatum.value),
              color: activeDatum.color ?? color,
              swatch: "rect",
            },
          ]}
          footer={activeDatum.note}
        />
      ) : null}
      <SrTable
        caption={label ?? "Bar chart values"}
        head={["Category", "Value"]}
        rows={data.map((d) => [d.label, fmt(d.value)])}
      />
    </div>
  );
});

function truncate(s: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  return s.length > maxChars ? `${s.slice(0, Math.max(1, maxChars - 1))}…` : s;
}
