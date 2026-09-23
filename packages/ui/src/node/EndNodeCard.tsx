import { forwardRef } from "react";
import { NodeTerminalPill, type NodeTerminalPillProps } from "./NodeTerminalPill";

export type EndNodeCardProps = Omit<NodeTerminalPillProps, "kind">;

/** Workflow exit: a pill with a single target handle. */
export const EndNodeCard = forwardRef<HTMLDivElement, EndNodeCardProps>(
  function EndNodeCard(props, ref) {
    return <NodeTerminalPill ref={ref} kind="end" {...props} />;
  },
);
