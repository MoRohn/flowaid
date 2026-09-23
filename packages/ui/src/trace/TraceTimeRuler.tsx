import { forwardRef, useMemo, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { formatTick, tickPositions } from "./timeScale";

export interface TraceTimeRulerProps extends HTMLAttributes<HTMLDivElement> {
  /** Length of the window in ms. */
  totalMs: number;
  /** Upper bound on tick count; the ruler picks a nice step below it. */
  maxTicks?: number;
  /** Marks the right edge as "now" with a pulsing dot. */
  live?: boolean;
}

/**
 * Tick track for the span column: labels at nice intervals (1/2/5 × 10ⁿ ms),
 * a hairline per tick, and a "now" marker when the run is live. It sizes to
 * its container so it can sit in the same grid column as the span bars.
 */
export const TraceTimeRuler = forwardRef<HTMLDivElement, TraceTimeRulerProps>(
  function TraceTimeRuler({ totalMs, maxTicks = 6, live = false, className, ...rest }, ref) {
    const ticks = useMemo(() => tickPositions(totalMs, maxTicks), [totalMs, maxTicks]);
    return (
      <div
        ref={ref}
        role="presentation"
        className={cn("relative h-full min-h-6 w-full overflow-hidden", className)}
        {...rest}
      >
        {ticks.map((t, i) => {
          const left = (t / totalMs) * 100;
          const last = i === ticks.length - 1;
          return (
            <span
              key={t}
              className="absolute inset-y-0 flex items-center"
              style={{ left: `${left}%` }}
            >
              <span aria-hidden="true" className="absolute inset-y-0 left-0 w-px bg-border" />
              <span
                className={cn(
                  "absolute top-1/2 -translate-y-1/2 whitespace-nowrap font-mono text-2xs leading-none text-ink-3 tabular",
                  last && left > 90 ? "right-0.5" : "left-1",
                )}
              >
                {formatTick(t)}
              </span>
            </span>
          );
        })}
        {live ? (
          <span
            aria-label="Live"
            className="absolute inset-y-0 right-0 flex items-center gap-1 bg-surface pl-1 font-mono text-2xs leading-none text-info-text"
          >
            <span aria-hidden="true" className="fa-pulse size-1.5 rounded-full bg-current" />
            now
          </span>
        ) : null}
      </div>
    );
  },
);
