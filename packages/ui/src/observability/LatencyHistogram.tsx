import { forwardRef, useMemo, useState, type HTMLAttributes } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import { GridLines, SrTable, XAxis, YAxis, measureGutter, roundedBarPath } from "./axes";
import { ChartTooltip } from "./ChartTooltip";
import {
  DEFAULT_SERIES_COLOR,
  binValues,
  extent,
  formatAxisTick,
  makeLinearScale,
  makeLogScale,
  niceDomain,
  percentile,
  type HistogramBin,
} from "./chartMath";

export interface LatencyHistogramProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Raw latency samples in ms. */
  values: readonly number[];
  width: number;
  height: number;
  bins?: number;
  /** Log10 x axis: the usual choice for latency's long tail. */
  log?: boolean;
  /** Percentiles to mark, default P50 / P95 / P99. */
  percentiles?: readonly number[];
  /** Bar colour; defaults to graphite (`--ink-2`). */
  color?: string;
  label?: string;
}

/**
 * Latency distribution with P50/P95/P99 markers. Bins are equal-width in
 * linear or log space; each marker is a hairline labelled in mono above the
 * plot. Hovering a bin shows its range and count.
 */
export const LatencyHistogram = forwardRef<HTMLDivElement, LatencyHistogramProps>(
  function LatencyHistogram(
    {
      values,
      width,
      height,
      bins = 24,
      log = false,
      percentiles = [50, 95, 99],
      color = DEFAULT_SERIES_COLOR,
      label,
      className,
      ...rest
    },
    ref,
  ) {
    const reduced = useReducedMotion();
    const [active, setActive] = useState<number | null>(null);

    const { binned, marks, domain } = useMemo(() => {
      const [lo, hi] = extent(values);
      const dom: [number, number] = log ? [Math.max(1, lo), Math.max(hi, 10)] : [0, hi];
      const b = binValues(values, { bins, domain: dom, log });
      const m = percentiles.map((p) => ({ p, value: percentile(values, p) }));
      return { binned: b, marks: m, domain: dom };
    }, [values, bins, log, percentiles]);

    const maxCount = binned.reduce((m, b) => Math.max(m, b.count), 0);
    const yDomain = niceDomain(0, maxCount);
    const yTicks = makeLinearScale(yDomain, [0, 1], false).ticks(3);
    const margin = {
      top: 22,
      right: 12,
      bottom: 22,
      left: measureGutter(yTicks.map((t) => formatAxisTick(t, "count"))),
    };
    const plotW = Math.max(0, width - margin.left - margin.right);
    const plotH = Math.max(0, height - margin.top - margin.bottom);
    const xRange: [number, number] = [margin.left, margin.left + plotW];
    const x = log ? makeLogScale(domain, xRange) : makeLinearScale(domain, xRange, false);
    const y = makeLinearScale(yDomain, [margin.top + plotH, margin.top], false);
    const xTicks = log ? logTicks(domain) : makeLinearScale(domain, [0, 1], false).ticks(5);
    const transition = reduced ? { duration: 0 } : { duration: 0.45, ease: "easeOut" as const };
    const activeBin: HistogramBin | undefined = active === null ? undefined : binned[active];
    const markLabels = packLabels(
      marks
        .filter((m) => Number.isFinite(m.value))
        .map((m) => ({
          key: m.p,
          x: x(Math.max(m.value, domain[0])),
          text: `P${m.p} ${formatMs(m.value)}`,
        })),
      margin.left,
      margin.left + plotW,
    );

    return (
      <div ref={ref} className={cn("relative", className)} style={{ width, height }} {...rest}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          // One list item per bin (focusable when it holds samples), like BarChart: a
          // role="img" graphic may not contain focusable, labelled parts.
          role="list"
          aria-label={
            label ??
            `Latency distribution, ${marks.map((m) => `P${m.p} ${formatMs(m.value)}`).join(", ")}`
          }
          className="block overflow-visible"
        >
          <GridLines ticks={yTicks} scale={y} x0={margin.left} x1={margin.left + plotW} />
          <YAxis
            ticks={yTicks}
            scale={y}
            x={margin.left - 6}
            format={(t) => formatAxisTick(t, "count")}
          />
          <XAxis ticks={xTicks} scale={x} y={height - 6} format={(t) => formatAxisTick(t, "ms")} />
          {binned.map((b, i) => {
            const x0 = x(b.x0);
            const x1 = x(b.x1);
            const w = Math.max(0, x1 - x0 - 2);
            const top = y(b.count);
            const h = Math.max(0, y(0) - top);
            const isActive = active === i;
            return (
              <g
                key={i}
                role="listitem"
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                tabIndex={b.count > 0 ? 0 : -1}
                aria-label={`${formatMs(b.x0)} to ${formatMs(b.x1)}: ${b.count}`}
                className="outline-none"
              >
                <rect
                  x={x0}
                  y={margin.top}
                  width={Math.max(0, x1 - x0)}
                  height={plotH}
                  fill="transparent"
                />
                {h > 0 ? (
                  <motion.path
                    d={roundedBarPath(x0 + 1, top, w, h, "vertical", 3)}
                    fill={color}
                    initial={reduced ? false : { opacity: 0 }}
                    animate={{ opacity: isActive ? 0.8 : 1 }}
                    transition={transition}
                  />
                ) : null}
              </g>
            );
          })}
          <g aria-hidden="true">
            {markLabels.map((m) => (
              <g key={m.key}>
                <line
                  x1={m.x}
                  x2={m.x}
                  y1={margin.top - 4}
                  y2={margin.top + plotH}
                  stroke="var(--ink-2)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <text
                  x={m.labelX}
                  y={margin.top - 9}
                  textAnchor="start"
                  className="font-mono text-2xs tabular"
                  fill="var(--ink)"
                >
                  {m.text}
                </text>
              </g>
            ))}
          </g>
        </svg>
        {activeBin && active !== null ? (
          <ChartTooltip
            x={(x(activeBin.x0) + x(activeBin.x1)) / 2}
            y={y(activeBin.count)}
            bounds={{ width, height }}
            side="top"
            title={`${formatMs(activeBin.x0)} – ${formatMs(activeBin.x1)}`}
            rows={[
              {
                id: "count",
                label: "Requests",
                value: activeBin.count.toLocaleString("en"),
                color,
                swatch: "rect",
              },
              {
                id: "share",
                label: "Share",
                value: values.length
                  ? `${((activeBin.count / values.length) * 100).toFixed(1)}%`
                  : "—",
                swatch: "none",
              },
            ]}
          />
        ) : null}
        <SrTable
          caption={label ?? "Latency histogram"}
          head={["From", "To", "Requests"]}
          rows={binned.map((b) => [formatMs(b.x0), formatMs(b.x1), b.count])}
        />
      </div>
    );
  },
);

export interface PackedLabel {
  key: string | number;
  x: number;
  text: string;
  /** Left edge of the label after collision resolution. */
  labelX: number;
}

/**
 * Lay out marker labels along one row without overlap: each label starts at
 * its marker, is pushed right past the previous label when they collide, and
 * the whole chain slides left when it would overflow the right edge.
 */
export function packLabels(
  marks: ReadonlyArray<{ key: string | number; x: number; text: string }>,
  minX: number,
  maxX: number,
  charWidth = 6.6,
  gap = 8,
): PackedLabel[] {
  const sorted = [...marks].sort((a, b) => a.x - b.x);
  const widths = sorted.map((m) => m.text.length * charWidth);
  const xs: number[] = [];
  sorted.forEach((m, i) => {
    const prevEnd = i === 0 ? -Infinity : (xs[i - 1] ?? 0) + (widths[i - 1] ?? 0) + gap;
    xs.push(Math.max(m.x + 4, prevEnd));
  });
  const lastIndex = sorted.length - 1;
  const overflow = lastIndex >= 0 ? (xs[lastIndex] ?? 0) + (widths[lastIndex] ?? 0) - maxX : 0;
  if (overflow > 0) {
    for (let i = lastIndex; i >= 0; i--) {
      const wanted = (xs[i] ?? 0) - overflow;
      const nextStart = i === lastIndex ? Infinity : (xs[i + 1] ?? 0) - gap - (widths[i] ?? 0);
      xs[i] = Math.max(minX, Math.min(wanted, nextStart));
    }
  }
  return sorted.map((m, i) => ({ ...m, labelX: xs[i] ?? m.x }));
}

/** 1-2-5 ticks across a log domain, e.g. 100, 200, 500, 1000, 2000 … */
export function logTicks([lo, hi]: [number, number]): number[] {
  const out: number[] = [];
  const start = Math.floor(Math.log10(Math.max(lo, 1e-9)));
  const end = Math.ceil(Math.log10(Math.max(hi, 1e-9)));
  for (let e = start; e <= end; e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= lo && v <= hi) out.push(v);
    }
  }
  return out;
}
