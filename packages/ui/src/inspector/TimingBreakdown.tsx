import { forwardRef, useMemo, type HTMLAttributes } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { formatMs, formatPercent } from "@/lib/format";
import { Tooltip } from "@/primitives";

export type TimingPhase = "queue" | "execution" | "retries" | "human";

export interface TimingSegment {
  /** A `TimingPhase` name, or any key for custom segments. */
  key: string;
  label: string;
  ms: number;
  /** A `TimingPhase` name (defaults to the key) or any CSS colour expression. */
  color?: string;
}

export interface NodeTiming {
  /** Time between enqueue and first start. */
  queueMs?: number;
  /** Time spent executing the successful attempt. */
  executionMs?: number;
  /** Time consumed by failed attempts and backoff. */
  retryMs?: number;
  /** Time waiting for a person. */
  humanMs?: number;
}

const PHASE_COLOR: Record<TimingPhase, string> = {
  queue: "var(--border-strong)",
  execution: "var(--p-1)",
  retries: "var(--p-2)",
  human: "var(--cat-human)",
};

const PHASE_LABEL: Record<TimingPhase, string> = {
  queue: "Queue wait",
  execution: "Execution",
  retries: "Retries",
  human: "Waiting for human",
};

function isPhase(v: string): v is TimingPhase {
  return v === "queue" || v === "execution" || v === "retries" || v === "human";
}

/** Converts a `NodeTiming` into ordered segments (zero phases are kept so the legend is stable). */
export function timingSegments(timing: NodeTiming): TimingSegment[] {
  const order: Array<[TimingPhase, number | undefined]> = [
    ["queue", timing.queueMs],
    ["execution", timing.executionMs],
    ["retries", timing.retryMs],
    ["human", timing.humanMs],
  ];
  return order
    .filter((entry): entry is [TimingPhase, number] => entry[1] !== undefined)
    .map(([key, ms]) => ({ key, label: PHASE_LABEL[key], ms: Math.max(0, ms), color: key }));
}

function segmentColor(seg: TimingSegment): string {
  const c = seg.color ?? seg.key;
  return isPhase(c) ? PHASE_COLOR[c] : c;
}

export interface TimingBreakdownProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Explicit segments; wins over `timing`. */
  segments?: readonly TimingSegment[];
  timing?: NodeTiming;
  /** Total shown at the right; defaults to the sum of the segments. */
  totalMs?: number;
  /** Bar height in px. Default 8. */
  barHeight?: number;
  /** Hide the legend and show only the bar and total. */
  compact?: boolean;
}

/**
 * Horizontal stacked bar of where a node run spent its time: queue wait,
 * execution, retries and waiting for a human, with a legend of mono
 * durations and shares. Execution and retries share the probability hue
 * (retries lighter); queue is neutral and human wait is the human amber.
 */
export const TimingBreakdown = forwardRef<HTMLDivElement, TimingBreakdownProps>(
  function TimingBreakdown(
    { segments, timing, totalMs, barHeight = 8, compact = false, className, ...rest },
    ref,
  ) {
    const reduced = useReducedMotion();
    const segs = useMemo(
      () => segments ?? (timing ? timingSegments(timing) : []),
      [segments, timing],
    );
    const sum = segs.reduce((acc, s) => acc + Math.max(0, s.ms), 0);
    const total = totalMs ?? sum;
    const denom = Math.max(sum, total, 1);
    const visible = segs.filter((s) => s.ms > 0);

    return (
      <div
        ref={ref}
        className={cn("flex min-w-0 flex-col gap-2", className)}
        role="group"
        aria-label="Timing breakdown"
        {...rest}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3"
            style={{ height: barHeight, gap: 1 }}
            role="img"
            aria-label={segs.map((s) => `${s.label} ${formatMs(s.ms)}`).join(", ")}
          >
            {visible.map((s, i) => {
              const share = s.ms / denom;
              // The bar is one role="img" whose label lists every segment; the per-segment
              // tooltip is for pointer users.
              return (
                <Tooltip
                  key={s.key}
                  content={`${s.label}: ${formatMs(s.ms)} (${formatPercent(share)})`}
                >
                  <motion.span
                    className="h-full min-w-0.5"
                    style={{
                      backgroundColor: segmentColor(s),
                      flexBasis: `${share * 100}%`,
                      transformOrigin: "left",
                    }}
                    initial={reduced ? false : { scaleX: 0, opacity: 0 }}
                    animate={{ scaleX: 1, opacity: 1 }}
                    transition={{ duration: 0.35, delay: i * 0.05, ease: [0.2, 0.8, 0.2, 1] }}
                  />
                </Tooltip>
              );
            })}
          </div>
          <span className="shrink-0 font-mono text-xs text-ink tabular">
            {formatMs(total)}
            <span className="ml-1 text-2xs text-ink-3">total</span>
          </span>
        </div>
        {!compact ? (
          <ul className="flex flex-col gap-0.5">
            {segs.map((s) => {
              const share = s.ms / denom;
              return (
                <li key={s.key} className="flex h-5 items-center gap-2 text-xs">
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: segmentColor(s) }}
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      s.ms > 0 ? "text-ink-2" : "text-ink-3",
                    )}
                  >
                    {s.label}
                  </span>
                  <span className="w-12 shrink-0 text-right font-mono text-2xs text-ink-3 tabular">
                    {s.ms > 0 ? formatPercent(share) : "—"}
                  </span>
                  <span
                    className={cn(
                      "w-16 shrink-0 text-right font-mono text-xs tabular",
                      s.ms > 0 ? "text-ink" : "text-ink-3",
                    )}
                  >
                    {s.ms > 0 ? formatMs(s.ms) : "0 ms"}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    );
  },
);
