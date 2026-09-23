import { forwardRef, useMemo, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { formatCost, formatTokens } from "@/lib/format";
import type { NodeRunView } from "@/types";

export interface UsageByProviderView {
  provider: string;
  modelCalls: number;
  decisionCalls: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface UsageSummaryProps extends HTMLAttributes<HTMLTableElement> {
  rows: UsageByProviderView[];
  /** Hide the totals row. */
  noTotals?: boolean;
}

export interface SummarizeUsageOptions {
  /** Provider label for a node run; defaults to the decision provider, "tools" for tool calls, else "other". */
  providerFor?: (nodeRun: NodeRunView) => string;
}

/** Aggregate node runs into per-provider usage rows (sorted by cost, descending). */
export function summarizeUsage(
  nodeRuns: readonly NodeRunView[],
  options: SummarizeUsageOptions = {},
): UsageByProviderView[] {
  const providerFor =
    options.providerFor ??
    ((n: NodeRunView) =>
      n.decision?.provider ??
      (n.toolCall ? "tools" : n.category === "generation" ? "generation" : "other"));
  const map = new Map<string, UsageByProviderView>();
  for (const n of nodeRuns) {
    const isDecision = n.decision !== undefined;
    const isTool = n.toolCall !== undefined;
    const isModel = isDecision || n.category === "generation" || n.category === "agent";
    const usage = n.usage ?? n.decision?.usage;
    const cost = n.costUsd ?? n.decision?.costUsd;
    if (!isDecision && !isTool && !isModel && !usage && cost === undefined) continue;
    const key = providerFor(n);
    const row = map.get(key) ?? {
      provider: key,
      modelCalls: 0,
      decisionCalls: 0,
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
    if (isDecision) row.decisionCalls += 1;
    else if (isModel) row.modelCalls += 1;
    if (isTool) row.toolCalls += 1;
    row.inputTokens += usage?.inputTokens ?? 0;
    row.outputTokens += usage?.outputTokens ?? 0;
    row.costUsd += cost ?? 0;
    map.set(key, row);
  }
  return [...map.values()].sort(
    (a, b) => b.costUsd - a.costUsd || a.provider.localeCompare(b.provider),
  );
}

/** Column totals for a set of usage rows. */
export function totalUsage(rows: readonly UsageByProviderView[]): UsageByProviderView {
  return rows.reduce<UsageByProviderView>(
    (acc, r) => ({
      provider: "Total",
      modelCalls: acc.modelCalls + r.modelCalls,
      decisionCalls: acc.decisionCalls + r.decisionCalls,
      toolCalls: acc.toolCalls + r.toolCalls,
      inputTokens: acc.inputTokens + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      costUsd: acc.costUsd + r.costUsd,
    }),
    {
      provider: "Total",
      modelCalls: 0,
      decisionCalls: 0,
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    },
  );
}

const NUM = "px-2 py-1.5 text-right font-mono text-xs tabular";

/**
 * Compact per-provider table: decision, model and tool calls, tokens in/out
 * and cost, with a totals row. Numbers are mono and right-aligned so the
 * columns line up.
 */
export const UsageSummary = forwardRef<HTMLTableElement, UsageSummaryProps>(function UsageSummary(
  { rows, noTotals = false, className, ...rest },
  ref,
) {
  const total = useMemo(() => totalUsage(rows), [rows]);
  return (
    <table
      ref={ref}
      className={cn(
        "w-full min-w-0 border-collapse overflow-hidden rounded-md border border-border bg-surface text-xs shadow-1",
        className,
      )}
      {...rest}
    >
      <thead>
        <tr className="border-b border-border bg-surface-2 text-eyebrow">
          <th scope="col" className="px-3 py-1.5 text-left font-normal">
            Provider
          </th>
          <th scope="col" className="px-2 py-1.5 text-right font-normal">
            Decisions
          </th>
          <th scope="col" className="px-2 py-1.5 text-right font-normal">
            Model
          </th>
          <th scope="col" className="px-2 py-1.5 text-right font-normal">
            Tools
          </th>
          <th scope="col" className="hidden px-2 py-1.5 text-right font-normal sm:table-cell">
            In
          </th>
          <th scope="col" className="hidden px-2 py-1.5 text-right font-normal sm:table-cell">
            Out
          </th>
          <th scope="col" className="px-3 py-1.5 text-right font-normal">
            Cost
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.provider} className="border-b border-border last:border-b-0">
            <th
              scope="row"
              className="px-3 py-1.5 text-left font-mono text-xs font-medium text-ink"
            >
              {r.provider}
            </th>
            <td className={cn(NUM, r.decisionCalls === 0 && "text-ink-3")}>{r.decisionCalls}</td>
            <td className={cn(NUM, r.modelCalls === 0 && "text-ink-3")}>{r.modelCalls}</td>
            <td className={cn(NUM, r.toolCalls === 0 && "text-ink-3")}>{r.toolCalls}</td>
            <td className={cn(NUM, "hidden sm:table-cell", r.inputTokens === 0 && "text-ink-3")}>
              {formatTokens(r.inputTokens)}
            </td>
            <td className={cn(NUM, "hidden sm:table-cell", r.outputTokens === 0 && "text-ink-3")}>
              {formatTokens(r.outputTokens)}
            </td>
            <td className={cn(NUM, "px-3", r.costUsd === 0 && "text-ink-3")}>
              {formatCost(r.costUsd)}
            </td>
          </tr>
        ))}
        {rows.length === 0 ? (
          <tr>
            <td colSpan={7} className="px-3 py-4 text-center text-ink-3">
              No usage recorded.
            </td>
          </tr>
        ) : null}
      </tbody>
      {!noTotals && rows.length > 0 ? (
        <tfoot>
          <tr className="border-t border-border bg-surface-2 font-medium">
            <th scope="row" className="px-3 py-1.5 text-left text-xs text-ink">
              Total
            </th>
            <td className={NUM}>{total.decisionCalls}</td>
            <td className={NUM}>{total.modelCalls}</td>
            <td className={NUM}>{total.toolCalls}</td>
            <td className={cn(NUM, "hidden sm:table-cell")}>{formatTokens(total.inputTokens)}</td>
            <td className={cn(NUM, "hidden sm:table-cell")}>{formatTokens(total.outputTokens)}</td>
            <td className={cn(NUM, "px-3")}>{formatCost(total.costUsd)}</td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
});
