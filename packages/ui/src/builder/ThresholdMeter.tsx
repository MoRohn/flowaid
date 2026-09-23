import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { formatProbability } from "@/lib/format";
import { gateOutcome, type ConfidenceThresholds } from "@/types";

export interface ThresholdMeterProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  thresholds: ConfidenceThresholds;
  /** A confidence to mark on the ruler (a sample, a measured median). */
  value?: number;
  /** Show the three zone labels under the bar. */
  showZones?: boolean;
  label?: string;
}

/**
 * Mini confidence-gate ruler: the [0,1] range split into human / secondary
 * review / auto zones by the two thresholds, drawn in the probability ramp.
 * An optional `value` tick shows where a confidence lands.
 */
export const ThresholdMeter = forwardRef<HTMLDivElement, ThresholdMeterProps>(
  function ThresholdMeter(
    { thresholds, value, showZones = true, label = "Confidence thresholds", className, ...rest },
    ref,
  ) {
    const review = Math.min(1, Math.max(0, thresholds.review));
    const auto = Math.min(1, Math.max(review, thresholds.auto));
    const outcome = value === undefined ? undefined : gateOutcome(value, thresholds);
    return (
      <div
        ref={ref}
        role="img"
        aria-label={`${label}: review at ${formatProbability(review)}, auto at ${formatProbability(auto)}${
          value !== undefined ? `, value ${formatProbability(value)} → ${outcome}` : ""
        }`}
        className={cn("flex w-full min-w-0 flex-col gap-1", className)}
        {...rest}
      >
        <div className="relative flex h-2 w-full gap-px overflow-hidden rounded-[2px]">
          <span className="h-full bg-p-4" style={{ width: `${review * 100}%` }} />
          <span className="h-full bg-p-2" style={{ width: `${(auto - review) * 100}%` }} />
          <span className="h-full flex-1 bg-p-1" />
          {value !== undefined ? (
            <span
              aria-hidden="true"
              className="absolute top-0 h-full w-0.5 -translate-x-1/2 bg-ink ring-1 ring-surface"
              style={{ left: `${Math.min(1, Math.max(0, value)) * 100}%` }}
            />
          ) : null}
        </div>
        {showZones ? (
          <div className="flex gap-2 font-mono text-2xs tabular text-ink-3">
            <span className="min-w-0 shrink truncate" style={{ width: `${review * 100}%` }}>
              human
            </span>
            <span className="min-w-0 flex-1 truncate">{formatProbability(review)} review</span>
            <span className="shrink-0 whitespace-nowrap text-accent-text">
              {formatProbability(auto)} auto
            </span>
          </div>
        ) : null}
      </div>
    );
  },
);
