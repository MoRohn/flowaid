import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import type { RunStatus } from "@/lib/categories";
import { StatusChip } from "@/primitives";
import { formatClock } from "./traceFormat";
import { toMs } from "./timeScale";
import { useNow } from "./useNow";

export interface RunTransitionView {
  status: RunStatus;
  at: string;
  /** Optional note, e.g. the node the run waited on. */
  note?: string;
}

export interface RunStatusTimelineProps extends HTMLAttributes<HTMLDivElement> {
  transitions: RunTransitionView[];
  /** The last state is still current; its duration runs to now. */
  live?: boolean;
  now?: number;
}

const TERMINAL: ReadonlySet<RunStatus> = new Set(["completed", "failed", "cancelled", "timed_out"]);

/**
 * Horizontal chain of run state transitions (queued → starting → running →
 * waiting for approval → running → completed) with the wall-clock time of
 * each transition and the time spent in each state. Scrolls horizontally
 * when there is not enough room.
 */
export const RunStatusTimeline = forwardRef<HTMLDivElement, RunStatusTimelineProps>(
  function RunStatusTimeline({ transitions, live, now, className, ...rest }, ref) {
    const last = transitions[transitions.length - 1];
    const isLive = live ?? (last !== undefined && !TERMINAL.has(last.status));
    const nowMs = useNow(isLive, 1000, now);
    return (
      <div
        ref={ref}
        role="list"
        aria-label="Run state transitions"
        className={cn("flex min-w-0 items-start gap-0 overflow-x-auto py-1", className)}
        {...rest}
      >
        {transitions.map((t, i) => {
          const next = transitions[i + 1];
          const start = toMs(t.at);
          const end = next ? toMs(next.at) : isLive ? nowMs : undefined;
          const spent =
            start !== undefined && end !== undefined ? Math.max(0, end - start) : undefined;
          const isLast = i === transitions.length - 1;
          return (
            <div
              key={`${t.status}-${t.at}-${i}`}
              role="listitem"
              className="flex shrink-0 items-start"
            >
              <div className="flex flex-col items-start gap-1">
                <StatusChip status={t.status} size="sm" />
                <span className="pl-1 font-mono text-2xs text-ink-3 tabular">
                  {formatClock(t.at)}
                </span>
                {t.note ? (
                  <span className="max-w-40 truncate pl-1 text-2xs text-ink-3">{t.note}</span>
                ) : null}
              </div>
              {!isLast || isLive ? (
                <div className="flex w-20 flex-col items-center gap-1 pt-[7px]">
                  <span className="relative h-px w-full bg-border-strong">
                    {isLast && isLive ? (
                      <span className="fa-pulse absolute -right-0.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-info" />
                    ) : (
                      <span className="absolute -right-px top-1/2 size-1 -translate-y-1/2 rotate-45 border-r border-t border-border-strong" />
                    )}
                  </span>
                  <span className="font-mono text-2xs text-ink-3 tabular">
                    {spent !== undefined ? formatMs(spent) : "—"}
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  },
);
