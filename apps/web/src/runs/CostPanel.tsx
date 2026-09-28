"use client";
/** Cost tab: usage by provider (`UsageSummary`) and the cost of every node run, most expensive first. */
import type { NodeRunView, RunView } from "@flowaid/ui";
import { formatCost, formatMs, formatTokens } from "@flowaid/ui/lib";
import { CategoryDot, EmptyState } from "@flowaid/ui/primitives";
import { UsageSummary, summarizeUsage } from "@flowaid/ui/trace";
import { CircleDollarSign } from "lucide-react";

export function nodeCostRows(nodeRuns: readonly NodeRunView[]) {
  return [...nodeRuns]
    .filter((n) => (n.costUsd ?? 0) > 0 || n.usage)
    .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0));
}

export function CostPanel({
  run,
  onSelect,
}: {
  run: RunView;
  onSelect?: (nodeRun: NodeRunView) => void;
}) {
  // providers that metered nothing (flow and data nodes) are noise in a cost breakdown
  const usage = summarizeUsage(run.nodeRuns).filter(
    (u) =>
      u.costUsd > 0 ||
      u.inputTokens + u.outputTokens > 0 ||
      u.decisionCalls + u.modelCalls + u.toolCalls > 0,
  );
  const rows = nodeCostRows(run.nodeRuns);
  if (rows.length === 0 && !run.costUsd)
    return (
      <EmptyState
        size="sm"
        icon={<CircleDollarSign strokeWidth={1.5} />}
        title="No metered usage"
        description="None of this run's nodes called a model or a paid tool."
      />
    );
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline gap-3">
        <span className="text-2xs uppercase tracking-wide text-ink-3">Run total</span>
        <span className="font-mono text-lg tabular text-ink">{formatCost(run.costUsd ?? 0)}</span>
      </div>
      {usage.length ? <UsageSummary rows={usage} /> : null}
      <table className="w-full text-sm">
        <caption className="sr-only">Cost per node run</caption>
        <thead>
          <tr className="border-b border-border text-left text-2xs uppercase tracking-wide text-ink-3">
            <th className="py-2 font-medium">Node</th>
            <th className="py-2 text-right font-medium">Tokens</th>
            <th className="py-2 text-right font-medium">Latency</th>
            <th className="py-2 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((n) => (
            <tr key={n.id} className="border-b border-border last:border-0">
              <td className="py-2">
                <button
                  type="button"
                  className="flex items-center gap-2 text-left text-ink hover:text-accent-text"
                  onClick={() => onSelect?.(n)}
                >
                  <CategoryDot category={n.category} />
                  {n.nodeName}
                  {n.attempt > 1 ? (
                    <span className="font-mono text-2xs text-ink-3">#{n.attempt}</span>
                  ) : null}
                </button>
              </td>
              <td className="py-2 text-right font-mono tabular text-ink-2">
                {n.usage ? formatTokens(n.usage.inputTokens + n.usage.outputTokens) : "—"}
              </td>
              <td className="py-2 text-right font-mono tabular text-ink-2">
                {n.durationMs !== undefined ? formatMs(n.durationMs) : "—"}
              </td>
              <td className="py-2 text-right font-mono tabular text-ink">
                {formatCost(n.costUsd ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
