import { memo } from "react";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import { cn } from "@/lib/cn";
import { parseHandleId } from "@/node";
import type { ContractJsonSchema } from "@/types";
import type { CanvasEdgeState, DataCanvasEdge } from "./types";
import "./canvas.css";

/** Stroke colour of a data edge per run state. */
export function dataEdgeStroke(state: CanvasEdgeState): string {
  switch (state) {
    case "active":
      return "var(--accent)";
    case "taken":
      return "var(--ink-3)";
    case "reused":
      return "var(--ok)";
    case "error":
      return "var(--danger)";
    case "not-taken":
    case "idle":
      return "var(--border-strong)";
  }
}

function typeOf(schema: ContractJsonSchema): string | undefined {
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  return schema.type;
}

/**
 * One-line summary of a JSON Schema for tooltips: `string`, `integer ≥ 0`,
 * `object {id, email}`, `array<string>`, `"a" | "b"`, `any`.
 */
export function summarizeSchema(schema: ContractJsonSchema | undefined, depth = 0): string {
  if (!schema) return "any";
  if (schema.title && depth > 0) return schema.title;
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (alternatives) return alternatives.map((s) => summarizeSchema(s, depth + 1)).join(" | ");
  const type = typeOf(schema);
  if (type === "object" || (type === undefined && schema.properties)) {
    const keys = Object.keys(schema.properties ?? {});
    if (keys.length === 0) return "object";
    const shown = keys.slice(0, 4).join(", ");
    return `object {${shown}${keys.length > 4 ? ", …" : ""}}`;
  }
  if (type === "array") {
    const items =
      typeof schema.items === "object" ? summarizeSchema(schema.items, depth + 1) : "any";
    return `array<${items}>`;
  }
  if (type === "number" || type === "integer") {
    const bounds = [
      schema.minimum !== undefined ? `≥ ${schema.minimum}` : undefined,
      schema.maximum !== undefined ? `≤ ${schema.maximum}` : undefined,
    ].filter((b): b is string => b !== undefined);
    return bounds.length ? `${type} ${bounds.join(" ")}` : type;
  }
  if (type === "string" && schema.format) return `string (${schema.format})`;
  return type ?? schema.title ?? "any";
}

/** Tooltip text of a data edge: `reply → text · string · via template · optional`. */
export function dataEdgeTooltip(
  data: DataCanvasEdge["data"],
  sourceHandle: string | null | undefined,
  targetHandle: string | null | undefined,
): string {
  const port = (h: string | null | undefined) => {
    const parsed = parseHandleId(h);
    return parsed && parsed.kind !== "ctl-in" ? parsed.port : "?";
  };
  const via = data?.via ?? "ref";
  const parts = [
    `${port(sourceHandle)}${data?.path ?? ""} → ${port(targetHandle)}`,
    summarizeSchema(data?.schema),
  ];
  if (via !== "ref") parts.push(`via ${via}`);
  if (data?.optional) parts.push("optional");
  return parts.join(" · ");
}

/**
 * Data edge (`out:<port>` → `in:<port>`), derived from a binding. A `ref`
 * binding draws a solid, selectable edge (deleting it unbinds the port); a
 * `template`, `expr` or hoisted reference draws a dotted implicit edge that
 * cannot be selected (edit the binding in the inspector instead). Hovering
 * shows the ports, the schema of the value and how it is bound.
 */
export const DataEdge = memo(function DataEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  targetHandleId,
  data,
  markerEnd,
  interactionWidth,
}: EdgeProps<DataCanvasEdge>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.3,
  });
  const state: CanvasEdgeState = data?.state ?? "idle";
  const implicit = (data?.via ?? "ref") !== "ref";
  const stroke = dataEdgeStroke(state);
  const opacity = state === "not-taken" ? 0.3 : implicit ? 0.75 : 1;
  const tooltip = dataEdgeTooltip(data, sourceHandleId, targetHandleId);
  return (
    <g
      className="fa-data-edge"
      data-edge-kind="data"
      data-implicit={implicit ? "true" : "false"}
      data-state={state}
    >
      <title>{tooltip}</title>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={implicit ? 0 : (interactionWidth ?? 12)}
        className={cn("fa-edge-path", state === "active" && !implicit && "fa-edge-active")}
        style={{
          stroke,
          strokeWidth: state === "taken" || state === "active" ? 1.75 : 1.25,
          strokeDasharray: implicit ? "0.5 4" : undefined,
          strokeLinecap: implicit ? "round" : undefined,
          opacity,
          transition:
            "stroke var(--dur-base) var(--ease-out), opacity var(--dur-base) var(--ease-out)",
        }}
      />
    </g>
  );
});
