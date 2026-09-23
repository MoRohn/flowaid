import { forwardRef, useMemo, useState, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { formatPercent, formatProbability } from "@/lib/format";
import { useMeasuredWidth } from "./useMeasuredWidth";

export interface CalibrationBin {
  /** Lower edge of the predicted-confidence bin, inclusive. */
  lower: number;
  /** Upper edge, exclusive except for the last bin. */
  upper: number;
  /** Mean predicted confidence of the samples in the bin. */
  predicted: number;
  /** Observed accuracy (fraction correct) in the bin. */
  observed: number;
  /** Number of samples in the bin. */
  count: number;
}

export interface CalibrationChartProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  bins: CalibrationBin[];
  /** Plot height in px (the header adds ~20px). */
  height?: number;
  /** How the bin count is shown: bar widths, or dot sizes. */
  countMode?: "bars" | "dots";
  /** Hide the ECE / n readout row. */
  hideSummary?: boolean;
  /** Fixed plot width; measured from the container when omitted. */
  width?: number;
  /** Which bin is highlighted, when controlled from outside (a table row hover). */
  activeIndex?: number | null;
  onActiveIndexChange?: (index: number | null) => void;
}

/** Expected calibration error: count-weighted mean |observed − predicted|. Empty bins count for nothing. */
export function expectedCalibrationError(bins: readonly CalibrationBin[]): number {
  const n = bins.reduce((s, b) => s + Math.max(0, b.count), 0);
  if (n === 0) return 0;
  return bins.reduce(
    (s, b) => s + (Math.max(0, b.count) / n) * Math.abs(b.observed - b.predicted),
    0,
  );
}

const M = { top: 10, right: 12, bottom: 30, left: 48 };
const TICKS = [0, 0.25, 0.5, 0.75, 1];

/**
 * Reliability diagram: predicted confidence (x) against observed accuracy (y)
 * per bin, with the diagonal a perfectly calibrated model would sit on.
 * Bin size is shown as bar width or dot size; the gap to the diagonal is
 * drawn as a stub so over- and under-confidence are visible without a legend.
 */
export const CalibrationChart = forwardRef<HTMLDivElement, CalibrationChartProps>(
  function CalibrationChart(
    {
      bins,
      height = 220,
      countMode = "bars",
      hideSummary = false,
      width: fixedWidth,
      activeIndex,
      onActiveIndexChange,
      className,
      ...rest
    },
    ref,
  ) {
    const { ref: measureRef, width: measuredWidth } = useMeasuredWidth<HTMLDivElement>(fixedWidth);
    const width = measuredWidth > 0 ? measuredWidth : 320;
    const [internalActive, setInternalActive] = useState<number | null>(null);
    const active = activeIndex === undefined ? internalActive : activeIndex;
    const setActive = (i: number | null) => {
      setInternalActive(i);
      onActiveIndexChange?.(i);
    };

    const plotW = Math.max(40, width - M.left - M.right);
    const plotH = Math.max(40, height - M.top - M.bottom);
    const x = (v: number) => M.left + Math.min(1, Math.max(0, v)) * plotW;
    const y = (v: number) => M.top + (1 - Math.min(1, Math.max(0, v))) * plotH;

    const total = bins.reduce((s, b) => s + Math.max(0, b.count), 0);
    const maxCount = Math.max(1, ...bins.map((b) => b.count));
    const ece = useMemo(() => expectedCalibrationError(bins), [bins]);
    const points = bins.filter((b) => b.count > 0);
    const path = points
      .map(
        (b, i) => `${i === 0 ? "M" : "L"}${x(b.predicted).toFixed(1)},${y(b.observed).toFixed(1)}`,
      )
      .join(" ");
    const activeBin = active !== null ? bins[active] : undefined;

    return (
      <div ref={ref} className={cn("flex w-full min-w-0 flex-col gap-1.5", className)} {...rest}>
        {!hideSummary ? (
          <div className="flex items-baseline justify-between gap-3 font-mono text-2xs leading-none text-ink-3 tabular">
            <span>
              <span className="text-ink">ECE {formatProbability(ece, 3)}</span>
              <span className="text-ink-3"> · n={total.toLocaleString("en")}</span>
            </span>
            <span className="text-ink-3">
              {countMode === "bars" ? "bar width = bin size" : "dot size = bin size"}
            </span>
          </div>
        ) : null}
        <div ref={measureRef} className="relative w-full" onMouseLeave={() => setActive(null)}>
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`Reliability diagram, ${bins.length} bins, expected calibration error ${formatProbability(ece, 3)}`}
            className="block max-w-full overflow-visible font-mono text-2xs tabular"
          >
            {/* grid */}
            {TICKS.map((t) => (
              <g key={t}>
                <line
                  x1={M.left}
                  x2={M.left + plotW}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--border)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <line
                  x1={x(t)}
                  x2={x(t)}
                  y1={M.top}
                  y2={M.top + plotH}
                  stroke="var(--border)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text
                  x={M.left - 6}
                  y={y(t)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fill="var(--ink-3)"
                >
                  {t.toFixed(2)}
                </text>
                <text
                  x={x(t)}
                  y={M.top + plotH + 14}
                  textAnchor={t === 0 ? "start" : t === 1 ? "end" : "middle"}
                  fill="var(--ink-3)"
                >
                  {t.toFixed(2)}
                </text>
              </g>
            ))}
            <text
              x={M.left + plotW / 2}
              y={height - 2}
              textAnchor="middle"
              fill="var(--ink-4)"
              className="font-sans"
            >
              predicted confidence
            </text>
            <text
              transform={`translate(10 ${M.top + plotH / 2}) rotate(-90)`}
              textAnchor="middle"
              fill="var(--ink-4)"
              className="font-sans"
            >
              observed accuracy
            </text>

            {/* diagonal */}
            <line
              x1={x(0)}
              y1={y(0)}
              x2={x(1)}
              y2={y(1)}
              stroke="var(--border-strong)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />

            {/* bars */}
            {countMode === "bars"
              ? bins.map((b, i) => {
                  if (b.count <= 0) return null;
                  const full = Math.max(2, x(b.upper) - x(b.lower) - 2);
                  const w = Math.max(3, full * Math.sqrt(b.count / maxCount));
                  const cx = x(b.predicted);
                  const isActive = active === i;
                  return (
                    <rect
                      key={i}
                      x={cx - w / 2}
                      y={y(b.observed)}
                      width={w}
                      height={Math.max(0, y(0) - y(b.observed))}
                      rx={1.5}
                      fill={isActive ? "var(--p-1)" : "var(--p-2)"}
                      opacity={isActive ? 0.75 : 0.35}
                      className="transition-[opacity,fill] duration-(--dur-fast)"
                    />
                  );
                })
              : null}

            {/* gap stubs */}
            {bins.map((b, i) =>
              b.count > 0 ? (
                <line
                  key={i}
                  x1={x(b.predicted)}
                  x2={x(b.predicted)}
                  y1={y(b.predicted)}
                  y2={y(b.observed)}
                  stroke={b.observed < b.predicted ? "var(--danger)" : "var(--ok)"}
                  strokeWidth={1}
                  opacity={active === i ? 1 : 0.45}
                />
              ) : null,
            )}

            {/* line + dots */}
            {path ? (
              <path
                d={path}
                fill="none"
                stroke="var(--p-1)"
                strokeWidth={1.5}
                strokeLinejoin="round"
              />
            ) : null}
            {bins.map((b, i) => {
              if (b.count <= 0) return null;
              const r =
                countMode === "dots"
                  ? 2.5 + 6 * Math.sqrt(b.count / maxCount)
                  : active === i
                    ? 4
                    : 3;
              return (
                <circle
                  key={i}
                  cx={x(b.predicted)}
                  cy={y(b.observed)}
                  r={r}
                  fill={countMode === "dots" ? "var(--p-1)" : "var(--surface)"}
                  fillOpacity={countMode === "dots" ? (active === i ? 0.95 : 0.7) : 1}
                  stroke="var(--p-1)"
                  strokeWidth={1.5}
                />
              );
            })}

            {/* hit areas */}
            {bins.map((b, i) => (
              <rect
                key={i}
                x={x(b.lower)}
                y={M.top}
                width={Math.max(0, x(b.upper) - x(b.lower))}
                height={plotH}
                fill="transparent"
                tabIndex={b.count > 0 ? 0 : -1}
                role="img"
                aria-label={`${formatProbability(b.lower)}–${formatProbability(b.upper)}: predicted ${formatProbability(b.predicted)}, observed ${formatProbability(b.observed)}, ${b.count} samples`}
                className="outline-none focus-visible:fill-accent/10"
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
            ))}
          </svg>

          {activeBin ? (
            <div
              role="tooltip"
              className="pointer-events-none absolute z-10 flex -translate-x-1/2 flex-col gap-0.5 whitespace-nowrap rounded-sm bg-ink px-2 py-1.5 font-mono text-2xs leading-tight text-surface shadow-2 tabular"
              style={{
                left: x(activeBin.predicted),
                top: Math.max(0, y(activeBin.observed) - 10),
                transform: "translate(-50%, -100%)",
              }}
            >
              <span className="text-surface/70">
                {formatProbability(activeBin.lower)}–{formatProbability(activeBin.upper)} · n=
                {activeBin.count}
              </span>
              <span>
                predicted {formatProbability(activeBin.predicted)} · observed{" "}
                {formatProbability(activeBin.observed)}
              </span>
              <span
                style={{
                  color: activeBin.observed < activeBin.predicted ? "var(--danger)" : "var(--ok)",
                }}
              >
                {activeBin.observed < activeBin.predicted ? "overconfident" : "underconfident"}{" "}
                {formatPercent(Math.abs(activeBin.observed - activeBin.predicted), 1)}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    );
  },
);
