import { forwardRef, useMemo, type HTMLAttributes } from "react";
import { mergeRefs } from "./mergeRefs";
import { monoTextWidth, useMeasuredWidth } from "./useMeasuredWidth";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { formatProbability } from "@/lib/format";
import {
  argmax,
  normalizeDistribution,
  rampVar,
  type DistributionInput,
  type NormalizeOptions,
} from "./distribution";

export type ProbabilityRulerSize = "xs" | "sm" | "md" | "lg";

const HEIGHT: Record<ProbabilityRulerSize, string> = {
  xs: "h-1",
  sm: "h-1.5",
  md: "h-2",
  lg: "h-3",
};

export interface ProbabilityRulerProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  distribution: DistributionInput;
  /** Option key drawn in `--p-1`. Defaults to the most probable option. */
  chosen?: string;
  /** Label lookup for keys (a score legend). */
  labels?: Record<string, string>;
  /** Sort segments by probability (default). Off keeps input order for ordinal scales. */
  sort?: boolean;
  /** Render `label p` under every segment of 10% or more. */
  showLabels?: boolean;
  /** Minimum probability a segment needs before it gets a label, used until the strip has been measured; once measured, a label shows whenever it fits its segment. */
  labelThreshold?: number;
  size?: ProbabilityRulerSize;
}

/**
 * The brand's signature: a strip whose segments are proportional to a
 * distribution. The chosen segment is `--p-1`, the rest descend the ramp.
 * Widths animate on change (200ms, off under reduced motion). Never
 * decorative: it always draws real numbers, and the aria-label reads them out.
 */
export const ProbabilityRuler = forwardRef<HTMLDivElement, ProbabilityRulerProps>(
  function ProbabilityRuler(
    {
      distribution,
      chosen,
      labels,
      sort = true,
      showLabels = false,
      labelThreshold = 0.1,
      size = "md",
      className,
      ...rest
    },
    ref,
  ) {
    const reduced = useReducedMotion();
    const { ref: measureRef, width } = useMeasuredWidth<HTMLDivElement>();
    const entries = useMemo(() => {
      const opts: NormalizeOptions = { sort };
      if (labels) opts.labels = labels;
      return normalizeDistribution(distribution, opts);
    }, [distribution, labels, sort]);
    const winner = chosen ?? argmax(entries);
    let rank = 0;
    const segments = entries.map((e) => {
      const isChosen = e.key === winner;
      const color = rampVar(rank, isChosen);
      if (!isChosen) rank += 1;
      return { ...e, color, isChosen };
    });
    const description = segments
      .map((s) => `${s.label ?? s.key} ${formatProbability(s.probability)}`)
      .join(", ");
    const transition = reduced
      ? { duration: 0 }
      : { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] as const };
    const gapTotal = 3 * Math.max(0, segments.length - 1);
    const labelFits = (p: number, text: string) =>
      width > 0 ? p * (width - gapTotal) >= monoTextWidth(text) + 2 : p >= labelThreshold;

    return (
      <div
        ref={mergeRefs(ref, measureRef)}
        role="img"
        aria-label={`Probability ruler: ${description}`}
        data-chosen={winner}
        className={cn("flex w-full min-w-0 flex-col gap-1.5", className)}
        {...rest}
      >
        <div className={cn("flex w-full gap-[3px]", HEIGHT[size])}>
          {segments.map((s) => (
            <motion.i
              key={s.key}
              data-key={s.key}
              data-p={s.probability.toFixed(4)}
              initial={false}
              animate={{ flexGrow: Math.max(s.probability, 0.004) }}
              transition={transition}
              className="block min-w-0.5 basis-0 rounded-[2px]"
              style={{ backgroundColor: s.color, flexGrow: Math.max(s.probability, 0.004) }}
            />
          ))}
        </div>
        {showLabels ? (
          <div className="flex w-full gap-[3px] font-mono text-2xs leading-none text-ink-3 tabular">
            {segments.map((s) => (
              <motion.span
                key={s.key}
                initial={false}
                animate={{ flexGrow: Math.max(s.probability, 0.004) }}
                transition={transition}
                className={cn(
                  "min-w-0 basis-0 overflow-hidden whitespace-nowrap",
                  s.isChosen && "text-accent-text",
                )}
                style={{ flexGrow: Math.max(s.probability, 0.004) }}
                aria-hidden="true"
              >
                {labelFits(s.probability, `${s.label ?? s.key} ${formatProbability(s.probability)}`)
                  ? `${s.label ?? s.key} ${formatProbability(s.probability)}`
                  : ""}
              </motion.span>
            ))}
          </div>
        ) : null}
      </div>
    );
  },
);
