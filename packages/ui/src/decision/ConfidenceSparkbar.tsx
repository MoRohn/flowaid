import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { formatProbability } from "@/lib/format";
import { gateOutcome, type ConfidenceThresholds } from "@/types";
import { clampThresholds, gateColorVar, gateDescription } from "./gate";
import { Tooltip } from "@/primitives/Tooltip";

export interface ConfidenceSparkbarProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** Confidence in [0, 1]. */
  value: number;
  thresholds: ConfidenceThresholds;
  /** Track width in px. */
  width?: number;
  /** Track height in px. */
  height?: number;
  /** Mono value after the bar. */
  showValue?: boolean;
  /** Tint the fill by the gate outcome instead of the accent. */
  toneByOutcome?: boolean;
  /** Show the gate description in a tooltip on hover (default). Off inside another trigger. */
  hint?: boolean;
}

/**
 * Inline confidence bar for table cells: a 48×6 track filled to the value,
 * with the two gate thresholds as faint ticks so a glance shows which side
 * of the gate a row landed on.
 */
export const ConfidenceSparkbar = forwardRef<HTMLSpanElement, ConfidenceSparkbarProps>(
  function ConfidenceSparkbar(
    {
      value,
      thresholds,
      width = 48,
      height = 6,
      showValue = true,
      toneByOutcome = true,
      hint = true,
      className,
      style,
      ...rest
    },
    ref,
  ) {
    const t = clampThresholds(thresholds);
    const c = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    const outcome = gateOutcome(c, t);
    const description = gateDescription(c, t);
    const bar = (
      <span
        ref={ref}
        role="img"
        aria-label={description}
        data-outcome={outcome}
        className={cn("inline-flex shrink-0 items-center gap-1.5 align-middle", className)}
        style={style}
        {...rest}
      >
        <span
          className="relative block overflow-hidden rounded-[2px] bg-surface-3"
          style={{ width, height }}
        >
          <span
            className="absolute inset-y-0 left-0 block rounded-[2px] transition-[width] duration-(--dur-base) ease-(--ease-out)"
            style={{
              width: `${(c * 100).toFixed(2)}%`,
              backgroundColor: toneByOutcome ? gateColorVar(outcome) : "var(--p-1)",
            }}
          />
          {[t.review, t.auto].map((v, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="absolute inset-y-0 w-px bg-ink/50"
              style={{ left: `${(v * 100).toFixed(2)}%` }}
            />
          ))}
        </span>
        {showValue ? (
          <span className="font-mono text-2xs leading-none tabular text-ink-2">
            {formatProbability(c)}
          </span>
        ) : null}
      </span>
    );
    return hint ? <Tooltip content={description}>{bar}</Tooltip> : bar;
  },
);
