import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatClock } from "./traceFormat";

export interface ProviderFailoverView {
  from: string;
  to: string;
  reason: string;
  /** ISO time of the failover. */
  at?: string;
  /** Node that hit the failover. */
  nodeName?: string;
  /** Latency the failover cost, in ms. */
  latencyMs?: number;
}

export interface ProviderFailoverNoticeProps extends HTMLAttributes<HTMLDivElement> {
  failover: ProviderFailoverView;
  /** Optional action, e.g. a "View provider health" link button. */
  action?: ReactNode;
  /** Single-line variant for use inside rows. */
  compact?: boolean;
}

/**
 * Inline warn-toned notice for a PROVIDER_FAILOVER event: which provider
 * failed, which one answered instead, and why.
 */
export const ProviderFailoverNotice = forwardRef<HTMLDivElement, ProviderFailoverNoticeProps>(
  function ProviderFailoverNotice({ failover, action, compact = false, className, ...rest }, ref) {
    return (
      <div
        ref={ref}
        role="status"
        className={cn(
          "flex min-w-0 items-start gap-2 rounded-sm border border-warn/30 bg-warn-soft text-xs text-ink",
          compact ? "px-2 py-1" : "px-3 py-2",
          className,
        )}
        {...rest}
      >
        <TriangleAlert
          className="mt-px size-4 shrink-0 text-warn-text"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5">
            <span className="font-medium">Provider failover</span>
            {failover.nodeName ? <span className="text-ink-2">on {failover.nodeName}</span> : null}
            <span className="inline-flex items-center gap-1 font-mono text-2xs text-ink-2">
              <span className="line-through decoration-danger/60">{failover.from}</span>
              <ArrowRight className="size-3 text-ink-3" strokeWidth={1.75} aria-hidden="true" />
              <span className="text-ink">{failover.to}</span>
            </span>
            {failover.at ? (
              <span className="font-mono text-2xs text-ink-3 tabular">
                {formatClock(failover.at)}
              </span>
            ) : null}
          </p>
          {!compact ? (
            <p className="text-ink-2">
              {failover.reason}
              {failover.latencyMs !== undefined ? (
                <span className="font-mono text-2xs text-ink-3 tabular">
                  {" "}
                  · +{Math.round(failover.latencyMs)} ms
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        {action}
      </div>
    );
  },
);
