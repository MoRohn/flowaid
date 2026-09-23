import { forwardRef } from "react";
import { NodeCard, type NodeCardBaseProps } from "./NodeCard";
import { NodeRouteList } from "./NodeRouteList";

export type RouterNodeCardProps = NodeCardBaseProps;

/**
 * N-way router. Lists every route as a row with its own source handle and
 * marks the route the last run took.
 */
export const RouterNodeCard = forwardRef<HTMLDivElement, RouterNodeCardProps>(
  function RouterNodeCard({ node, run, compatibleHandles, handleReasons, ...state }, ref) {
    const routes = node.routes ?? [];
    return (
      <NodeCard
        ref={ref}
        node={node}
        run={run}
        kindLabel="router"
        handles="inputs"
        compatibleHandles={compatibleHandles}
        handleReasons={handleReasons}
        bodyClassName="pl-0 pr-0 pt-1.5"
        meta={routes.length ? null : undefined}
        {...state}
      >
        {routes.length ? (
          <NodeRouteList
            routes={routes}
            taken={run?.routeTaken}
            resolved={run !== undefined && run.status !== "pending" && run.status !== "running"}
            category={node.category}
            compatibleHandles={compatibleHandles}
            handleReasons={handleReasons}
            outputs={node.outputs}
          />
        ) : (
          <p className="px-2.5 pl-[26px] text-2xs text-ink-3">No routes configured</p>
        )}
      </NodeCard>
    );
  },
);
