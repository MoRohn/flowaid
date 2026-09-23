import { forwardRef, type HTMLAttributes } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { formatProbability } from "@/lib/format";
import { noulReadout } from "./distribution";

export interface NoulGaugeProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** P(yes) in [0, 1]. */
  probability: number;
  /** Total width of the "undecided" band centred on 0.5 (default 0.2 → 0.40–0.60). */
  undecidedWidth?: number;
  /** Tiny inline variant for cards and tables: a 40×5 bar and the readout. */
  inline?: boolean;
  /** Hide the mono readout. */
  hideReadout?: boolean;
  /** Labels at the ends of the bar (full variant). */
  noLabel?: string;
  yesLabel?: string;
}

/** True when P(yes) falls inside the undecided band. */
export function noulIsUndecided(pYes: number, undecidedWidth = 0.2): boolean {
  const half = Math.max(0, undecidedWidth) / 2;
  return Math.abs(pYes - 0.5) < half;
}

/**
 * Boolean ("noul") decision gauge: a bipolar bar centred at 0.5 that fills
 * from the centre toward YES in the decision hue or toward NO in graphite,
 * with an undecided band around the middle and a mono readout ("0.96 yes").
 */
export const NoulGauge = forwardRef<HTMLDivElement, NoulGaugeProps>(function NoulGauge(
  {
    probability,
    undecidedWidth = 0.2,
    inline = false,
    hideReadout = false,
    noLabel = "no",
    yesLabel = "yes",
    className,
    ...rest
  },
  ref,
) {
  const reduced = useReducedMotion();
  const p = Number.isFinite(probability) ? Math.min(1, Math.max(0, probability)) : 0.5;
  const { answer, probability: pAnswer } = noulReadout(p);
  const undecided = noulIsUndecided(p, undecidedWidth);
  const half = Math.max(0, Math.min(1, undecidedWidth)) / 2;
  const fillFrom = Math.min(p, 0.5);
  const fillWidth = Math.abs(p - 0.5);
  const fillColor = answer === "yes" ? "var(--p-1)" : "var(--ink-3)";
  const transition = reduced
    ? { duration: 0 }
    : { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] as const };
  const readoutText = undecided
    ? `${formatProbability(p)} undecided`
    : `${formatProbability(pAnswer)} ${answer}`;
  const label = `P(yes) ${formatProbability(p)}: ${readoutText}`;

  const bar = (
    <div
      className={cn(
        "relative w-full min-w-0 overflow-hidden rounded-[2px] bg-surface-3",
        inline ? "h-[5px]" : "h-2",
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 bg-ink-4/35"
        style={{
          left: `${((0.5 - half) * 100).toFixed(3)}%`,
          width: `${(half * 200).toFixed(3)}%`,
        }}
      />
      <motion.span
        aria-hidden="true"
        initial={false}
        animate={{
          left: `${(fillFrom * 100).toFixed(3)}%`,
          width: `${(fillWidth * 100).toFixed(3)}%`,
        }}
        transition={transition}
        className="absolute inset-y-0"
        style={{
          left: `${(fillFrom * 100).toFixed(3)}%`,
          width: `${(fillWidth * 100).toFixed(3)}%`,
          backgroundColor: fillColor,
          opacity: undecided ? 0.55 : 1,
        }}
      />
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-ink/40"
      />
      <motion.span
        aria-hidden="true"
        initial={false}
        animate={{ left: `${(p * 100).toFixed(3)}%` }}
        transition={transition}
        className={cn(
          "absolute inset-y-0 -translate-x-1/2 rounded-full bg-ink",
          inline ? "w-px" : "w-0.5",
        )}
        style={{ left: `${(p * 100).toFixed(3)}%` }}
      />
    </div>
  );

  const readout = hideReadout ? null : (
    <span
      className={cn(
        "shrink-0 whitespace-nowrap font-mono leading-none tabular",
        inline ? "text-2xs" : "text-xs",
        undecided ? "text-ink-3" : "text-ink",
      )}
      data-answer={undecided ? "undecided" : answer}
    >
      {readoutText}
    </span>
  );

  if (inline) {
    return (
      <div
        ref={ref}
        role="img"
        aria-label={label}
        data-answer={undecided ? "undecided" : answer}
        className={cn("inline-flex items-center gap-1.5 align-middle", className)}
        {...rest}
      >
        <span className="inline-block w-10 shrink-0">{bar}</span>
        {readout}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      data-answer={undecided ? "undecided" : answer}
      className={cn("flex w-full min-w-0 flex-col gap-1.5", className)}
      {...rest}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "w-6 shrink-0 text-right font-mono text-2xs uppercase leading-none tracking-[0.06em]",
            answer === "no" && !undecided ? "text-ink" : "text-ink-3",
          )}
        >
          {noLabel}
        </span>
        {bar}
        <span
          className={cn(
            "w-6 shrink-0 font-mono text-2xs uppercase leading-none tracking-[0.06em]",
            answer === "yes" && !undecided ? "text-accent-text" : "text-ink-3",
          )}
        >
          {yesLabel}
        </span>
      </div>
      {readout ? (
        <div className="flex items-center justify-between pl-[34px] pr-[34px] font-mono text-2xs leading-none text-ink-3 tabular">
          <span>0</span>
          {readout}
          <span>1</span>
        </div>
      ) : null}
    </div>
  );
});
