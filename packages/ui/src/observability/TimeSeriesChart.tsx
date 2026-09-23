import {
  forwardRef,
  useCallback,
  useId,
  useMemo,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  area as d3Area,
  curveLinear,
  curveMonotoneX,
  curveStepAfter,
  line as d3Line,
} from "d3-shape";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { GridLines, SrTable, XAxis, YAxis, measureGutter } from "./axes";
import { ChartTooltip, type ChartTooltipRow } from "./ChartTooltip";
import {
  extent,
  formatAxisTick,
  formatUnitValue,
  makeLinearScale,
  nearestIndex,
  niceDomain,
  seriesColor,
  stackSeries,
  timeTicks,
  type ChartUnit,
} from "./chartMath";

export interface TimeSeriesData {
  id: string;
  label: string;
  /** One value per timestamp; NaN leaves a gap. */
  values: readonly number[];
  /** CSS colour; defaults to the fixed series slot for its index. */
  color?: string;
}

export interface TimeSeriesChartProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Shared x positions in epoch ms, ascending. */
  timestamps: readonly number[];
  series: readonly TimeSeriesData[];
  /** Plot size in px, usually from `ChartFrame`'s render prop. */
  width: number;
  height: number;
  unit?: ChartUnit;
  /** Fill under each line at 10% opacity. */
  area?: boolean;
  /** Stack series bottom-up (implies `area`). */
  stacked?: boolean;
  curve?: "monotone" | "linear" | "step";
  /** Fixed y domain; defaults to a nice extent that includes zero. */
  yDomain?: [number, number];
  /** Series ids to hide (legend toggles). */
  hiddenSeries?: readonly string[];
  /** Custom tooltip value formatting. */
  formatValue?: (value: number) => string;
  /** Label the last point of each series at the right edge. */
  endLabels?: boolean;
  /** Fires with the hovered/focused index, or null when the pointer leaves. */
  onActiveChange?: (index: number | null) => void;
  /** Describes the chart for assistive tech. */
  label?: string;
}

const CURVES = { monotone: curveMonotoneX, linear: curveLinear, step: curveStepAfter } as const;

/**
 * Multi-series line/area chart over time. One y axis (never two), a nice
 * time axis whose label format adapts to the span, a crosshair that snaps to
 * the nearest timestamp, and a single tooltip that lists every series. The
 * plot is keyboard focusable: arrow keys walk the timestamps, Escape clears.
 */
export const TimeSeriesChart = forwardRef<HTMLDivElement, TimeSeriesChartProps>(
  function TimeSeriesChart(
    {
      timestamps,
      series,
      width,
      height,
      unit = "count",
      area = false,
      stacked = false,
      curve = "monotone",
      yDomain,
      hiddenSeries = [],
      formatValue,
      endLabels = false,
      onActiveChange,
      label,
      className,
      ...rest
    },
    ref,
  ) {
    const reduced = useReducedMotion();
    const clipId = useId();
    const [active, setActive] = useState<number | null>(null);
    const [pointerY, setPointerY] = useState<number | null>(null);
    const fmt = formatValue ?? ((v: number) => formatUnitValue(v, unit));
    const fill = stacked || area;

    const visible = useMemo(
      () =>
        series
          .map((s, i) => ({ ...s, color: s.color ?? seriesColor(i), slot: i }))
          .filter((s) => !hiddenSeries.includes(s.id)),
      [series, hiddenSeries],
    );
    const accessibleLabel =
      label ?? `${visible.map((s) => s.label).join(", ")} ${stacked ? "stacked " : ""}over time`;

    const stacks = useMemo(
      () => (stacked ? stackSeries(visible.map((s) => s.values)) : null),
      [stacked, visible],
    );

    const domain = useMemo<[number, number]>(() => {
      if (yDomain) return yDomain;
      if (stacks) {
        const tops = stacks.flatMap((s) => s.map((p) => p.y1));
        return niceDomain(0, extent(tops)[1]);
      }
      const all = visible.flatMap((s) => [...s.values]);
      const [lo, hi] = extent(all);
      return niceDomain(Math.min(0, lo), hi);
    }, [yDomain, stacks, visible]);

    const yTicksRaw = useMemo(() => {
      const s = makeLinearScale(domain, [0, 1], false);
      return s.ticks(4);
    }, [domain]);
    const yLabels = yTicksRaw.map((t) => formatAxisTick(t, unit));
    const margin = {
      top: 10,
      right: endLabels ? 56 : 12,
      bottom: 22,
      left: measureGutter(yLabels),
    };
    const plotW = Math.max(0, width - margin.left - margin.right);
    const plotH = Math.max(0, height - margin.top - margin.bottom);

    const t0 = timestamps[0] ?? 0;
    const t1 = timestamps[timestamps.length - 1] ?? t0 + 1;
    const x = makeLinearScale(
      [t0, t1 === t0 ? t0 + 1 : t1],
      [margin.left, margin.left + plotW],
      false,
    );
    const y = makeLinearScale(domain, [margin.top + plotH, margin.top], false);
    const xt = timeTicks([t0, t1], plotW);
    const curveFn = CURVES[curve];

    const paths = useMemo(() => {
      return visible.map((s, si) => {
        const pts = timestamps.map((t, i) => {
          const raw = s.values[i];
          const v = raw === undefined || !Number.isFinite(raw) ? null : raw;
          const st = stacks?.[si]?.[i];
          return { x: x(t), y1: v === null ? null : st ? st.y1 : v, y0: st ? st.y0 : domain[0] };
        });
        type P = (typeof pts)[number];
        const lineGen = d3Line<P>()
          .defined((p) => p.y1 !== null)
          .x((p) => p.x)
          .y((p) => y(p.y1 ?? 0))
          .curve(curveFn);
        const areaGen = d3Area<P>()
          .defined((p) => p.y1 !== null)
          .x((p) => p.x)
          .y0((p) => y(p.y0))
          .y1((p) => y(p.y1 ?? 0))
          .curve(curveFn);
        const lastDefined = [...pts].reverse().find((p) => p.y1 !== null);
        return {
          id: s.id,
          color: s.color,
          line: lineGen(pts) ?? "",
          area: fill ? (areaGen(pts) ?? "") : "",
          end: lastDefined ? { x: lastDefined.x, y: y(lastDefined.y1 ?? 0) } : null,
        };
      });
    }, [visible, timestamps, stacks, x, y, curveFn, fill, domain]);

    const update = useCallback(
      (index: number | null) => {
        setActive(index);
        onActiveChange?.(index);
      },
      [onActiveChange],
    );

    const onPointerMove = (e: PointerEvent<SVGRectElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const px = e.clientX - rect.left + margin.left;
      const py = e.clientY - rect.top + margin.top;
      const t = x.invert(px);
      const i = nearestIndex(timestamps, t);
      setPointerY(py);
      if (i !== active) update(i);
    };
    const onLeave = () => {
      setPointerY(null);
      update(null);
    };
    const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
      const n = timestamps.length;
      if (n === 0) return;
      const cur = active ?? n - 1;
      let next: number | null = cur;
      if (e.key === "ArrowLeft") next = Math.max(0, cur - 1);
      else if (e.key === "ArrowRight") next = Math.min(n - 1, cur + 1);
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = n - 1;
      else if (e.key === "Escape") next = null;
      else return;
      e.preventDefault();
      setPointerY(null);
      update(next);
    };

    const activeTs = active === null ? undefined : timestamps[active];
    const rows: ChartTooltipRow[] =
      active === null
        ? []
        : visible.map((s) => {
            const v = s.values[active];
            return {
              id: s.id,
              label: s.label,
              value: v === undefined || !Number.isFinite(v) ? "—" : fmt(v),
              color: s.color,
              swatch: fill ? "rect" : "line",
            };
          });
    const total =
      stacked && active !== null
        ? visible.reduce(
            (acc, s) =>
              acc + (Number.isFinite(s.values[active] ?? Number.NaN) ? (s.values[active] ?? 0) : 0),
            0,
          )
        : null;

    const anchorX = activeTs === undefined ? 0 : x(activeTs);
    const anchorY = pointerY ?? margin.top + plotH / 2;
    const drawTransition = reduced ? { duration: 0 } : { duration: 0.6, ease: "easeOut" as const };

    return (
      <div
        ref={ref}
        className={cn("relative select-none", className)}
        style={{ width, height }}
        {...rest}
      >
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={accessibleLabel}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => update(null)}
          className="block overflow-visible rounded-sm outline-none focus-visible:shadow-(--focus)"
        >
          <title>{accessibleLabel}</title>
          <defs>
            <clipPath id={clipId}>
              <rect x={margin.left} y={margin.top - 2} width={plotW} height={plotH + 4} />
            </clipPath>
          </defs>
          <GridLines ticks={yTicksRaw} scale={y} x0={margin.left} x1={margin.left + plotW} />
          <YAxis
            ticks={yTicksRaw}
            scale={y}
            x={margin.left - 6}
            format={(t) => formatAxisTick(t, unit)}
          />
          <XAxis ticks={xt.ticks} scale={x} y={height - 6} format={xt.format} />
          <g clipPath={`url(#${clipId})`}>
            {paths.map((p) => (
              <g key={p.id}>
                {fill ? (
                  <motion.path
                    d={p.area}
                    fill={p.color}
                    fillOpacity={stacked ? 0.78 : 0.1}
                    initial={reduced ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={drawTransition}
                  />
                ) : null}
                <motion.path
                  d={p.line}
                  fill="none"
                  stroke={stacked ? "var(--surface)" : p.color}
                  strokeWidth={stacked ? 1.5 : 2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  initial={reduced || stacked ? false : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={drawTransition}
                />
              </g>
            ))}
          </g>
          {endLabels
            ? paths.map((p) =>
                p.end ? (
                  <text
                    key={`end-${p.id}`}
                    x={p.end.x + 8}
                    y={p.end.y}
                    dy="0.32em"
                    className="font-mono text-2xs tabular"
                    fill="var(--ink-2)"
                  >
                    {fmt(visible.find((s) => s.id === p.id)?.values.at(-1) ?? Number.NaN)}
                  </text>
                ) : null,
              )
            : null}
          {activeTs !== undefined ? (
            <g aria-hidden="true">
              <line
                x1={anchorX}
                x2={anchorX}
                y1={margin.top}
                y2={margin.top + plotH}
                stroke="var(--border-strong)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              {visible.map((s, si) => {
                const v = s.values[active ?? 0];
                if (v === undefined || !Number.isFinite(v)) return null;
                const st = stacks?.[si]?.[active ?? 0];
                const cy = y(st ? st.y1 : v);
                return (
                  <circle
                    key={s.id}
                    cx={anchorX}
                    cy={cy}
                    r={4}
                    fill={s.color}
                    stroke="var(--surface)"
                    strokeWidth={2}
                    paintOrder="stroke"
                  />
                );
              })}
            </g>
          ) : null}
          <rect
            x={margin.left}
            y={margin.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={onPointerMove}
            onPointerLeave={onLeave}
            style={{ cursor: "crosshair", touchAction: "none" }}
          />
        </svg>
        {active !== null && activeTs !== undefined ? (
          <ChartTooltip
            x={anchorX}
            y={anchorY}
            bounds={{ width, height }}
            title={formatTimestamp(activeTs, xt.step)}
            rows={rows}
            footer={total !== null ? `Total ${fmt(total)}` : undefined}
          />
        ) : null}
        <div className="sr-only" aria-live="polite">
          {active !== null && activeTs !== undefined
            ? `${formatTimestamp(activeTs, xt.step)}: ${visible
                .map((s) => {
                  const v = s.values[active];
                  return `${s.label} ${v === undefined || !Number.isFinite(v) ? "no data" : fmt(v)}`;
                })
                .join(", ")}`
            : null}
        </div>
        <SrTable
          caption={label ?? "Time series values"}
          head={["Time", ...visible.map((s) => s.label)]}
          rows={timestamps.map((t, i) => [
            formatTimestamp(t, xt.step),
            ...visible.map((s) => {
              const v = s.values[i];
              return v === undefined || !Number.isFinite(v) ? "—" : fmt(v);
            }),
          ])}
        />
      </div>
    );
  },
);

/** Tooltip title: date + time for hourly data, date only for daily. */
export function formatTimestamp(t: number, step: "minute" | "hour" | "day" | "month"): string {
  const d = new Date(t);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const date = `${d.getDate()} ${months[d.getMonth()] ?? ""}`;
  if (step === "month") return `${months[d.getMonth()] ?? ""} ${d.getFullYear()}`;
  if (step === "day") return `${date} ${d.getFullYear()}`;
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${date} ${hh}:${mm}`;
}
