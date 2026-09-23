import { forwardRef } from "react";
import {
  NodeToolbar as FlowNodeToolbar,
  Position,
  type NodeToolbarProps as FlowNodeToolbarProps,
} from "@xyflow/react";
import { NodeActionBar, type NodeActionBarProps } from "./NodeActionBar";

export interface NodeToolbarProps
  extends
    NodeActionBarProps,
    Pick<FlowNodeToolbarProps, "isVisible" | "position" | "offset" | "align"> {}

/**
 * xyflow `NodeToolbar` carrying the node action bar. Render it inside a
 * custom node; it floats above the node and shows while the node is
 * selected (or whenever `isVisible` says so).
 */
export const NodeToolbar = forwardRef<HTMLDivElement, NodeToolbarProps>(function NodeToolbar(
  { isVisible, position = Position.Top, offset = 8, align, nodeId, ...bar },
  ref,
) {
  return (
    <FlowNodeToolbar
      nodeId={nodeId}
      isVisible={isVisible}
      position={position}
      offset={offset}
      align={align}
    >
      <NodeActionBar ref={ref} nodeId={nodeId} {...bar} />
    </FlowNodeToolbar>
  );
});
