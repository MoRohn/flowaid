import { forwardRef, useMemo, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import type { NodeRunView } from "@/types";
import { Badge, StatusChip, Tabs, TabsContent, TabsList, TabsTrigger } from "@/primitives";
import { formatClock } from "./traceFormat";
import { toMs } from "./timeScale";
import { TraceJsonBlock } from "./TraceJsonBlock";

export interface RetryAttemptsProps extends HTMLAttributes<HTMLDivElement> {
  /** Every attempt of one node run, in any order. */
  attempts: NodeRunView[];
  /** Attempt number to show first; defaults to the latest. */
  defaultAttempt?: number;
}

/** Delay between the end of the previous attempt and the start of this one, in ms. */
export function attemptDelayMs(
  prev: NodeRunView | undefined,
  current: NodeRunView,
): number | undefined {
  if (!prev) return undefined;
  const end = toMs(prev.endedAt);
  const start = toMs(current.startedAt);
  if (end === undefined || start === undefined) return undefined;
  return Math.max(0, start - end);
}

/**
 * Tabs per attempt (1, 2, 3…), each showing the outcome, error, timing and
 * the back-off delay since the previous attempt. Failed attempts show a
 * danger dot on their tab.
 */
export const RetryAttempts = forwardRef<HTMLDivElement, RetryAttemptsProps>(function RetryAttempts(
  { attempts, defaultAttempt, className, ...rest },
  ref,
) {
  const sorted = useMemo(() => [...attempts].sort((a, b) => a.attempt - b.attempt), [attempts]);
  const last = sorted[sorted.length - 1];
  if (!last) return null;
  const initial = String(defaultAttempt ?? last.attempt);
  return (
    <div ref={ref} className={cn("flex min-w-0 flex-col", className)} {...rest}>
      <Tabs defaultValue={initial} size="sm">
        <TabsList aria-label="Attempts">
          {sorted.map((a) => (
            <TabsTrigger
              key={a.id}
              value={String(a.attempt)}
              badge={
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 rounded-full",
                    a.status === "failed"
                      ? "bg-danger"
                      : a.status === "completed"
                        ? "bg-ok"
                        : "bg-info",
                  )}
                />
              }
            >
              Attempt {a.attempt}
            </TabsTrigger>
          ))}
        </TabsList>
        {sorted.map((a, i) => {
          const delay = attemptDelayMs(sorted[i - 1], a);
          return (
            <TabsContent key={a.id} value={String(a.attempt)} className="flex flex-col gap-2 pt-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <StatusChip status={a.status} size="sm" />
                <span className="font-mono text-2xs text-ink-3 tabular">
                  {formatClock(a.startedAt)}
                  {a.durationMs !== undefined ? ` · ${formatMs(a.durationMs)}` : ""}
                </span>
                {delay !== undefined ? (
                  <span className="font-mono text-2xs text-ink-3 tabular">
                    · after {formatMs(delay)} back-off
                  </span>
                ) : null}
                {a.error?.retryable ? (
                  <Badge tone="warn" size="sm" mono>
                    retryable
                  </Badge>
                ) : null}
              </div>
              {a.error ? (
                <p className="flex items-start gap-2 rounded-sm border border-danger/30 bg-danger-soft px-2.5 py-2 text-xs text-danger-text">
                  <Badge tone="danger" size="sm" mono>
                    {a.error.code}
                  </Badge>
                  <span className="min-w-0 break-words">{a.error.message}</span>
                </p>
              ) : null}
              {a.toolCall?.result !== undefined ? (
                <TraceJsonBlock
                  label="result"
                  value={a.toolCall.result}
                  maxChars={600}
                  maxHeight={140}
                />
              ) : a.output !== undefined ? (
                <TraceJsonBlock label="output" value={a.output} maxChars={600} maxHeight={140} />
              ) : null}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
});
