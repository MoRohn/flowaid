import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { Layers } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCost, formatMs } from "@/lib/format";
import type { ConfidenceThresholds, DecisionResult } from "@/types";
import { DecisionCard } from "./DecisionCard";
import { failoverFromAttempts } from "./FailoverNotice";

export interface DecisionBundleItem {
  id: string;
  /** Decision name shown in the card header, e.g. "Urgency". */
  name: string;
  result: DecisionResult;
  /** The question this decision answered. */
  question?: string;
  /** Per-decision gate; falls back to the bundle's `thresholds`. */
  thresholds?: ConfidenceThresholds;
}

export interface DecisionBundleProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  items: DecisionBundleItem[];
  /** Bundle title, e.g. "Triage batch". */
  title?: ReactNode;
  /** Request id shown in mono in the header. */
  requestId?: string;
  /** Wall-clock latency of the whole batch; defaults to the slowest decision. */
  latencyMs?: number;
  /** Provider that served the batch, when every decision shares one. */
  provider?: string;
  /** Shared gate thresholds; shows a ConfidenceMeter in every card. */
  thresholds?: ConfidenceThresholds;
  /** Minimum card width in px for the responsive grid. */
  minCardWidth?: number;
}

/** Sum of `costUsd` across a bundle, or undefined for an empty bundle. */
export function bundleCost(items: readonly DecisionBundleItem[]): number | undefined {
  if (!items.length) return undefined;
  return items.reduce(
    (total, it) => total + (Number.isFinite(it.result.costUsd) ? it.result.costUsd : 0),
    0,
  );
}

/**
 * Several decisions answered in one request: a shared header with the
 * request id, latency and cost, and a responsive grid of compact
 * DecisionCards.
 */
export const DecisionBundle = forwardRef<HTMLDivElement, DecisionBundleProps>(
  function DecisionBundle(
    {
      items,
      title = "Decision bundle",
      requestId,
      latencyMs,
      provider,
      thresholds,
      minCardWidth = 240,
      className,
      ...rest
    },
    ref,
  ) {
    const latency = latencyMs ?? Math.max(0, ...items.map((it) => it.result.latencyMs));
    const cost = bundleCost(items);
    const failovers = items.filter(
      (it) => failoverFromAttempts(it.result.attempts) !== undefined,
    ).length;
    return (
      <section
        ref={ref}
        className={cn(
          "flex min-w-0 flex-col rounded-md border border-border bg-surface-2 shadow-1",
          className,
        )}
        {...rest}
      >
        <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 rounded-t-md">
          <Layers className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden="true" />
          <h2 className="m-0 min-w-0 truncate text-xs font-medium text-ink">{title}</h2>
          <span className="shrink-0 font-mono text-2xs text-ink-3 tabular">
            {items.length} decision{items.length === 1 ? "" : "s"} · 1 request
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-3 font-mono text-2xs text-ink-3 tabular">
            {failovers > 0 ? (
              <span className="text-warn-text">
                {failovers} failover{failovers === 1 ? "" : "s"}
              </span>
            ) : null}
            {provider ? <span className="hidden sm:inline">{provider}</span> : null}
            {requestId ? <span className="hidden sm:inline">{requestId}</span> : null}
            {cost !== undefined ? <span>{formatCost(cost)}</span> : null}
            <span className="text-ink-2">{formatMs(latency)}</span>
          </span>
        </header>
        <div
          className="grid gap-3 p-3"
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(min(${minCardWidth}px, 100%), 1fr))`,
          }}
        >
          {items.map((it) => (
            <DecisionCard
              key={it.id}
              title={it.name}
              result={it.result}
              question={it.question}
              thresholds={it.thresholds ?? thresholds}
              compact
              maxRows={4}
            />
          ))}
        </div>
      </section>
    );
  },
);
