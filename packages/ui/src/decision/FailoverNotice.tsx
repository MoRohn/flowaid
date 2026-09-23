import { forwardRef, type HTMLAttributes } from "react";
import { ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ProviderAttempt } from "@/types";

export interface FailoverNoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Provider that answered, e.g. "openai". */
  provider: string;
  /** Model that answered, e.g. "gpt-5-mini". */
  model: string;
  /** Primary that failed and why, as stored on the decision result. */
  failover: { from: string; reason: string };
  /** Single-line variant for card footers. */
  compact?: boolean;
}

/** What a failed hop did, for the notice: "failed (PROVIDER_ERROR)" / "was skipped (unhealthy)". */
export function attemptReason(attempt: Pick<ProviderAttempt, "outcome" | "errorCode">): string {
  if (attempt.outcome === "skipped_unhealthy") return "was skipped (unhealthy)";
  return attempt.errorCode ? `failed (${attempt.errorCode})` : "failed";
}

/**
 * The failover a decision's `attempts[]` chain records: the first hop that
 * did not answer, when a later one did. Undefined when the primary answered.
 */
export function failoverFromAttempts(
  attempts: readonly ProviderAttempt[],
): { from: string; reason: string } | undefined {
  const failed = attempts.find((a) => a.outcome !== "ok");
  const answered = attempts.some((a) => a.outcome === "ok");
  if (!failed || !answered) return undefined;
  return { from: `${failed.provider}:${failed.model}`, reason: attemptReason(failed) };
}

/** Sentence for the notice: "Answered by openai:gpt-5-mini after TypeSafe timed out". */
export function failoverSentence(
  provider: string,
  model: string,
  failover: { from: string; reason: string },
): string {
  return `Answered by ${provider}:${model} after ${failover.from} ${failover.reason}`;
}

/**
 * Amber notice shown on a decision when a fallback provider answered instead
 * of the primary. Names the fallback, the primary and the cause, and nothing
 * else: the outcome was still a valid decision.
 */
export const FailoverNotice = forwardRef<HTMLDivElement, FailoverNoticeProps>(
  function FailoverNotice({ provider, model, failover, compact = false, className, ...rest }, ref) {
    return (
      <div
        ref={ref}
        role="note"
        data-failover-from={failover.from}
        className={cn(
          "flex items-start gap-2 rounded-sm border border-warn/30 bg-warn-soft text-warn-text",
          compact ? "px-2 py-1 text-2xs" : "px-2.5 py-1.5 text-xs",
          className,
        )}
        {...rest}
      >
        <ArrowRightLeft
          className={cn("shrink-0", compact ? "mt-px size-3" : "mt-0.5 size-3.5")}
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <p className="m-0 min-w-0 leading-snug">
          Answered by{" "}
          <span className="font-mono tabular">
            {provider}:{model}
          </span>{" "}
          after <span className="font-mono">{failover.from}</span> {failover.reason}
        </p>
      </div>
    );
  },
);
