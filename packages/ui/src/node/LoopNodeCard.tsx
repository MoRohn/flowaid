import { forwardRef } from "react";
import { formatCost, formatMs } from "@/lib/format";
import { ProgressBar } from "@/primitives";
import type { IterationProgress, NodeRunView, WorkflowNodeView } from "@/types";
import { NodeCard, type NodeCardBaseProps, type NodeMetaItem } from "./NodeCard";
import { nodeTypeLabel, numberField, runIsActive } from "./nodeUtils";

export interface LoopNodeCardProps extends NodeCardBaseProps {
  /** Current iteration (1-based); defaults to the run's folded progress, then its `iterations` output. */
  iteration?: number;
  /** Folded loop / foreach progress; defaults to `run.progress`. */
  progress?: IterationProgress;
}

/** Bounds as meta items: max iterations, timeout and budget. */
export function loopBoundsMeta(bounds: WorkflowNodeView["bounds"]): NodeMetaItem[] {
  if (!bounds) return [];
  const items: NodeMetaItem[] = [];
  if (bounds.maxIterations !== undefined) {
    items.push({
      label: "max",
      value: `${bounds.maxIterations} ${bounds.maxIterations === 1 ? "iteration" : "iterations"}`,
    });
  }
  if (bounds.timeoutMs !== undefined)
    items.push({ label: "timeout", value: formatMs(bounds.timeoutMs) });
  if (bounds.maxCostUsd !== undefined)
    items.push({ label: "budget", value: formatCost(bounds.maxCostUsd) });
  return items;
}

/** What a container's iteration badge shows: `current` of `total` (`3/10`). */
export interface IterationCount {
  /** Loop: the iteration in progress (1-based). Foreach: items finished. */
  current: number;
  /** Loop: `bounds.maxIterations`. Foreach: `itemCount`. */
  total?: number;
  /** "3/10", or "3" without a bound. */
  label: string;
  /** Spoken form for `aria-label`, e.g. "iteration 3 of 10" or "2 of 4 items done". */
  description: string;
}

/**
 * The iteration badge of a loop or foreach node (UI.md §4.3): a loop reads the iteration
 * in progress of `bounds.maxIterations`, a foreach the items finished of its `itemCount`.
 * `iteration` (1-based) overrides the folded progress; without either, a completed run's
 * `iterations` output is used. Undefined until something has started.
 */
export function iterationCount(
  node: Pick<WorkflowNodeView, "kind" | "bounds">,
  run?: Pick<NodeRunView, "progress" | "output">,
  iteration?: number,
  progress: IterationProgress | undefined = run?.progress,
): IterationCount | undefined {
  const foreach = progress ? progress.mode === "foreach" : node.kind === "foreach";
  let current: number | undefined = iteration;
  if (current === undefined && progress) current = foreach ? progress.completed : progress.started;
  if (current === undefined) current = numberField(run?.output, "iterations");
  if (current === undefined) return undefined;
  const total = foreach
    ? (progress?.total ?? node.bounds?.maxIterations)
    : node.bounds?.maxIterations;
  const label = total !== undefined ? `${current}/${total}` : `${current}`;
  const description = foreach
    ? `${current}${total !== undefined ? ` of ${total}` : ""} ${total === 1 ? "item" : "items"} done`
    : `iteration ${current}${total !== undefined ? ` of ${total}` : ""}`;
  return { current, total, label, description };
}

/** Iterative node as a collapsed card: iteration i/max with a progress bar and its bounds as meta. */
export const LoopNodeCard = forwardRef<HTMLDivElement, LoopNodeCardProps>(function LoopNodeCard(
  { node, run, iteration, progress, ...state },
  ref,
) {
  const count = iterationCount(node, run, iteration, progress ?? run?.progress);
  const meta: NodeMetaItem[] = [...(node.meta ?? []), ...loopBoundsMeta(node.bounds)];
  const active = runIsActive(run);
  const exhausted =
    count?.total !== undefined &&
    count.current >= count.total &&
    (run?.status === "failed" || run?.progress?.exitReason === "max_iterations");
  const foreach = (progress ?? run?.progress)?.mode === "foreach" || node.kind === "foreach";
  return (
    <NodeCard
      ref={ref}
      node={node}
      run={run}
      kindLabel={nodeTypeLabel(node)}
      meta={meta}
      {...state}
    >
      {count ? (
        <div className="flex flex-col gap-1.5" data-iteration={count.current}>
          <div className="flex items-baseline justify-between font-mono text-2xs tabular">
            <span className="text-ink-3">{foreach ? "items" : "iteration"}</span>
            <span className="text-ink">
              {count.current}
              {count.total !== undefined ? (
                <span className="text-ink-3"> / {count.total}</span>
              ) : null}
            </span>
          </div>
          {count.total !== undefined && count.total > 0 ? (
            <ProgressBar
              label={foreach ? "Items" : "Iterations"}
              value={Math.min(1, count.current / count.total)}
              tone={exhausted ? "danger" : active ? "accent" : "neutral"}
            />
          ) : null}
        </div>
      ) : null}
    </NodeCard>
  );
});
