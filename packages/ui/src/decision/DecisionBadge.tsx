import { forwardRef, useMemo, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Badge, badgeVariants } from "@/primitives/Badge";
import type { DecisionResult } from "@/types";
import { DistributionPopover } from "./DistributionPopover";
import { mergeRefs } from "./mergeRefs";
import { decisionSummary } from "./distribution";

export { decisionTooltipRows } from "./DistributionPopover";

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
    <DistributionPopover
      result={result}
      question={question}
      label={`Decision distribution: ${value || number}`}
    >
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
    </DistributionPopover>
  );
});
