import { forwardRef, useMemo, useState, type HTMLAttributes } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { formatProbability } from "@/lib/format";
import type { ConfidenceThresholds, GateOutcome } from "@/types";
import { gateOutcome } from "@/types";
import { GridLines, SrTable, XAxis, YAxis, measureGutter, roundedBarPath } from "./axes";
import { ChartTooltip } from "./ChartTooltip";
import {
  binValues,
  confidenceZoneCounts,
  formatAxisTick,
  makeLinearScale,
  niceDomain,
  type ZoneCounts,
} from "./chartMath";

export interface ConfidenceHistogramProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Decision confidences in [0, 1]. */
  confidences: readonly number[];
  thresholds: ConfidenceThresholds;
  width: number;
  height: number;
  bins?: number;
  /** Show the pass / review / fail counts above the plot. */
  summary?: boolean;
  label?: string;
}

/** Colour and label for each gate outcome (ARCHITECTURE.md §6.3). Fail is amber: the run routes away from the automatic path. */
export const GATE_ZONE: Record<GateOutcome, { label: string; color: string; soft: string }> = {
  pass: { label: "Pass", color: "var(--accent)", soft: "var(--accent-soft)" },
  review: { label: "Review", color: "var(--p-2)", soft: "var(--surface-3)" },
  fail: { label: "Fail", color: "var(--warn)", soft: "var(--warn-soft)" },
};

/**
 * Distribution of decision confidences with the confidence gate drawn on
 * top: the review and auto thresholds as labelled hairlines and the three
 * zones as soft bands. Bars take their zone's colour, so the shape shows at a
 * glance how much of the traffic ran automatically.
 */
export const ConfidenceHistogram = forwardRef<HTMLDivElement, ConfidenceHistogramProps>(
  function ConfidenceHistogram(
    {
      confidences,
      thresholds,
      width,
      height,
      bins = 20,
      summary = true,
      label,
      className,
      ...rest
    },
    ref,
  ) {
    const reduced = useReducedMotion();
    const [active, setActive] = useState<number | null>(null);
    const binned = useMemo(
      () => binValues(confidences, { bins, domain: [0, 1] }),
      [confidences, bins],
    );
    const counts: ZoneCounts = useMemo(
      () => confidenceZoneCounts(confidences, thresholds),
      [confidences, thresholds],
    );
    const maxCount = binned.reduce((m, b) => Math.max(m, b.count), 0);
    const yDomain = niceDomain(0, maxCount);
    const yTicks = makeLinearScale(yDomain, [0, 1], false).ticks(3);
    const margin = {
      top: 24,
      right: 12,
      bottom: 22,
      left: measureGutter(yTicks.map((t) => formatAxisTick(t, "count"))),
    };
    const plotW = Math.max(0, width - margin.left - margin.right);
    const plotH = Math.max(0, height - margin.top - margin.bottom);
    const x = makeLinearScale([0, 1], [margin.left, margin.left + plotW], false);
    const y = makeLinearScale(yDomain, [margin.top + plotH, margin.top], false);
    const transition = reduced ? { duration: 0 } : { duration: 0.45, ease: "easeOut" as const };
    const activeBin = active === null ? undefined : binned[active];
    const share = (n: number) => (counts.total ? `${((n / counts.total) * 100).toFixed(0)}%` : "—");

    const zones: Array<{ zone: GateOutcome; from: number; to: number }> = [
      { zone: "fail", from: 0, to: thresholds.review },
      { zone: "review", from: thresholds.review, to: thresholds.auto },
      { zone: "pass", from: thresholds.auto, to: 1 },
    ];

    return (
      <div ref={ref} className={cn("flex flex-col gap-2", className)} {...rest}>
        {summary ? (
          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-1"
            role="list"
            aria-label="Gate outcomes"
          >
            {(["pass", "review", "fail"] as const).map((z) => (
              <span
                key={z}
                role="listitem"
                className="inline-flex items-center gap-1.5 text-xs text-ink-2"
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 rounded-[2px]"
                  style={{ backgroundColor: GATE_ZONE[z].color }}
                />
                {GATE_ZONE[z].label}
                <span className="font-mono text-2xs text-ink tabular">
                  {counts[z].toLocaleString("en")}
                </span>
                <span className="font-mono text-2xs text-ink-3 tabular">{share(counts[z])}</span>
              </span>
            ))}
          </div>
        ) : null}
        <div className="relative" style={{ width, height }}>
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={
              label ??
              `Confidence distribution: ${counts.pass} pass, ${counts.review} review, ${counts.fail} fail of ${counts.total}`
            }
            className="block overflow-visible"
          >
            <g aria-hidden="true">
              {zones.map((z) => (
                <rect
                  key={z.zone}
                  x={x(z.from)}
                  y={margin.top}
                  width={Math.max(0, x(z.to) - x(z.from))}
                  height={plotH}
                  fill={GATE_ZONE[z.zone].soft}
                  opacity={z.zone === "review" ? 0.6 : 0.5}
                />
              ))}
            </g>
            <GridLines ticks={yTicks} scale={y} x0={margin.left} x1={margin.left + plotW} />
            <YAxis
              ticks={yTicks}
              scale={y}
              x={margin.left - 6}
              format={(t) => formatAxisTick(t, "count")}
            />
            <XAxis
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              scale={x}
              y={height - 6}
              format={(t) => formatProbability(t, 2)}
            />
            {binned.map((b, i) => {
              const x0 = x(b.x0);
              const x1 = x(b.x1);
              const w = Math.max(0, x1 - x0 - 2);
              const top = y(b.count);
              const h = Math.max(0, y(0) - top);
              const mid = (b.x0 + b.x1) / 2;
              const zone = gateOutcome(mid, thresholds);
              const isActive = active === i;
              return (
                <g
                  key={i}
                  tabIndex={b.count > 0 ? 0 : -1}
                  aria-label={`${formatProbability(b.x0)} to ${formatProbability(b.x1)}: ${b.count} (${GATE_ZONE[zone].label})`}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
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
                      fill={GATE_ZONE[zone].color}
                      initial={reduced ? false : { opacity: 0 }}
                      animate={{ opacity: isActive ? 0.8 : 1 }}
                      transition={transition}
                    />
                  ) : null}
                </g>
              );
            })}
            <g aria-hidden="true">
              {[
                { key: "review", value: thresholds.review, anchor: "end" as const },
                { key: "pass", value: thresholds.auto, anchor: "start" as const },
              ].map((t) => (
                <g key={t.key}>
                  <line
                    x1={x(t.value)}
                    x2={x(t.value)}
                    y1={margin.top - 4}
                    y2={margin.top + plotH}
                    stroke="var(--ink-2)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  <text
                    x={x(t.value) + (t.anchor === "start" ? 4 : -4)}
                    y={margin.top - 9}
                    textAnchor={t.anchor}
                    className="font-mono text-2xs tabular"
                    fill="var(--ink)"
                  >
                    {t.key} ≥ {formatProbability(t.value)}
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
              title={`${formatProbability(activeBin.x0)} – ${formatProbability(activeBin.x1)}`}
              rows={[
                {
                  id: "count",
                  label: "Decisions",
                  value: activeBin.count.toLocaleString("en"),
                  color:
                    GATE_ZONE[gateOutcome((activeBin.x0 + activeBin.x1) / 2, thresholds)].color,
                  swatch: "rect",
                },
                {
                  id: "zone",
                  label: "Gate",
                  value:
                    GATE_ZONE[gateOutcome((activeBin.x0 + activeBin.x1) / 2, thresholds)].label,
                  swatch: "none",
                },
              ]}
            />
          ) : null}
          <SrTable
            caption={label ?? "Confidence histogram"}
            head={["From", "To", "Decisions", "Gate"]}
            rows={binned.map((b) => [
              formatProbability(b.x0),
              formatProbability(b.x1),
              b.count,
              GATE_ZONE[gateOutcome((b.x0 + b.x1) / 2, thresholds)].label,
            ])}
          />
        </div>
      </div>
    );
  },
);
