import { forwardRef } from "react";
import { Layers } from "lucide-react";
import { Badge } from "@/primitives";
import { NodeCard, type NodeCardBaseProps } from "./NodeCard";
import { metaValue, metaWithout } from "./nodeUtils";

export interface SubflowNodeCardProps extends NodeCardBaseProps {
  /** Name of the workflow this node runs; defaults to the "workflow" meta entry. */
  workflowName?: string;
  /** Pinned version; defaults to the "version" meta entry. */
  version?: string | number;
}

/** Runs another workflow. Shows the workflow name with a version chip. */
export const SubflowNodeCard = forwardRef<HTMLDivElement, SubflowNodeCardProps>(
  function SubflowNodeCard({ node, run, workflowName, version, ...state }, ref) {
    const name = workflowName ?? metaValue(node, "workflow") ?? node.description;
    const v = version ?? metaValue(node, "version");
    return (
      <NodeCard
        ref={ref}
        node={node}
        run={run}
        kindLabel="subflow"
        description={name === node.description ? null : node.description}
        meta={metaWithout(node, "workflow", "version")}
        {...state}
      >
        {name ? (
          <div className="flex items-center gap-1.5">
            <Layers
              className="size-3.5 shrink-0 text-ink-3"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-xs text-ink">{name}</span>
            {v !== undefined ? (
              <Badge tone="outline" size="sm" mono>
                {typeof v === "number" || /^\d/.test(String(v)) ? `v${v}` : String(v)}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </NodeCard>
    );
  },
);
