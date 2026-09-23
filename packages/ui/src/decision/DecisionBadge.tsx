import { forwardRef, useMemo, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { formatProbability } from "@/lib/format";
import { Badge, badgeVariants } from "@/primitives/Badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import type { DecisionResult } from "@/types";
import { DistributionList } from "./DistributionList";
import { mergeRefs } from "./mergeRefs";
import {
  decisionSummary,
  noulProbability,
  normalizeDistribution,
  scoreLegend,
  type DistributionEntry,
} from "./distribution";

export interface DecisionBadgeProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  result: DecisionResult;
  /** The question the decision answered (from `DECISION_COMPLETED.question`), shown in the popover. */
  question?: string;
  size?: "sm" | "md";
  /**
   * Render the badge as a button that opens the full distribution in a popover (default).
   * `false` renders a plain badge, for places that are already inside a control.
   */
  distribution?: boolean;
  /** Tone: accent (default) for the winner, neutral for secondary mentions. */
  tone?: "accent" | "neutral" | "outline";
}

/** Rows shown in the badge popover: the full distribution for choice/score, yes/no for boolean. */
export function decisionTooltipRows(result: DecisionResult): DistributionEntry[] {
  if (result.kind === "boolean") {
    const pYes = noulProbability(result);
    return [
      { key: "yes", label: "yes", probability: pYes },
      { key: "no", label: "no", probability: 1 - pYes },
    ].sort((a, b) => b.probability - a.probability);
  }
  return normalizeDistribution(
    result.probabilities,
    result.kind === "score" ? { labels: scoreLegend(result.levels) } : {},
  );
}

/** The popover body: the question, the full distribution, the score scale and the provider. */
function DistributionPanel({ result, question }: { result: DecisionResult; question?: string }) {
  const rows = decisionTooltipRows(result);
  const levels = result.kind === "score" ? result.levels : [];
  return (
    <div className="flex flex-col gap-2">
      {question ? <p className="m-0 text-xs leading-snug text-ink-2">{question}</p> : null}
      {rows.length ? (
        <DistributionList
          distribution={rows}
          chosen={result.kind === "choice" ? result.value : undefined}
          density="compact"
          aria-label="Distribution"
        />
      ) : null}
      {result.kind === "score" && levels.length ? (
        <p className="m-0 font-mono text-2xs text-ink-3 tabular">
          {levels.length} levels · conf {formatProbability(result.confidence)}
        </p>
      ) : null}
      <p className="m-0 font-mono text-2xs text-ink-3">
        {result.provider}:{result.model}
      </p>
    </div>
  );
}

/**
 * Compact inline pill for a decision, formatted by kind: "security 0.81",
 * "yes 0.96", "3.7 High". By default the pill is a focusable button (named by its
 * visible text) that opens the full distribution in a popover on click, Enter or
 * Space; Escape closes it and returns focus. `distribution={false}` renders a plain,
 * non-interactive badge (for use inside another control).
 */
export const DecisionBadge = forwardRef<HTMLElement, DecisionBadgeProps>(function DecisionBadge(
  { result, question, size = "md", distribution = true, tone = "accent", className, ...rest },
  ref,
) {
  const setRef = useMemo(() => mergeRefs<HTMLElement>(ref), [ref]);
  const { value, number } = decisionSummary(result);
  const scoreFirst = result.kind === "score";
  const content = scoreFirst ? (
    <>
      <span>{number}</span>
      {value ? <span className="font-sans font-medium">{value}</span> : null}
    </>
  ) : (
    <>
      <span className="max-w-32 truncate font-sans font-medium">{value}</span>
      <span>{number}</span>
    </>
  );
  if (!distribution) {
    return (
      <Badge
        ref={setRef}
        tone={tone}
        size={size}
        mono
        data-kind={result.kind}
        className={cn("gap-1.5 whitespace-nowrap", className)}
        {...rest}
      >
        {content}
      </Badge>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          ref={setRef}
          type="button"
          data-kind={result.kind}
          className={cn(
            badgeVariants({ tone, size, mono: true }),
            "cursor-pointer gap-1.5 whitespace-nowrap outline-none transition-shadow duration-(--dur-fast)",
            "hover:shadow-1 focus-visible:shadow-(--focus) data-[state=open]:shadow-1",
            className,
          )}
          {...rest}
        >
          {content}
        </button>
      </PopoverTrigger>
      <PopoverContent
        width="auto"
        className="min-w-56 max-w-72"
        aria-label={`Decision distribution: ${value || number}`}
      >
        <DistributionPanel result={result} question={question} />
      </PopoverContent>
    </Popover>
  );
});
