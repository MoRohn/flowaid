import { forwardRef, useMemo, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import {
  WORKFLOW_DIFF_SECTION_LABEL,
  WORKFLOW_DIFF_SECTIONS,
  workflowDiffCounts,
  workflowNodeChanges,
  type WorkflowNodeChangeKind,
} from "@/lib/workflowDiff";
import { Badge, Hint } from "@/primitives";
import type { WorkflowDiff } from "@/types";

const CHANGE_TONE: Record<WorkflowNodeChangeKind, "ok" | "danger" | "accent"> = {
  added: "ok",
  removed: "danger",
  changed: "accent",
};

export interface WorkflowDiffSummaryProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** The compiler's `diff(a, b)` (ARCHITECTURE.md §4.7), as served by `GET /v1/workflow-versions/:id/diff/:other`. */
  diff: WorkflowDiff;
  /** Display name for a node id; defaults to the id. */
  nodeName?: (nodeId: string) => string | undefined;
  /** Makes rows clickable (select the node on the canvas). */
  onSelectNode?: (nodeId: string) => void;
  /** Node ids to highlight as selected. */
  selectedNodeId?: string;
}

/**
 * Node-level view of a `WorkflowDiff`: one row per added, removed or changed
 * node with the JSON-pointer paths of its patch, then the edge and section
 * counts (inputs, outputs, variables, secrets, execution).
 */
export const WorkflowDiffSummary = forwardRef<HTMLDivElement, WorkflowDiffSummaryProps>(
  function WorkflowDiffSummary(
    { diff, nodeName, onSelectNode, selectedNodeId, className, ...rest },
    ref,
  ) {
    const changes = useMemo(() => workflowNodeChanges(diff), [diff]);
    const counts = useMemo(() => workflowDiffCounts(diff), [diff]);
    const sections = WORKFLOW_DIFF_SECTIONS.filter((s) => diff[s].length > 0);
    const edges = counts.edgesAdded + counts.edgesRemoved;
    return (
      <div
        ref={ref}
        data-layout-only={diff.layoutOnly || undefined}
        className={cn(
          "flex min-w-0 flex-col overflow-hidden rounded-sm border border-border bg-surface",
          className,
        )}
        {...rest}
      >
        <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border bg-surface px-2.5 text-xs">
          <span className="font-medium text-ink">
            {changes.length} {changes.length === 1 ? "node" : "nodes"} changed
          </span>
          <span className="flex items-center gap-2 font-mono text-2xs tabular">
            <span className="text-ok-text">+{counts.added}</span>
            <span className="text-danger-text">−{counts.removed}</span>
            <span className="text-accent-text">~{counts.changed}</span>
          </span>
          {edges > 0 ? (
            <Hint
              hint="Edges added / removed"
              className="ml-auto font-mono text-2xs text-ink-3 tabular"
            >
              edges +{counts.edgesAdded} −{counts.edgesRemoved}
            </Hint>
          ) : null}
        </div>
        {changes.length === 0 && sections.length === 0 && edges === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-ink-3">
            {diff.layoutOnly
              ? "Only the layout differs between these versions."
              : "No changes between these versions."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {changes.map((c) => {
              const interactive = onSelectNode !== undefined;
              const name = nodeName?.(c.nodeId) ?? c.nodeId;
              const content = (
                <>
                  <Badge tone={CHANGE_TONE[c.kind]} size="sm" className="w-[58px] justify-center">
                    {c.kind}
                  </Badge>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-xs font-medium text-ink">{name}</span>
                      {name !== c.nodeId ? (
                        <span className="truncate font-mono text-2xs text-ink-3">{c.nodeId}</span>
                      ) : null}
                    </span>
                    {c.paths.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {c.paths.map((p) => (
                          <span
                            key={p}
                            className="rounded-xs bg-surface-3 px-1 font-mono text-2xs leading-4 text-ink-2"
                          >
                            {p}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </span>
                </>
              );
              const rowClass = cn(
                "flex w-full items-start gap-2.5 px-2.5 py-1.5 text-left",
                interactive && "cursor-pointer hover:bg-surface-3/70",
                selectedNodeId === c.nodeId && "bg-accent-soft/60",
              );
              return (
                <li key={`${c.kind}-${c.nodeId}`} data-change={c.kind}>
                  {interactive ? (
                    <button
                      type="button"
                      onClick={() => onSelectNode(c.nodeId)}
                      className={rowClass}
                    >
                      {content}
                    </button>
                  ) : (
                    <div className={rowClass}>{content}</div>
                  )}
                </li>
              );
            })}
            {sections.map((s) => (
              <li
                key={s}
                data-section={s}
                className="flex items-center gap-2.5 px-2.5 py-1.5 text-xs"
              >
                <Badge tone="neutral" size="sm" className="w-[58px] justify-center">
                  {WORKFLOW_DIFF_SECTION_LABEL[s].toLowerCase()}
                </Badge>
                <span className="font-mono text-2xs text-ink-3 tabular">
                  {diff[s].length} {diff[s].length === 1 ? "op" : "ops"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
);
