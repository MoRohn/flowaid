import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";

export type ProgressTone = "accent" | "ok" | "warn" | "danger" | "neutral";

export interface ProgressBarProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Fraction in [0, 1]. Omit for an indeterminate bar. */
  value?: number;
  tone?: ProgressTone;
  size?: "sm" | "md";
  /** Show the percentage in mono to the right. */
  showValue?: boolean;
  label?: string;
}

const TONE_CLASS: Record<ProgressTone, string> = {
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  neutral: "bg-ink-3",
};

/** Clamps a fraction into [0, 1]; NaN becomes 0. */
export function clampFraction(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * Thin determinate/indeterminate progress. The determinate fill animates
 * with the base duration; the indeterminate sweep stops under reduced motion
 * and leaves a static partial bar.
 */
export const ProgressBar = forwardRef<HTMLDivElement, ProgressBarProps>(function ProgressBar(
  {
    value,
    tone = "accent",
    size = "sm",
    showValue = false,
    label = "Progress",
    className,
    ...rest
  },
  ref,
) {
  const indeterminate = value === undefined;
  const fraction = indeterminate ? 0 : clampFraction(value);
  return (
    <div ref={ref} className={cn("flex w-full min-w-0 items-center gap-2", className)} {...rest}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : Math.round(fraction * 100)}
        aria-busy={indeterminate || undefined}
        data-indeterminate={indeterminate || undefined}
        className={cn(
          "relative w-full flex-1 overflow-hidden rounded-full bg-surface-3",
          size === "sm" ? "h-1" : "h-1.5",
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-(--dur-base) ease-(--ease-out)",
            TONE_CLASS[tone],
            indeterminate && "fa-indeterminate w-2/5",
          )}
          style={indeterminate ? undefined : { width: `${fraction * 100}%` }}
        />
      </div>
      {showValue && !indeterminate ? (
        <span className="w-9 shrink-0 text-right font-mono text-2xs text-ink-2 tabular">
          {formatPercent(fraction)}
        </span>
      ) : null}
    </div>
  );
});
