import { forwardRef } from "react";
import { NodeCard, type NodeCardBaseProps } from "./NodeCard";
import { NodeRouteList, type NodeRouteItem } from "./NodeRouteList";

export type BranchNodeCardProps = NodeCardBaseProps;

const DEFAULT_ROUTES: NodeRouteItem[] = [
  { id: "true", label: "true" },
  { id: "false", label: "false" },
];

/**
 * Two-way branch on a condition. Each exit is a row with its own source
 * handle; after a run the taken exit is highlighted.
 */
export const BranchNodeCard = forwardRef<HTMLDivElement, BranchNodeCardProps>(
  function BranchNodeCard({ node, run, compatibleHandles, handleReasons, ...state }, ref) {
    const routes = node.routes?.length ? node.routes : DEFAULT_ROUTES;
    return (
      <NodeCard
        ref={ref}
        node={node}
        run={run}
        kindLabel="branch"
        handles="inputs"
        compatibleHandles={compatibleHandles}
        handleReasons={handleReasons}
        bodyClassName="pl-0 pr-0 pt-1.5"
        {...state}
      >
        <NodeRouteList
          routes={routes}
          taken={run?.routeTaken}
          resolved={run !== undefined && run.status !== "pending" && run.status !== "running"}
          category={node.category}
          compatibleHandles={compatibleHandles}
          handleReasons={handleReasons}
          outputs={node.outputs}
        />
      </NodeCard>
    );
  },
);
