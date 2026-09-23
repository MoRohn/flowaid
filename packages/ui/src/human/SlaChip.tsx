import { forwardRef, type HTMLAttributes } from "react";
import { Clock, TimerOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDurationShort, toEpochMs, useReviewNow } from "./time";
import { Tooltip } from "@/primitives";

export type SlaState = "ok" | "warn" | "danger" | "expired";

export interface SlaThresholds {
  /** Remaining ms at or below which the chip turns amber. */
  warnMs: number;
  /** Remaining ms at or below which the chip turns red and pulses. */
  dangerMs: number;
}

export const DEFAULT_SLA_THRESHOLDS: SlaThresholds = {
  warnMs: 15 * 60_000,
  dangerMs: 5 * 60_000,
};

/** Classifies a remaining time (ms) against the thresholds. */
export function slaState(remainingMs: number, t: SlaThresholds = DEFAULT_SLA_THRESHOLDS): SlaState {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "expired";
  if (remainingMs <= t.dangerMs) return "danger";
  if (remainingMs <= t.warnMs) return "warn";
  return "ok";
}

const STATE_CLASS: Record<SlaState, string> = {
  ok: "bg-surface-3 text-ink-2",
  warn: "bg-warn-soft text-warn-text",
  danger: "bg-danger-soft text-danger-text",
  expired: "bg-surface-3 text-ink-3",
};

export interface SlaChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** ISO timestamp (or epoch ms) at which the review expires. */
  expiresAt: string | number;
  thresholds?: Partial<SlaThresholds>;
  /** Freeze the clock at this epoch ms (tests, snapshots). Disables ticking. */
  now?: number;
  /** Re-render every second while mounted. Default true. */
  ticking?: boolean;
  size?: "sm" | "md";
  /** Hide the leading clock icon. */
  noIcon?: boolean;
}

/**
 * Remaining-time pill for a review's SLA. Neutral while there is time, amber
 * under `warnMs`, red and pulsing under `dangerMs`, and "Expired" once past.
 * The value is mono and ticks every second.
 */
export const SlaChip = forwardRef<HTMLSpanElement, SlaChipProps>(function SlaChip(
  {
    expiresAt,
    thresholds,
    now: fixedNow,
    ticking = true,
    size = "md",
    noIcon = false,
    className,
    ...rest
  },
  ref,
) {
  const now = useReviewNow(1000, ticking, fixedNow);
  const remaining = toEpochMs(expiresAt) - now;
  const t: SlaThresholds = { ...DEFAULT_SLA_THRESHOLDS, ...thresholds };
  const state = slaState(remaining, t);
  const label = state === "expired" ? "Expired" : formatDurationShort(remaining);
  const Icon = state === "expired" ? TimerOff : Clock;
  return (
    <Tooltip content={state === "expired" ? "The review window has closed" : `Due in ${label}`}>
      <span
        ref={ref}
        role="timer"
        aria-live="off"
        aria-label={state === "expired" ? "SLA expired" : `SLA ${label} remaining`}
        data-sla={state}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-mono font-medium leading-none tabular",
          STATE_CLASS[state],
          size === "sm" ? "h-[18px] px-1.5 text-2xs" : "h-[22px] px-2 text-xs",
          className,
        )}
        {...rest}
      >
        {noIcon ? null : (
          <Icon
            className={cn(
              size === "sm" ? "size-3" : "size-3.5",
              state === "danger" && "fa-pulse rounded-full",
            )}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        )}
        {label}
      </span>
    </Tooltip>
  );
});
