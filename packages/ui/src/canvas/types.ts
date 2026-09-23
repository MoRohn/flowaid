/**
 * Canvas-specific view models (UI.md §4.2). Nodes are the node group's
 * `FlowNode` (`data.node` is the shared `WorkflowNodeView`, `data.run` its
 * latest `NodeRunView`), so the app keeps a plain workflow graph as the
 * source of truth and maps it with `toFlowNode`. Edges are either control
 * edges (`ctl:<port>` → `ctl-in`, drawn by `ControlEdge`, or `WeightedEdge`
 * for probability-weighted router exits) or data edges (`out:<port>` →
 * `in:<port>`, drawn by `DataEdge`); `toCanvasEdge` maps a
 * `WorkflowEdgeView` to the right one.
 */
import type { Edge } from "@xyflow/react";
import type { NodeCategory } from "@/lib/categories";
import type { FlowNode, FlowNodeData } from "@/node";
import type { Layout } from "@flowaid/workflow-core";
import type { ContractJsonSchema, DataEdgeVia, NodeRunView } from "@/types";

export type CanvasNode = FlowNode;
export type CanvasNodeData = FlowNodeData;

/**
 * Visual state of an edge. `taken` = fired control port (or delivered data), `not-taken` = pruned,
 * `reused` = the target reused a cached result (green dashed, UI.md §4.3).
 */
export type CanvasEdgeState = "idle" | "active" | "taken" | "not-taken" | "reused" | "error";

/** Data carried by a control edge. */
export interface ControlEdgeData extends Record<string, unknown> {
  /** Route name or condition, e.g. "security 0.81" or "confidence >= 0.90". */
  label?: string;
  state?: CanvasEdgeState;
  /** Category hue of the source node (weighted router exits use it for the taken state). */
  category?: NodeCategory;
  /** Control port the edge leaves (`ctl:<route>`). */
  route?: string;
  /**
   * Probability in [0, 1] of a router exit. When set the edge is drawn weighted
   * (`WeightedEdge`: opacity and width follow the value).
   */
  probability?: number;
}

/** Data carried by a data edge (`plan.dataEdges`). */
export interface DataEdgeData extends Record<string, unknown> {
  /** How the binding reaches the port; everything but `ref` is an implicit edge (dotted, not selectable). */
  via: DataEdgeVia;
  /** The producer may be pruned; the binding carries a default. */
  optional?: boolean;
  /** JSON Pointer into the source port's value. */
  path?: string;
  /** Schema of the value that flows; summarised in the edge tooltip. */
  schema?: ContractJsonSchema;
  label?: string;
  state?: CanvasEdgeState;
  category?: NodeCategory;
}

export type ControlCanvasEdge = Edge<ControlEdgeData, "control">;
export type DataCanvasEdge = Edge<DataEdgeData, "data">;
export type CanvasEdge = ControlCanvasEdge | DataCanvasEdge;
export type CanvasEdgeType = CanvasEdge["type"];

/** Per-node and per-edge execution state for a whole graph. */
export interface CanvasRunState {
  /** Latest node run per node id. */
  nodes: Record<string, NodeRunView>;
  edges: Record<string, CanvasEdgeState>;
}

/** A node definition as listed in the palette. */
export interface NodeDefinitionView {
  /** Definition id: a manifest id such as "flowaid.decision.choice", or a structural kind such as "branch". */
  kind: string;
  name: string;
  category: NodeCategory;
  description: string;
  provider?: string;
}

/** Position in canvas (flow) coordinates. */
export interface CanvasPoint {
  x: number;
  y: number;
}

/**
 * `WorkflowDefinition.layout`: per-node `x`/`y` (relative to the container for nodes with a
 * `parent`), `w`/`h` for resized frames, `collapsed`, and the viewport.
 */
export type CanvasLayout = Layout;

/**
 * Nodes dropped into (or out of) a container frame: the new `parent` (undefined = top level)
 * and each node's position relative to it, so it stays where it was dropped (UI.md §4.1
 * `setParent`).
 */
export interface ParentDrop {
  parent: string | undefined;
  ids: string[];
  positions: Record<string, CanvasPoint>;
}
