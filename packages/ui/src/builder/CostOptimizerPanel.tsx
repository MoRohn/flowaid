import { forwardRef, useMemo, type HTMLAttributes } from "react";
import { Coins } from "lucide-react";
import { cn } from "@/lib/cn";
import type { NodeCategory } from "@/lib/categories";
import { formatCost, formatMs } from "@/lib/format";
import { Badge, Button, CategoryDot, Checkbox, Panel, useControllableState } from "@/primitives";

export type CostOptimizationKind = "rule" | "model" | "cache" | "batch" | "prompt";

export interface CostOptimizationView {
  id: string;
  /** What changes, e.g. "Replace LLM classification with a TypeSafe choice". */
  title: string;
  /** One line on why it is safe; deterministic-logic-first. */
  rationale?: string;
  kind: CostOptimizationKind;
  nodeId: string;
  nodeName: string;
  nodeCategory: NodeCategory;
  /** Cost per 1k runs, USD. */
  beforeCostPer1k: number;
  afterCostPer1k: number;
  /** Median latency change per run in ms (negative is faster). */
  latencyDeltaMs: number;
  /** How confidence/accuracy is affected, e.g. "No change: rule covers 100% of cases". */
  confidenceImpact: string;
}

export interface CostOptimizerPanelProps extends HTMLAttributes<HTMLDivElement> {
  items: CostOptimizationView[];
  selectedIds?: string[];
  defaultSelectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  onApply?: (ids: string[]) => void;
  /** Current monthly run volume; adds a monthly estimate to the footer. */
  runsPerMonth?: number;
  applying?: boolean;
  flush?: boolean;
}

const KIND_LABEL: Record<CostOptimizationKind, string> = {
  rule: "rule",
  model: "model",
  cache: "cache",
  batch: "batch",
  prompt: "prompt",
};

/** Sum of per-1k savings for the given ids. */
export function totalSavingsPer1k(
  items: readonly CostOptimizationView[],
  ids: readonly string[],
): number {
  const set = new Set(ids);
  return items
    .filter((i) => set.has(i.id))
    .reduce((acc, i) => acc + (i.beforeCostPer1k - i.afterCostPer1k), 0);
}

/**
 * Proposed cost optimisations as a table with before/after cost per 1k runs,
 * latency delta and the effect on confidence. Rows are checkable; the footer
 * totals the selected savings and applies them through a callback.
 */
export const CostOptimizerPanel = forwardRef<HTMLDivElement, CostOptimizerPanelProps>(
  function CostOptimizerPanel(
    {
      items,
      selectedIds,
      defaultSelectedIds,
      onSelectionChange,
      onApply,
      runsPerMonth,
      applying = false,
      flush = false,
      className,
      ...rest
    },
    ref,
  ) {
    const [selected, setSelected] = useControllableState<string[]>(
      selectedIds,
      defaultSelectedIds ?? items.map((i) => i.id),
      onSelectionChange,
    );
    const set = useMemo(() => new Set(selected), [selected]);
    const allSelected = items.length > 0 && items.every((i) => set.has(i.id));
    const someSelected = items.some((i) => set.has(i.id));
    const savings = totalSavingsPer1k(items, selected);
    const before = items.filter((i) => set.has(i.id)).reduce((a, i) => a + i.beforeCostPer1k, 0);
    const latency = items.filter((i) => set.has(i.id)).reduce((a, i) => a + i.latencyDeltaMs, 0);

    const toggle = (id: string, on: boolean) => {
      setSelected(on ? Array.from(new Set([...selected, id])) : selected.filter((s) => s !== id));
    };

    return (
      <Panel
        ref={ref}
        title="Cost optimizer"
        icon={<Coins strokeWidth={1.75} aria-hidden="true" />}
        meta={`${items.length} proposals`}
        padded={false}
        flush={flush}
        className={cn("[&>footer]:flex-wrap", className)}
        bodyClassName="contain-inline-size"
        footer={
          <>
            <span className="whitespace-nowrap text-2xs text-ink-3">
              {selected.length} of {items.length} selected
            </span>
            <span className="ml-auto flex flex-wrap items-baseline justify-end gap-x-2 gap-y-0.5 font-mono text-2xs tabular">
              <span className="whitespace-nowrap text-ink-3">
                {formatCost(before)} → {formatCost(before - savings)}/1k
              </span>
              <span className="whitespace-nowrap text-sm font-medium text-ok-text">
                −{formatCost(savings)}
                <span className="text-2xs font-normal text-ink-3">/1k runs</span>
              </span>
              {runsPerMonth !== undefined ? (
                <span className="whitespace-nowrap text-ink-3">
                  ≈ −{formatCost((savings * runsPerMonth) / 1000)}/mo
                </span>
              ) : null}
              {latency !== 0 ? (
                <span
                  className={cn(
                    "whitespace-nowrap",
                    latency < 0 ? "text-ok-text" : "text-warn-text",
                  )}
                >
                  {latency < 0 ? "−" : "+"}
                  {formatMs(Math.abs(latency))} latency
                </span>
              ) : null}
            </span>
            <Button
              variant="primary"
              size="sm"
              disabled={!someSelected}
              loading={applying}
              onClick={() => onApply?.(selected)}
            >
              Apply selected
            </Button>
          </>
        }
        {...rest}
      >
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="h-8 border-b border-border bg-surface-2 text-left text-2xs font-medium text-ink-3">
              <th scope="col" className="w-8 pl-3">
                <Checkbox
                  size="sm"
                  aria-label="Select all"
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={(v) => setSelected(v === true ? items.map((i) => i.id) : [])}
                />
              </th>
              <th scope="col" className="pr-3 font-medium">
                Optimisation
              </th>
              <th scope="col" className="hidden pr-3 font-medium md:table-cell">
                Node
              </th>
              <th scope="col" className="pr-3 text-right font-medium">
                Before
              </th>
              <th scope="col" className="pr-3 text-right font-medium">
                After
              </th>
              <th scope="col" className="hidden pr-3 text-right font-medium sm:table-cell">
                Latency
              </th>
              <th scope="col" className="hidden pr-3 font-medium lg:table-cell">
                Confidence impact
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((it) => {
              const on = set.has(it.id);
              const saving = it.beforeCostPer1k - it.afterCostPer1k;
              return (
                <tr
                  key={it.id}
                  data-selected={on || undefined}
                  className={cn(
                    "align-top transition-colors duration-(--dur-fast)",
                    !on && "text-ink-3",
                  )}
                >
                  <td className="pl-3 pt-2.5">
                    <Checkbox
                      size="sm"
                      aria-label={`Include ${it.title}`}
                      checked={on}
                      onCheckedChange={(v) => toggle(it.id, v === true)}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={cn("font-medium", on ? "text-ink" : "text-ink-2")}>
                          {it.title}
                        </span>
                        <Badge size="sm" tone={it.kind === "rule" ? "accent" : "outline"} mono>
                          {KIND_LABEL[it.kind]}
                        </Badge>
                      </div>
                      {it.rationale ? (
                        <p className="text-2xs leading-normal text-ink-3">{it.rationale}</p>
                      ) : null}
                      <span className="inline-flex items-center gap-1.5 text-2xs text-ink-3 md:hidden">
                        <CategoryDot category={it.nodeCategory} size={6} />
                        {it.nodeName}
                      </span>
                    </div>
                  </td>
                  <td className="hidden py-2 pr-3 md:table-cell">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2">
                      <CategoryDot category={it.nodeCategory} size={6} />
                      {it.nodeName}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right font-mono tabular text-ink-2">
                    {formatCost(it.beforeCostPer1k)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right font-mono tabular">
                    <span className={on ? "text-ink" : "text-ink-2"}>
                      {formatCost(it.afterCostPer1k)}
                    </span>
                    <span className="ml-1.5 text-2xs text-ok-text">−{formatCost(saving)}</span>
                  </td>
                  <td
                    className={cn(
                      "hidden whitespace-nowrap py-2 pr-3 text-right font-mono tabular sm:table-cell",
                      it.latencyDeltaMs < 0
                        ? "text-ok-text"
                        : it.latencyDeltaMs > 0
                          ? "text-warn-text"
                          : "text-ink-3",
                    )}
                  >
                    {it.latencyDeltaMs === 0
                      ? "—"
                      : `${it.latencyDeltaMs < 0 ? "−" : "+"}${formatMs(Math.abs(it.latencyDeltaMs))}`}
                  </td>
                  <td className="hidden max-w-64 py-2 pr-3 text-2xs leading-normal text-ink-2 lg:table-cell">
                    {it.confidenceImpact}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    );
  },
);
