import { forwardRef, useId, type SVGAttributes } from "react";
import { cn } from "@/lib/cn";

export interface SparklineGeometry {
  /** SVG path for the line. */
  line: string;
  /** SVG path for the filled area under the line. */
  area: string;
  /** Last point coordinates. */
  last: { x: number; y: number } | null;
  max: number;
}

/**
 * Maps a series to an SVG polyline in a `width` × `height` box with `pad`
 * pixels of vertical padding. A flat series draws a baseline so a quiet
 * workflow still reads as "present, idle".
 */
export function sparklineGeometry(
  values: readonly number[],
  width: number,
  height: number,
  pad = 2,
): SparklineGeometry {
  const n = values.length;
  if (n === 0) return { line: "", area: "", last: null, max: 0 };
  const max = Math.max(0, ...values);
  const usable = height - pad * 2;
  const step = n > 1 ? width / (n - 1) : 0;
  const points = values.map((v, i) => {
    const x = n > 1 ? i * step : width / 2;
    const y = max > 0 ? pad + usable - (Math.max(0, v) / max) * usable : height - pad;
    return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };
  });
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  const first = points[0];
  const lastPoint = points[points.length - 1];
  const area =
    first && lastPoint ? `${line} L${lastPoint.x} ${height} L${first.x} ${height} Z` : "";
  return { line, area, last: lastPoint ?? null, max };
}

export interface RunsSparklineProps extends Omit<
  SVGAttributes<SVGSVGElement>,
  "values" | "width" | "height"
> {
  /** One bucket per point, e.g. runs per hour over the last 24 hours. */
  values: readonly number[];
  width?: number;
  height?: number;
  /** Accessible summary; defaults to the total. */
  label?: string;
  /** Tint: neutral (default) or accent. */
  tone?: "neutral" | "accent";
}

/**
 * Tiny inline SVG sparkline (24 points by default) for a workflow's recent
 * run volume. Stroke in `currentColor`, soft fill under the line, dot on the
 * latest point.
 */
export const RunsSparkline = forwardRef<SVGSVGElement, RunsSparklineProps>(function RunsSparkline(
  { values, width = 72, height = 20, label, tone = "neutral", className, ...rest },
  ref,
) {
  const id = useId();
  const geo = sparklineGeometry(values, width, height);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <svg
      ref={ref}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label ?? `${total} runs across ${values.length} intervals`}
      className={cn(
        "shrink-0 overflow-visible",
        tone === "accent" ? "text-accent" : "text-ink-3",
        className,
      )}
      {...rest}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {geo.area ? <path d={geo.area} fill={`url(#${id})`} /> : null}
      {geo.line ? (
        <path
          d={geo.line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
      {geo.last ? <circle cx={geo.last.x} cy={geo.last.y} r={1.75} fill="currentColor" /> : null}
    </svg>
  );
});
