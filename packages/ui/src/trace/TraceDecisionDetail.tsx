import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import type { DecisionResult } from "@/types";
import { assertNever } from "@/types";
import {
  DistributionList,
  FailoverNotice,
  NoulGauge,
  ProbabilityRuler,
  ScoreScale,
  failoverFromAttempts,
} from "@/decision";

export interface TraceDecisionDetailProps extends HTMLAttributes<HTMLDivElement> {
  decision: DecisionResult;
  /** The question the decision answered (`DECISION_COMPLETED.question`). */
  question?: string;
  /** Hide the provider / model / latency meta row. */
  noMeta?: boolean;
}

/**
 * Inline decision result for an expanded trace row: the probability ruler
 * and distribution list for choices, the noul gauge for booleans and the
 * score scale for scores, followed by provider, model and latency, and a
 * compact failover notice when a fallback provider answered.
 */
export const TraceDecisionDetail = forwardRef<HTMLDivElement, TraceDecisionDetailProps>(
  function TraceDecisionDetail({ decision, question, noMeta = false, className, ...rest }, ref) {
    const failover = failoverFromAttempts(decision.attempts);
    let visual;
    switch (decision.kind) {
      case "boolean":
        visual = <NoulGauge probability={decision.pYes} className="max-w-sm" />;
        break;
      case "score":
        visual = (
          <ScoreScale
            levels={decision.levels}
            score={decision.value}
            probabilities={decision.probabilities}
            confidence={decision.confidence}
            size="sm"
            barHeight={20}
            className="max-w-md"
          />
        );
        break;
      case "choice":
        visual = (
          <div className="flex min-w-0 max-w-md flex-col gap-2">
            <ProbabilityRuler
              distribution={decision.probabilities}
              chosen={decision.value}
              size="sm"
            />
            <DistributionList
              distribution={decision.probabilities}
              chosen={decision.value}
              density="compact"
              maxRows={4}
            />
          </div>
        );
        break;
      default:
        visual = assertNever(decision, "decision kind");
    }
    return (
      <div
        ref={ref}
        data-kind={decision.kind}
        className={cn("flex min-w-0 flex-col gap-2", className)}
        {...rest}
      >
        {question ? <p className="truncate text-xs text-ink-2">{question}</p> : null}
        {visual}
        {!noMeta ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-2xs text-ink-3 tabular">
            <span>{decision.provider}</span>
            <span>{decision.model}</span>
            <span>{formatMs(decision.latencyMs)}</span>
            {decision.kind !== "score" ? <span>conf {decision.confidence.toFixed(2)}</span> : null}
          </p>
        ) : null}
        {failover ? (
          <FailoverNotice
            compact
            provider={decision.provider}
            model={decision.model}
            failover={failover}
            className="max-w-md"
          />
        ) : null}
      </div>
    );
  },
);
