import { forwardRef } from "react";
import { formatCost } from "@/lib/format";
import { ProgressBar } from "@/primitives";
import { NodeCard, type NodeCardBaseProps, type NodeMetaItem } from "./NodeCard";
import { metaValue, metaWithout, numberField, runIsActive } from "./nodeUtils";

export interface AgentNodeCardProps extends NodeCardBaseProps {
  /** Steps taken so far and the cap; defaults to the run output and `bounds.maxIterations`. */
  steps?: { used: number; max?: number };
  /** Number of tools available to the agent; defaults to the "tools" meta entry. */
  toolsCount?: number;
}

/** Autonomous agent loop: steps used / max, tool count and budget spent / cap. */
export const AgentNodeCard = forwardRef<HTMLDivElement, AgentNodeCardProps>(function AgentNodeCard(
  { node, run, steps, toolsCount, ...state },
  ref,
) {
  const max = steps?.max ?? node.bounds?.maxIterations;
  const used = steps?.used ?? numberField(run?.output, "steps");
  const toolsRaw = toolsCount ?? Number(metaValue(node, "tools"));
  const tools = Number.isFinite(toolsRaw) ? toolsRaw : undefined;
  const budget = node.bounds?.maxCostUsd;
  const spent = run?.costUsd;
  const meta: NodeMetaItem[] = [...metaWithout(node, "tools")];
  if (tools !== undefined) meta.push({ label: "tools", value: String(tools) });
  if (budget !== undefined || spent !== undefined) {
    meta.push({
      label: "budget",
      value:
        spent !== undefined
          ? `${formatCost(spent)}${budget !== undefined ? ` / ${formatCost(budget)}` : ""}`
          : formatCost(budget ?? 0),
      tone: budget !== undefined && spent !== undefined && spent > budget ? "danger" : "default",
    });
  }
  const active = runIsActive(run);
  return (
    <NodeCard ref={ref} node={node} run={run} kindLabel="agent" meta={meta} {...state}>
      {used !== undefined || max !== undefined ? (
        <div className="flex flex-col gap-1.5" data-steps={used}>
          <div className="flex items-baseline justify-between font-mono text-2xs tabular">
            <span className="text-ink-3">steps</span>
            <span className="text-ink">
              {used ?? 0}
              {max !== undefined ? <span className="text-ink-3"> / {max}</span> : null}
            </span>
          </div>
          {max !== undefined ? (
            <ProgressBar
              label="Steps"
              value={(used ?? 0) / max}
              tone={active ? "accent" : "neutral"}
            />
          ) : null}
        </div>
      ) : null}
    </NodeCard>
  );
});
