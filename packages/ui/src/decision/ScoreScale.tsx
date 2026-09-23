import { forwardRef, useMemo, type HTMLAttributes } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { formatProbability } from "@/lib/format";

export interface ScoreScaleProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Ordered level labels, lowest first (e.g. Minimal → Critical). */
  levels: string[];
  /** Fractional level index, e.g. 3.72 sits between levels[3] and levels[4]. */
  score: number;
  /** Per-level probability keyed by level index as a string, or by position. */
  probabilities?: Record<string, number> | number[];
  /** Provider confidence in [0, 1]; shown as a readout when given. */
  confidence?: number;
  /** Height of the tallest probability bar in px. */
  barHeight?: number;
  /** Hide the "score · level" readout row. */
  hideReadout?: boolean;
  size?: "sm" | "md";
}

/**
 * Fraction across the scale for a score: level `i` is centred at `(i + 0.5) / n`,
 * so a fractional score lands between two level cells. Clamped to [0, 1].
 */
export function scorePointerFraction(score: number, levelCount: number): number {
  if (levelCount <= 0 || !Number.isFinite(score)) return 0;
  return Math.min(1, Math.max(0, (score + 0.5) / levelCount));
}

/** The level a score rounds to; undefined outside the scale. */
export function scoreLevelIndex(score: number, levelCount: number): number | undefined {
  if (levelCount <= 0 || !Number.isFinite(score)) return undefined;
  const i = Math.round(score);
  return i >= 0 && i < levelCount ? i : undefined;
}

/**
 * Ordinal scale for score decisions: level cells with a fractional pointer at
 * the score, per-level probability as bar heights above the cells, and a
 * confidence readout. The level the score rounds to is set in ink.
 */
export const ScoreScale = forwardRef<HTMLDivElement, ScoreScaleProps>(function ScoreScale(
  {
    levels,
    score,
    probabilities,
    confidence,
    barHeight = 28,
    hideReadout = false,
    size = "md",
    className,
    ...rest
  },
  ref,
) {
  const reduced = useReducedMotion();
  const n = levels.length;
  const fraction = scorePointerFraction(score, n);
  const chosen = scoreLevelIndex(score, n);
  const probs = useMemo(() => {
    const out = levels.map((_, i) => {
      const v = Array.isArray(probabilities) ? probabilities[i] : probabilities?.[String(i)];
      return v !== undefined && Number.isFinite(v) && v > 0 ? v : 0;
    });
    const total = out.reduce((s, v) => s + v, 0);
    return total > 0 ? out.map((v) => v / total) : out;
  }, [levels, probabilities]);
  const maxP = Math.max(...probs, 0);
  const hasProbs = maxP > 0;
  const transition = reduced
    ? { duration: 0 }
    : { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] as const };
  const chosenLabel = chosen === undefined ? undefined : levels[chosen];
  const scoreText = Number.isFinite(score) ? score.toFixed(2) : "—";
  const ariaLabel = `Score ${scoreText}${chosenLabel ? ` (${chosenLabel})` : ""} on a ${n}-level scale${
    confidence !== undefined ? `, confidence ${formatProbability(confidence)}` : ""
  }`;

  return (
    <div
      ref={ref}
      role="img"
      aria-label={ariaLabel}
      data-level={chosen}
      className={cn("flex w-full min-w-0 flex-col", size === "sm" ? "gap-1" : "gap-1.5", className)}
      {...rest}
    >
      {!hideReadout ? (
        <div className="flex items-baseline justify-between gap-3 font-mono leading-none tabular">
          <span className={cn("text-ink", size === "sm" ? "text-2xs" : "text-xs")}>
            {scoreText}
            {chosenLabel ? <span className="text-ink-3"> · {chosenLabel}</span> : null}
          </span>
          {confidence !== undefined ? (
            <span className="text-2xs text-ink-3">conf {formatProbability(confidence)}</span>
          ) : null}
        </div>
      ) : null}

      {hasProbs ? (
        <div
          className="grid items-end gap-[3px]"
          style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, height: barHeight }}
          aria-hidden="true"
        >
          {probs.map((p, i) => (
            <div key={i} className="flex h-full flex-col justify-end">
              <motion.span
                initial={false}
                animate={{ height: `${((p / maxP) * 100).toFixed(2)}%` }}
                transition={transition}
                className="block w-full rounded-t-[2px]"
                style={{
                  height: `${((p / maxP) * 100).toFixed(2)}%`,
                  minHeight: p > 0 ? 2 : 0,
                  backgroundColor: i === chosen ? "var(--p-1)" : "var(--p-2)",
                }}
              />
            </div>
          ))}
        </div>
      ) : null}

      <div className="relative">
        <div
          className="grid gap-[3px]"
          style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
        >
          {levels.map((_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={cn("block rounded-[2px]", size === "sm" ? "h-1" : "h-1.5")}
              style={{ backgroundColor: i === chosen ? "var(--p-1)" : "var(--p-4)" }}
            />
          ))}
        </div>
        <motion.span
          aria-hidden="true"
          initial={false}
          animate={{ left: `${(fraction * 100).toFixed(3)}%` }}
          transition={transition}
          className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-ink"
          style={{ left: `${(fraction * 100).toFixed(3)}%` }}
        />
      </div>

      <div
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
        aria-hidden="true"
      >
        {levels.map((label, i) => (
          <span
            key={i}
            className={cn(
              "flex min-w-0 flex-col items-center gap-0.5 text-center leading-none",
              "text-2xs",
              i === chosen ? "font-medium text-ink" : "text-ink-3",
            )}
          >
            <span className="w-full truncate">{label}</span>
            {hasProbs ? (
              <span className={cn("font-mono tabular", i === chosen ? "text-ink-2" : "text-ink-3")}>
                {formatProbability(probs[i] ?? 0)}
              </span>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
});
