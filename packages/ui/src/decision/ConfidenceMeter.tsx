import { forwardRef, type HTMLAttributes } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { formatProbability } from "@/lib/format";
import { Badge } from "@/primitives/Badge";
import { gateOutcome, type ConfidenceThresholds, type GateOutcome } from "@/types";
import {
  GATE_LABEL,
  GATE_TONE,
  clampThresholds,
  gateColorVar,
  gateDescription,
  gateSoftVar,
} from "./gate";
import { monoTextWidth, useMeasuredWidth } from "./useMeasuredWidth";

export type ConfidenceMeterSize = "sm" | "md" | "lg";

const TRACK_HEIGHT: Record<ConfidenceMeterSize, string> = {
  sm: "h-1.5",
  md: "h-2",
  lg: "h-3",
};

export interface ConfidenceMeterProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Confidence in [0, 1]. */
  confidence: number;
  thresholds: ConfidenceThresholds;
  /** Draw the three gate zones as soft bands under the marker. */
  showZones?: boolean;
  /** Show the outcome as a Badge after the meter. */
  showOutcome?: boolean;
  /** Show the mono confidence value before the meter. */
  showValue?: boolean;
  /** Mono threshold values under the zone boundaries (md and lg only). */
  showTicks?: boolean;
  size?: ConfidenceMeterSize;
}

/** Badge for a gate outcome; exported so tables and cards agree on tone and label. */
export function GateBadge({
  outcome,
  size = "md",
  className,
}: {
  outcome: GateOutcome;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <Badge
      tone={GATE_TONE[outcome]}
      size={size}
      dot
      className={cn("capitalize", className)}
      data-outcome={outcome}
    >
      {GATE_LABEL[outcome]}
    </Badge>
  );
}

/**
 * Horizontal meter from 0 to 1 with the three gate zones as bands (fail
 * below the `review` floor, review up to the pass threshold `auto`, pass at
 * or above), an ink marker at
 * the confidence, and the resulting outcome as a Badge.
 */
export const ConfidenceMeter = forwardRef<HTMLDivElement, ConfidenceMeterProps>(
  function ConfidenceMeter(
    {
      confidence,
      thresholds,
      showZones = true,
      showOutcome = true,
      showValue = true,
      showTicks,
      size = "md",
      className,
      ...rest
    },
    ref,
  ) {
    const reduced = useReducedMotion();
    const { ref: trackRef, width: trackWidth } = useMeasuredWidth<HTMLDivElement>();
    const t = clampThresholds(thresholds);
    const c = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
    const outcome = gateOutcome(c, t);
    const ticks = showTicks ?? size !== "sm";
    const zones: Array<{ outcome: GateOutcome; from: number; to: number }> = [
      { outcome: "fail", from: 0, to: t.review },
      { outcome: "review", from: t.review, to: t.auto },
      { outcome: "pass", from: t.auto, to: 1 },
    ];
    const transition = reduced
      ? { duration: 0 }
      : { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] as const };
    // When the two tick labels would overlap, draw one combined label between them.
    const tickGapPx = (t.auto - t.review) * trackWidth;
    const mergeTicks =
      trackWidth > 0 ? tickGapPx < monoTextWidth("0.00", 11) + 6 : t.auto - t.review < 0.08;
    const tickItems: Array<{ at: number; text: string }> = mergeTicks
      ? [
          {
            at: (t.review + t.auto) / 2,
            text: `${formatProbability(t.review)} · ${formatProbability(t.auto)}`,
          },
        ]
      : [
          { at: t.review, text: formatProbability(t.review) },
          { at: t.auto, text: formatProbability(t.auto) },
        ];

    return (
      <div
        ref={ref}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={c}
        aria-valuetext={gateDescription(c, t)}
        data-outcome={outcome}
        className={cn("flex w-full min-w-0 items-center gap-2.5", className)}
        {...rest}
      >
        {showValue ? (
          <span
            className={cn(
              "shrink-0 font-mono leading-none tabular text-ink",
              size === "sm" ? "text-2xs" : "text-xs",
            )}
          >
            {formatProbability(c)}
          </span>
        ) : null}
        <div ref={trackRef} className={cn("relative min-w-0 flex-1", ticks && "pb-3.5")}>
          <div
            className={cn(
              "relative w-full overflow-hidden rounded-[2px] bg-surface-3",
              TRACK_HEIGHT[size],
            )}
          >
            {showZones
              ? zones.map((z) =>
                  z.to > z.from ? (
                    <span
                      key={z.outcome}
                      data-zone={z.outcome}
                      className="absolute inset-y-0"
                      style={{
                        left: `${(z.from * 100).toFixed(3)}%`,
                        width: `${((z.to - z.from) * 100).toFixed(3)}%`,
                        backgroundColor:
                          z.outcome === outcome ? gateSoftVar(z.outcome) : "transparent",
                        boxShadow: `inset 0 -${size === "lg" ? 3 : 2}px 0 ${gateColorVar(z.outcome)}`,
                        opacity: z.outcome === outcome ? 1 : 0.45,
                      }}
                    />
                  ) : null,
                )
              : null}
            <motion.span
              aria-hidden="true"
              initial={false}
              animate={{ left: `${(c * 100).toFixed(3)}%` }}
              transition={transition}
              className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-ink"
              style={{ left: `${(c * 100).toFixed(3)}%` }}
            />
          </div>
          {ticks ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3 font-mono text-2xs leading-none text-ink-3 tabular">
              {[t.review, t.auto].map((v, i) => (
                <span
                  key={`tick-${i}`}
                  className="absolute top-0 h-1 w-px -translate-x-1/2 bg-ink-4"
                  style={{ left: `${(v * 100).toFixed(3)}%` }}
                />
              ))}
              {tickItems.map((item, i) => (
                <span
                  key={`label-${i}`}
                  className={cn(
                    "absolute top-[6px] whitespace-nowrap",
                    item.at <= 0.06
                      ? "translate-x-0"
                      : item.at >= 0.94
                        ? "-translate-x-full"
                        : "-translate-x-1/2",
                  )}
                  style={{ left: `${(item.at * 100).toFixed(3)}%` }}
                >
                  {item.text}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {showOutcome ? <GateBadge outcome={outcome} size={size === "sm" ? "sm" : "md"} /> : null}
      </div>
    );
  },
);
