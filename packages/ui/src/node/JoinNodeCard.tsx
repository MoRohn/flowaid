import { forwardRef } from "react";
import { GitMerge } from "lucide-react";
import { formatMs } from "@/lib/format";
import { Badge } from "@/primitives";
import type { ControlPortView, WorkflowNode, WorkflowNodeView } from "@/types";
import { NodeCard, type NodeCardBaseProps } from "./NodeCard";
import { isRecord, metaValue, metaWithout } from "./nodeUtils";

/** The join mode from the contract (`JoinNodeSchema.mode`). */
export type JoinMode = Extract<WorkflowNode, { kind: "join" }>["mode"];

export interface JoinNodeCardProps extends NodeCardBaseProps {
  /** Join mode; defaults to the "mode" meta entry ("all", "any", "race", "count 2"), else `all`. */
  mode?: JoinMode;
  /** Join timeout; adds the `timeout` control-out. Defaults to the "timeout" meta entry. */
  timeoutMs?: number;
}

/** Parses the "mode" meta entry: `all`, `any`, `race`, `count 2` or a bare number. */
export function joinModeFor(node: Pick<WorkflowNodeView, "meta">): JoinMode {
  const raw = metaValue(node, "mode")?.trim().toLowerCase();
  if (raw === "any" || raw === "race" || raw === "all") return { type: raw };
  const n = raw ? Number.parseInt(raw.replace(/^count\s*/, ""), 10) : Number.NaN;
  return Number.isInteger(n) && n >= 1 ? { type: "count", n } : { type: "all" };
}

/** "all 3", "any", "2 of 3", "race". */
export function joinModeLabel(mode: JoinMode, inputs: number): string {
  switch (mode.type) {
    case "all":
      return inputs > 0 ? `all ${inputs}` : "all";
    case "any":
      return "any";
    case "count":
      return inputs > 0 ? `${mode.n} of ${inputs}` : `${mode.n}`;
    case "race":
      return "race";
  }
}

function parseDuration(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/.exec(value.trim());
  if (!m?.[1]) return undefined;
  const n = Number(m[1]);
  const unit = m[2] ?? "ms";
  const factor = unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : unit === "s" ? 1000 : 1;
  return n * factor;
}

/** Control-outs of a join: `node.routes`, else `done` plus `timeout` when the join has a timeout. */
export function joinControlOuts(
  node: Pick<WorkflowNodeView, "routes" | "meta">,
  timeoutMs?: number,
): ControlPortView[] {
  if (node.routes?.length) return node.routes;
  const timeout = timeoutMs ?? parseDuration(metaValue(node, "timeout"));
  return [
    { id: "done", label: "done" },
    ...(timeout !== undefined ? [{ id: "timeout", label: "timeout" }] : []),
  ];
}

/**
 * Explicit multi-input join (`kind: "join"`). Arrivals are its incoming
 * control edges; the card names the mode (all / any / n of m / race), counts
 * arrivals once a run has reported them and exposes `done` (plus `timeout`
 * when the join has one) as control-outs.
 */
export const JoinNodeCard = forwardRef<HTMLDivElement, JoinNodeCardProps>(function JoinNodeCard(
  { node, run, mode: modeProp, timeoutMs: timeoutProp, ...state },
  ref,
) {
  const mode = modeProp ?? joinModeFor(node);
  const timeoutMs = timeoutProp ?? parseDuration(metaValue(node, "timeout"));
  const controls = joinControlOuts(node, timeoutMs);
  const values =
    isRecord(run?.output) && isRecord(run.output.values) ? run.output.values : undefined;
  const arrived = values ? Object.values(values).filter((v) => v !== null).length : undefined;
  const expected = node.inputs.length;
  return (
    <NodeCard
      ref={ref}
      node={node}
      run={run}
      kindLabel="join"
      controls={controls}
      meta={[
        ...metaWithout(node, "mode", "timeout"),
        ...(timeoutMs !== undefined ? [{ label: "timeout", value: formatMs(timeoutMs) }] : []),
      ]}
      {...state}
    >
      <div className="flex items-center gap-1.5" data-join-mode={mode.type}>
        <GitMerge className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden="true" />
        <span className="text-xs text-ink-2">waits for</span>
        <Badge tone="outline" size="sm" mono>
          {joinModeLabel(mode, expected)}
        </Badge>
        {arrived !== undefined ? (
          <span className="ml-auto font-mono text-2xs text-ink-3 tabular" data-arrived={arrived}>
            {arrived}
            {expected > 0 ? <span className="text-ink-3"> / {expected}</span> : null} arrived
          </span>
        ) : null}
      </div>
    </NodeCard>
  );
});
