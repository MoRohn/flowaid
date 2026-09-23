import { memo } from "react";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import { cn } from "@/lib/cn";
import { EdgeArrow, EdgeLabelChip } from "./edgeParts";
import type { CanvasEdgeState, ControlCanvasEdge } from "./types";
import { WeightedEdge } from "./WeightedEdge";
import "./canvas.css";

/** Stroke colour of a control edge: fired edges tint `--ok` (UI.md §4.3), pruned ones stay neutral and fade. */
export function controlEdgeStroke(state: CanvasEdgeState): string {
  switch (state) {
    case "active":
      return "var(--accent)";
    case "taken":
    case "reused":
      return "var(--ok)";
    case "error":
      return "var(--danger)";
    case "not-taken":
    case "idle":
      return "var(--border-strong)";
  }
}

/** Opacity of a control edge: pruned edges fade to 30 %. */
export function controlEdgeOpacity(state: CanvasEdgeState): number {
  return state === "not-taken" ? 0.3 : 1;
}

/** The label a control edge shows: its explicit label, else the port it leaves unless that is the implicit `done`. */
export function controlEdgeLabel(data: ControlCanvasEdge["data"]): string | undefined {
  if (data?.label) return data.label;
  return data?.route && data.route !== "done" ? data.route : undefined;
}

/**
 * Control edge (`ctl:<port>` → `ctl-in`): activation, not data. Dashed with
 * an arrowhead into the target's control-in notch and a mono label naming the
 * port (branch case, gate outcome, human outcome; `done` stays unlabelled).
 * During a run a fired edge tints `--ok` and a pruned edge fades to 30 %; the
 * edge into the running node flows. Router exits that carry a `probability`
 * render as `WeightedEdge`.
 */
export const ControlEdge = memo(function ControlEdge(props: EdgeProps<ControlCanvasEdge>) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    selected,
    markerEnd,
    interactionWidth,
  } = props;
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.3,
  });
  if (data?.probability !== undefined) return <WeightedEdge {...props} />;
  const state: CanvasEdgeState = data?.state ?? "idle";
  const stroke = controlEdgeStroke(state);
  const opacity = controlEdgeOpacity(state);
  const label = controlEdgeLabel(data);
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth ?? 16}
        className={cn("fa-edge-path fa-control-edge", state === "active" && "fa-edge-active")}
        data-edge-kind="control"
        data-state={state}
        style={{
          stroke,
          strokeWidth: state === "taken" || state === "active" ? 2 : 1.5,
          opacity,
          strokeDasharray: "5 4",
          transition:
            "stroke var(--dur-base) var(--ease-out), opacity var(--dur-base) var(--ease-out)",
        }}
      />
      <EdgeArrow
        x={targetX}
        y={targetY}
        position={targetPosition}
        color={stroke}
        opacity={opacity}
      />
      {label ? (
        <EdgeLabelChip x={labelX} y={labelY} state={state} selected={selected} label={label} />
      ) : null}
    </>
  );
});
