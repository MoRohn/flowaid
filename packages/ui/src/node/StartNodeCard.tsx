import { forwardRef } from "react";
import { NodeTerminalPill, type NodeTerminalPillProps } from "./NodeTerminalPill";

export type StartNodeCardProps = Omit<NodeTerminalPillProps, "kind">;

/** Workflow entry: a pill with a single source handle. */
export const StartNodeCard = forwardRef<HTMLDivElement, StartNodeCardProps>(
  function StartNodeCard(props, ref) {
    return <NodeTerminalPill ref={ref} kind="start" {...props} />;
  },
);
