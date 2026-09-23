import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatCost, formatMs, formatTokens } from "@/lib/format";
import type { NodeRunView } from "@/types";
import { Badge, CategoryDot, StatusChip } from "@/primitives";

function Stat({ label, value, muted }: { label: string; value: ReactNode; muted?: boolean }) {
  return (
    <span className="flex items-baseline gap-1 whitespace-nowrap">
      <span className="text-2xs text-ink-3">{label}</span>
      <span className={cn("font-mono text-xs tabular", muted ? "text-ink-3" : "text-ink")}>
        {value}
      </span>
    </span>
  );
}

export interface NodeSummaryStripProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  nodeRun: NodeRunView;
  /** Provider/model label, e.g. "jev-latest". Falls back to the decision's provider. */
  provider?: string;
  /** Right-aligned controls (open inspector, open trace). */
  actions?: ReactNode;
  /** Highlight as the selected row. */
  selected?: boolean;
  onSelect?: () => void;
}

/**
 * One-row summary of a node run for the bottom panel: category dot, name,
 * status, then mono duration, cost, tokens and the provider.
 */
export const NodeSummaryStrip = forwardRef<HTMLDivElement, NodeSummaryStripProps>(
  function NodeSummaryStrip(
    { nodeRun, provider, actions, selected = false, onSelect, className, ...rest },
    ref,
  ) {
    const providerLabel = provider ?? nodeRun.decision?.provider;
    const usage = nodeRun.usage ?? nodeRun.decision?.usage;
    const cost = nodeRun.costUsd ?? nodeRun.decision?.costUsd;
    const inTok = usage?.inputTokens;
    const outTok = usage?.outputTokens;
    const interactive = onSelect !== undefined;
    return (
      <div
        ref={ref}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-pressed={interactive ? selected : undefined}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (!interactive) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        data-status={nodeRun.status}
        className={cn(
          "flex min-h-8 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-border bg-surface px-2.5 py-1",
          interactive && "cursor-pointer hover:bg-surface-3/60 focus-visible:rounded-sm",
          selected && "border-accent bg-accent-soft/40",
          className,
        )}
        {...rest}
      >
        <span className="flex min-w-0 items-center gap-2">
          <CategoryDot category={nodeRun.category} />
          <span className="truncate text-xs font-medium text-ink">{nodeRun.nodeName}</span>
          <span className="truncate font-mono text-2xs tracking-wide text-ink-3">
            {nodeRun.nodeType}
          </span>
        </span>
        <StatusChip
          status={nodeRun.status}
          size="sm"
          meta={nodeRun.attempt > 1 ? `×${nodeRun.attempt}` : undefined}
        />
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Stat
            label="dur"
            value={nodeRun.durationMs === undefined ? "—" : formatMs(nodeRun.durationMs)}
            muted={nodeRun.durationMs === undefined}
          />
          <Stat
            label="cost"
            value={cost === undefined ? "—" : formatCost(cost)}
            muted={cost === undefined}
          />
          <Stat
            label="tok"
            value={
              inTok === undefined && outTok === undefined
                ? "—"
                : `${formatTokens(inTok ?? 0)}→${formatTokens(outTok ?? 0)}`
            }
            muted={inTok === undefined && outTok === undefined}
          />
        </span>
        {providerLabel ? (
          <Badge tone="outline" mono size="sm" className="text-ink-3">
            {providerLabel}
          </Badge>
        ) : null}
        {actions ? <span className="ml-auto flex items-center gap-1">{actions}</span> : null}
      </div>
    );
  },
);
