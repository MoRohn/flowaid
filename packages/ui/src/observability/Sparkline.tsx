import { forwardRef, useId, type SVGAttributes } from "react";
import { area as d3Area, curveLinear, curveMonotoneX, line as d3Line } from "d3-shape";
import { cn } from "@/lib/cn";
import { DEFAULT_SERIES_COLOR, extent, makeLinearScale } from "./chartMath";

export interface SparklineProps extends Omit<
  SVGAttributes<SVGSVGElement>,
  "children" | "width" | "height"
> {
  data: readonly number[];
  width?: number;
  height?: number;
  /** CSS colour of the line; defaults to graphite (`--ink-2`). Cobalt only for decision data. */
  color?: string;
  /** Fill the area under the line at 10% opacity. */
  area?: boolean;
  /** Horizontal reference drawn as a hairline (a target, the previous period's mean). */
  baseline?: number;
  /** Mark the last point with a ring-outlined dot. */
  endDot?: boolean;
  /** Fix the y domain (e.g. [0, 1] for rates); defaults to the data extent with a little headroom. */
  domain?: [number, number];
  curve?: "monotone" | "linear";
  strokeWidth?: number;
  /** Accessible description; the sparkline is otherwise decorative. */
  label?: string;
}

/**
 * Minimal trend line for tiles and table cells. No axes, no labels: it shows
 * shape, not values. The end dot carries a 2px surface ring so it stays
 * legible on top of the line.
 */
export const Sparkline = forwardRef<SVGSVGElement, SparklineProps>(function Sparkline(
  {
    data,
    width = 96,
    height = 28,
    color = DEFAULT_SERIES_COLOR,
    area = false,
    baseline,
    endDot = true,
    domain,
    curve = "monotone",
    strokeWidth = 1.5,
    label,
    className,
    ...rest
  },
  ref,
) {
  const gradientId = useId();
  const pad = 3;
  const n = data.length;
  const [lo, hi] = domain ?? padDomain(extent(data), baseline);
  const x = makeLinearScale([0, Math.max(1, n - 1)], [pad, width - pad], false);
  const y = makeLinearScale([lo, hi], [height - pad, pad], false);
  const points = data.map((v, i) => [x(i), y(v)] as [number, number]);
  const curveFn = curve === "linear" ? curveLinear : curveMonotoneX;
  const linePath =
    d3Line<[number, number]>()
      .x((d) => d[0])
      .y((d) => d[1])
      .curve(curveFn)(points) ?? "";
  const areaPath = area
    ? (d3Area<[number, number]>()
        .x((d) => d[0])
        .y0(height - pad)
        .y1((d) => d[1])
        .curve(curveFn)(points) ?? "")
    : "";
  const last = points[points.length - 1];

  return (
    <svg
      ref={ref}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={label ? "img" : "presentation"}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("shrink-0 overflow-visible", className)}
      {...rest}
    >
      {area && n > 1 ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity={0.18} />
              <stop offset="1" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradientId})`} />
        </>
      ) : null}
      {baseline !== undefined ? (
        <line
          x1={pad}
          x2={width - pad}
          y1={y(baseline)}
          y2={y(baseline)}
          stroke="var(--border-strong)"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      ) : null}
      {n > 1 ? (
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
      {endDot && last ? (
        <circle
          cx={last[0]}
          cy={last[1]}
          r={2.5}
          fill={color}
          stroke="var(--surface)"
          strokeWidth={2}
          paintOrder="stroke"
        />
      ) : null}
    </svg>
  );
});

function padDomain([lo, hi]: [number, number], baseline?: number): [number, number] {
  let min = lo;
  let max = hi;
  if (baseline !== undefined) {
    min = Math.min(min, baseline);
    max = Math.max(max, baseline);
  }
  if (min === max) return [min - 1, max + 1];
  const padding = (max - min) * 0.08;
  return [min - padding, max + padding];
}
