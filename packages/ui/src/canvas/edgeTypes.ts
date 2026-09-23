import type { EdgeTypes } from "@xyflow/react";
import { CONTROL_IN, handleId, parseHandleId } from "@/node";
import type { WorkflowEdgeView } from "@/types";
import { ControlEdge } from "./ControlEdge";
import { DataEdge } from "./DataEdge";
import type { CanvasEdge, CanvasEdgeType } from "./types";

/** Ready-made `edgeTypes` for `<ReactFlow edgeTypes={edgeTypes}>` (UI.md §3): control and data edges. */
export const edgeTypes: EdgeTypes = { control: ControlEdge, data: DataEdge };

/**
 * The edge type of a `WorkflowEdgeView` or xyflow edge: its explicit `kind`/`type`, else what the
 * handle ids say (`ctl:*` / `ctl-in` → control, anything else → data).
 */
export function edgeTypeFor(edge: {
  kind?: WorkflowEdgeView["kind"];
  type?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}): CanvasEdgeType {
  const explicit = edge.kind ?? edge.type;
  if (explicit === "control" || explicit === "data") return explicit;
  const source = parseHandleId(edge.sourceHandle);
  const target = parseHandleId(edge.targetHandle);
  return source?.kind === "ctl" || target?.kind === "ctl-in" ? "control" : "data";
}

/**
 * Maps a projected `WorkflowEdgeView` to the xyflow edge `FlowCanvas` renders: control edges get
 * `type: "control"` (target handle `ctl-in`, route from the source port), data edges `type: "data"`
 * with their `via`; implicit data edges (`via !== "ref"`) are neither selectable, focusable nor
 * deletable (UI.md §4.2).
 */
export function toCanvasEdge(edge: WorkflowEdgeView): CanvasEdge {
  const base = { id: edge.id, source: edge.source, target: edge.target };
  if (edgeTypeFor(edge) === "control") {
    const source = parseHandleId(edge.sourceHandle);
    const route = edge.route ?? (source?.kind === "ctl" ? source.port : undefined);
    return {
      ...base,
      type: "control",
      sourceHandle: edge.sourceHandle ?? (route ? handleId("ctl", route) : handleId("ctl", "done")),
      targetHandle: edge.targetHandle ?? CONTROL_IN,
      data: {
        ...(route !== undefined ? { route } : null),
        ...(edge.label !== undefined ? { label: edge.label } : null),
        ...(edge.probability !== undefined ? { probability: edge.probability } : null),
      },
    };
  }
  const via = edge.via ?? "ref";
  const implicit = via !== "ref";
  return {
    ...base,
    type: "data",
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    ...(implicit ? { selectable: false, focusable: false, deletable: false } : null),
    data: {
      via,
      ...(edge.optional !== undefined ? { optional: edge.optional } : null),
      ...(edge.path !== undefined ? { path: edge.path } : null),
      ...(edge.schema !== undefined ? { schema: edge.schema } : null),
      ...(edge.label !== undefined ? { label: edge.label } : null),
    },
  };
}
