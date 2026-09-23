import { memo } from "react";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import { cn } from "@/lib/cn";
import { categoryVar, type NodeCategory } from "@/lib/categories";
import { EdgeArrow, EdgeLabelChip } from "./edgeParts";
import { probabilityToStroke } from "./geometry";
import type { CanvasEdgeState, ControlCanvasEdge } from "./types";
import "./canvas.css";

/** Stroke colour per edge state for weighted router exits; `taken` uses the edge's category hue. */
export function edgeStroke(state: CanvasEdgeState, category?: NodeCategory): string {
  switch (state) {
    case "active":
      return "var(--accent)";
    case "taken":
      return category ? categoryVar(category) : "var(--accent)";
    case "error":
      return "var(--danger)";
    case "reused":
      return "var(--ok)";
    case "not-taken":
      return "var(--border-strong)";
    case "idle":
      return "var(--border-strong)";
  }
}

/**
 * The router styling of `ControlEdge`: a smooth bezier control edge whose
 * weight is its probability. Opacity and width map to the value like the
 * mark's branches (1.0 / 0.42 / 0.18) and the label is a mono chip on the
 * surface. States: idle, active (flowing dash, still under reduced motion),
 * taken (solid, category hue), not-taken (dashed, faint), reused (dashed,
 * ok: a cached result) and error (danger). `ControlEdge` renders it whenever
 * the edge carries a `probability`.
 */
export const WeightedEdge = memo(function WeightedEdge({
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
}: EdgeProps<ControlCanvasEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.3,
  });
  const state: CanvasEdgeState = data?.state ?? "idle";
  const { opacity, width } = probabilityToStroke(data?.probability);
  const stroke = edgeStroke(state, data?.category);
  const strokeWidth =
    state === "taken" || state === "active" || state === "reused" ? Math.max(width, 2) : width;
  const strokeOpacity = state === "not-taken" ? 0.3 : state === "idle" ? opacity : 1;
  const dashed = state === "not-taken" || state === "reused";

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth ?? 16}
        className={cn("fa-edge-path", state === "active" && "fa-edge-active")}
        data-edge-kind="control"
        data-weighted="true"
        style={{
          stroke,
          strokeWidth,
          opacity: strokeOpacity,
          strokeDasharray: dashed ? "4 4" : undefined,
          transition:
            "stroke var(--dur-base) var(--ease-out), opacity var(--dur-base) var(--ease-out)",
        }}
      />
      <EdgeArrow
        x={targetX}
        y={targetY}
        position={targetPosition}
        color={stroke}
        opacity={strokeOpacity}
      />
      {data?.label ? (
        <EdgeLabelChip
          x={labelX}
          y={labelY}
          state={state}
          selected={selected}
          style={
            state === "taken" && data.category ? { color: categoryVar(data.category) } : undefined
          }
          label={data.label}
        />
      ) : null}
    </>
  );
});
