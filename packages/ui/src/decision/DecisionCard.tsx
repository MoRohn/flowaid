import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatCost, formatMs, formatTokens } from "@/lib/format";
import { CategoryDot } from "@/primitives/CategoryDot";
import type { ConfidenceThresholds, DecisionResult } from "@/types";
import { ConfidenceMeter } from "./ConfidenceMeter";
import { DecisionBadge } from "./DecisionBadge";
import { DistributionList } from "./DistributionList";
import { FailoverNotice, failoverFromAttempts } from "./FailoverNotice";
import { NoulGauge } from "./NoulGauge";
import { ProbabilityRuler } from "./ProbabilityRuler";
import { ScoreScale } from "./ScoreScale";
import { noulProbability } from "./distribution";

export interface DecisionCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  result: DecisionResult;
  /** The question the decision answered (`DECISION_COMPLETED.question`); the result itself does not carry it. */
  question?: string;
  /** Node or decision name shown before the kind. Falls back to the kind alone. */
  title?: ReactNode;
  /** Gate thresholds; when given, a ConfidenceMeter is rendered under the visual. */
  thresholds?: ConfidenceThresholds;
  /** Tighter padding and the compact list density, for grids and inspectors. */
  compact?: boolean;
  /** Rows before the "+N more" disclosure in choice decisions. */
  maxRows?: number;
  /** Hide the provider / latency / cost footer. */
  hideFooter?: boolean;
  /** Extra content under the visual (a reason line, actions). */
  children?: ReactNode;
}

const KIND_LABEL: Record<DecisionResult["kind"], string> = {
  boolean: "noul",
  choice: "choice",
  score: "score",
};

/** The right visual for a decision kind. Exported so traces and inspectors can embed it without the card chrome. */
export function DecisionVisual({
  result,
  compact = false,
  maxRows,
  className,
}: {
  result: DecisionResult;
  compact?: boolean;
  maxRows?: number;
  className?: string;
}) {
  switch (result.kind) {
    case "boolean":
      return (
        <NoulGauge
          probability={noulProbability(result)}
          className={className}
          undecidedWidth={0.2}
        />
      );
    case "score": {
      return (
        <ScoreScale
          levels={result.levels}
          score={result.value}
          probabilities={result.probabilities}
          confidence={result.confidence}
          size={compact ? "sm" : "md"}
          barHeight={compact ? 20 : 28}
          className={className}
        />
      );
    }
    case "choice": {
      const probabilities = result.probabilities;
      return (
        <div className={cn("flex flex-col gap-2.5", className)}>
          <ProbabilityRuler
            distribution={probabilities}
            chosen={result.value}
            size={compact ? "xs" : "sm"}
          />
          <DistributionList
            distribution={probabilities}
            chosen={result.value}
            density={compact ? "compact" : "regular"}
            maxRows={maxRows}
          />
        </div>
      );
    }
  }
}

/**
 * Card for any DecisionResult: question, the kind-specific visual
 * (DistributionList, NoulGauge or ScoreScale), an optional confidence gate,
 * the failover notice when a fallback answered, and a mono footer with
 * provider, model, latency, tokens and cost.
 */
export const DecisionCard = forwardRef<HTMLDivElement, DecisionCardProps>(function DecisionCard(
  {
    result,
    question,
    title,
    thresholds,
    compact = false,
    maxRows,
    hideFooter = false,
    children,
    className,
    ...rest
  },
  ref,
) {
  const usage = result.usage;
  const tokens = usage
    ? `${formatTokens(usage.inputTokens)}→${formatTokens(usage.outputTokens)}`
    : null;
  const failover = failoverFromAttempts(result.attempts);
  return (
    <article
      ref={ref}
      data-kind={result.kind}
      className={cn(
        "flex min-w-0 flex-col rounded-md border border-border bg-surface text-ink shadow-1",
        className,
      )}
      {...rest}
    >
      <header className={cn("flex items-start gap-2", compact ? "px-3 pt-2.5" : "px-4 pt-3")}>
        <CategoryDot category="decision" className="mt-[5px]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            {title !== undefined ? (
              <span className="truncate text-xs font-medium text-ink">{title}</span>
            ) : null}
            <span className="shrink-0 font-mono text-2xs text-ink-3">
              {KIND_LABEL[result.kind]}
            </span>
          </div>
          {question ? (
            <p className={cn("m-0 text-ink-2", compact ? "text-2xs" : "text-xs")}>{question}</p>
          ) : null}
        </div>
        <DecisionBadge
          result={result}
          question={question}
          size={compact ? "sm" : "md"}
          className="shrink-0"
        />
      </header>

      <div className={cn("flex flex-col", compact ? "gap-2.5 px-3 py-2.5" : "gap-3 px-4 py-3")}>
        <DecisionVisual result={result} compact={compact} maxRows={maxRows} />
        {thresholds ? (
          <ConfidenceMeter
            confidence={result.confidence}
            thresholds={thresholds}
            size="sm"
            showTicks={false}
          />
        ) : null}
        {failover ? (
          <FailoverNotice
            provider={result.provider}
            model={result.model}
            failover={failover}
            compact={compact}
          />
        ) : null}
        {children}
      </div>

      {!hideFooter ? (
        <footer
          className={cn(
            "mt-auto flex items-center gap-3 border-t border-border font-mono text-2xs text-ink-3 tabular",
            compact ? "px-3 py-1.5" : "px-4 py-2",
          )}
        >
          <span className="min-w-0 truncate text-ink-2">
            {result.provider}:{result.model}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-3">
            {tokens ? <span>{tokens}</span> : null}
            <span>{formatCost(result.costUsd)}</span>
            <span className="text-ink-2">{formatMs(result.latencyMs)}</span>
          </span>
        </footer>
      ) : null}
    </article>
  );
});
