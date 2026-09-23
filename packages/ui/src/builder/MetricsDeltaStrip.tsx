import { forwardRef, type HTMLAttributes } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCost, formatMs } from "@/lib/format";
import type { EvaluationMetricView } from "@/types";

export type MetricDeltaTone = "ok" | "danger" | "neutral";

export interface MetricDelta {
  key: string;
  label: string;
  /** Candidate value formatted for its unit. */
  candidateText: string;
  /** Baseline value formatted for its unit, when a baseline exists. */
  baseText?: string;
  /** Signed delta, e.g. "+4.1%", "-18%", "+2". Absent without a baseline. */
  deltaText?: string;
  /** ok when the change is an improvement, danger when a regression, neutral for no change / no baseline. */
  tone: MetricDeltaTone;
  direction: "up" | "down" | "flat";
}

function formatValue(value: number, unit: EvaluationMetricView["unit"]): string {
  if (unit === "ratio") return `${(value * 100).toFixed(1)}%`;
  if (unit === "ms") return formatMs(value);
  if (unit === "usd") return formatCost(value);
  return Number.isInteger(value) ? `${value}` : value.toFixed(2);
}

function signed(n: number, text: string): string {
  return n > 0 ? `+${text}` : n < 0 ? `-${text}` : text;
}

/**
 * Turns a metric into display text and a tone. Ratios show the difference in
 * percentage points, ms/usd show the relative change against the baseline,
 * and counts show the absolute difference. `higherIsBetter` decides whether
 * an increase reads as ok or danger.
 */
export function computeMetricDelta(metric: EvaluationMetricView): MetricDelta {
  const { key, label, base, candidate, unit, higherIsBetter } = metric;
  const candidateText = formatValue(candidate, unit);
  if (base === undefined) {
    return { key, label, candidateText, tone: "neutral", direction: "flat" };
  }
  const diff = candidate - base;
  const baseText = formatValue(base, unit);
  let deltaText: string;
  if (unit === "ratio") {
    deltaText = signed(diff, `${(Math.abs(diff) * 100).toFixed(1)}%`);
  } else if (unit === "ms" || unit === "usd") {
    const rel = base === 0 ? (diff === 0 ? 0 : 1) : diff / base;
    deltaText = signed(rel, `${Math.round(Math.abs(rel) * 100)}%`);
  } else {
    deltaText = signed(
      diff,
      Number.isInteger(diff) ? `${Math.abs(diff)}` : Math.abs(diff).toFixed(2),
    );
  }
  const epsilon = unit === "ratio" ? 0.0005 : 1e-9;
  const direction: MetricDelta["direction"] =
    Math.abs(diff) <= epsilon ? "flat" : diff > 0 ? "up" : "down";
  const tone: MetricDeltaTone =
    direction === "flat" ? "neutral" : (direction === "up") === higherIsBetter ? "ok" : "danger";
  return { key, label, candidateText, baseText, deltaText, tone, direction };
}

export interface MetricsDeltaStripProps extends HTMLAttributes<HTMLDivElement> {
  metrics: EvaluationMetricView[];
  /** Show base → candidate under the delta. */
  showValues?: boolean;
  /** Compact tiles for narrow panels. */
  size?: "sm" | "md";
}

const TONE_TEXT: Record<MetricDeltaTone, string> = {
  ok: "text-ok-text",
  danger: "text-danger-text",
  neutral: "text-ink-2",
};

/**
 * Row of metric tiles: label, signed delta in mono, and base → candidate.
 * Improvement is green and regression red, regardless of the sign, because
 * each metric knows whether higher is better.
 */
export const MetricsDeltaStrip = forwardRef<HTMLDivElement, MetricsDeltaStripProps>(
  function MetricsDeltaStrip({ metrics, showValues = true, size = "md", className, ...rest }, ref) {
    return (
      <div
        ref={ref}
        role="list"
        className={cn("overflow-hidden rounded-md border border-border bg-surface-2", className)}
        {...rest}
      >
        <div
          className={cn(
            "-mb-px -mr-px grid",
            size === "sm"
              ? "grid-cols-[repeat(auto-fit,minmax(140px,1fr))]"
              : "grid-cols-[repeat(auto-fit,minmax(156px,1fr))]",
          )}
        >
          {metrics.map((m) => {
            const d = computeMetricDelta(m);
            const Icon =
              d.direction === "up" ? ArrowUpRight : d.direction === "down" ? ArrowDownRight : Minus;
            return (
              <div
                key={d.key}
                role="listitem"
                data-tone={d.tone}
                className={cn(
                  "flex min-w-0 flex-col gap-1 border-b border-r border-border bg-surface",
                  size === "sm" ? "px-2.5 py-2" : "px-3 py-2.5",
                )}
              >
                <span className="truncate text-2xs font-medium text-ink-3">{d.label}</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 font-mono font-medium tabular",
                    size === "sm" ? "text-sm" : "text-base",
                    TONE_TEXT[d.tone],
                  )}
                >
                  <Icon className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                  {d.deltaText ?? d.candidateText}
                </span>
                {showValues ? (
                  <span className="truncate font-mono text-2xs text-ink-3 tabular">
                    {d.baseText !== undefined ? (
                      <>
                        {d.baseText} <span aria-hidden="true">→</span>{" "}
                        <span className="text-ink-2">{d.candidateText}</span>
                      </>
                    ) : (
                      <span className="text-ink-2">candidate only</span>
                    )}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);
