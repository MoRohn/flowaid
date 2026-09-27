/**
 * Read-only projection of a version's definition + plan onto the canvas (UI.md §4.2): nodes with
 * their ports and control-outs, control edges from `definition.edges`, data edges from
 * `plan.dataEdges`, positions from `definition.layout` (auto-laid out where missing).
 */
import type {
  ExecutionPlan,
  JsonSchema,
  NodeCategory,
  NodeManifest,
  WorkflowDefinition,
  WorkflowNode,
} from "@flowaid/workflow-core";
import type { PortView, WorkflowEdgeView, WorkflowNodeView } from "@flowaid/ui";
import { autoLayout, toCanvasEdge, type CanvasEdge } from "@flowaid/ui/canvas";
import {
  CONTROL_IN,
  handleId,
  orderParentsFirst,
  toFlowNode,
  type FlowNode,
} from "@flowaid/ui/node";

type Catalog = ReadonlyMap<string, NodeManifest>;

const KIND_CATEGORY: Record<Exclude<WorkflowNode["kind"], "task">, NodeCategory> = {
  input: "flow",
  output: "flow",
  branch: "flow",
  join: "flow",
  loop: "flow",
  foreach: "flow",
  subflow: "flow",
  wait: "flow",
  human: "human",
  note: "flow",
};

export function nodeCategory(node: WorkflowNode | undefined, catalog: Catalog): NodeCategory {
  if (!node) return "flow";
  if (node.kind === "task") return catalog.get(node.type)?.metadata.category ?? "tool";
  return KIND_CATEGORY[node.kind];
}

function typeLabel(schema: JsonSchema | undefined): string {
  if (!schema || typeof schema !== "object") return "any";
  const s = schema as { type?: unknown; title?: unknown };
  if (typeof s.title === "string" && s.title.length <= 16) return s.title.toLowerCase();
  if (typeof s.type === "string") return s.type;
  if (Array.isArray(s.type)) return s.type.filter((t) => t !== "null").join("|") || "any";
  return "any";
}

const port = (id: string, schema?: JsonSchema, required?: boolean): PortView => ({
  id,
  label: id.replace(/_/g, " "),
  type: typeLabel(schema),
  ...(schema ? { schema } : {}),
  ...(required !== undefined ? { required } : {}),
});

/** One canvas node view per definition node. */
export function toNodeViews(
  definition: WorkflowDefinition,
  plan: ExecutionPlan | undefined,
  catalog: Catalog,
): WorkflowNodeView[] {
  return definition.nodes.map((n) => {
    const planNode = plan?.nodes[n.id];
    const manifest = n.kind === "task" ? catalog.get(n.type) : undefined;
    const inputNames = new Set<string>();
    const inputs: PortView[] = [];
    const addIn = (p: PortView) => {
      if (inputNames.has(p.id)) return;
      inputNames.add(p.id);
      inputs.push(p);
    };
    for (const p of manifest?.inputs ?? []) addIn(port(p.name, p.schema, p.required));
    if (n.kind === "task") for (const name of Object.keys(n.inputs)) addIn(port(name));
    if (n.kind === "output") addIn(port("value", definition.outputs, true));
    for (const d of planNode?.dataIn ?? []) addIn(port(d.to.port));

    let outputs: PortView[];
    if (planNode)
      outputs = Object.entries(planNode.outputs).map(([name, schema]) => port(name, schema));
    else if (n.kind === "input") {
      const props =
        (definition.inputs as { properties?: Record<string, JsonSchema> }).properties ?? {};
      outputs = Object.entries(props).map(([name, schema]) => port(name, schema));
    } else outputs = (manifest?.outputs ?? []).map((p) => port(p.name, p.schema));

    const view: WorkflowNodeView = {
      id: n.id,
      kind: n.kind,
      category: nodeCategory(n, catalog),
      name: n.name,
      inputs: n.kind === "input" || n.kind === "note" ? [] : inputs,
      outputs: n.kind === "note" ? [] : outputs,
    };
    if (n.kind === "task") view.nodeType = n.type;
    if (n.kind === "note") view.description = n.text;
    else if (n.description) view.description = n.description;
    if (n.parent) view.parent = n.parent;
    if (n.disabled) view.disabled = true;
    if (planNode && planNode.controlOut.length > 0)
      view.routes = planNode.controlOut.map((p) => ({ id: p, label: p.replace(/_/g, " ") }));
    return view;
  });
}

/** Control edges (definition) + data edges (plan), as canvas edge views. */
export function toEdgeViews(
  definition: WorkflowDefinition,
  plan: ExecutionPlan | undefined,
): WorkflowEdgeView[] {
  const control: WorkflowEdgeView[] = definition.edges.map((e) => ({
    id: e.id,
    kind: "control",
    source: e.from.node,
    sourceHandle: handleId("ctl", e.from.port),
    target: e.to.node,
    targetHandle: CONTROL_IN,
    route: e.from.port,
  }));
  const data: WorkflowEdgeView[] = (plan?.dataEdges ?? []).map((d) => ({
    id: `d:${d.from.node}.${d.from.port}→${d.to.node}.${d.to.port}`,
    kind: "data",
    source: d.from.node,
    sourceHandle: handleId("out", d.from.port),
    target: d.to.node,
    targetHandle: handleId("in", d.to.port),
    via: d.via,
    optional: d.optional,
    ...(d.path ? { path: d.path } : {}),
  }));
  return [...control, ...data];
}

export interface ReadOnlyGraph {
  nodes: FlowNode[];
  edges: CanvasEdge[];
}

/** Everything the read-only canvas needs, laid out. */
export function toReadOnlyGraph(
  definition: WorkflowDefinition,
  plan: ExecutionPlan | undefined,
  catalog: Catalog,
): ReadOnlyGraph {
  const views = toNodeViews(definition, plan, catalog);
  const edgeViews = toEdgeViews(definition, plan);
  const saved = definition.layout?.nodes ?? {};
  const missing = views.some((v) => !saved[v.id]);
  const auto = missing
    ? autoLayout(
        views.map((v) => ({ id: v.id, ...(v.parent ? { parent: v.parent } : {}) })),
        edgeViews.filter((e) => e.kind === "control" || e.kind === undefined),
      )
    : null;
  const nodes = views.map((v) => {
    const s = saved[v.id];
    const p = s ?? auto?.positions.get(v.id) ?? { x: 0, y: 0 };
    const size = auto?.sizes.get(v.id);
    const manifest = v.nodeType ? catalog.get(v.nodeType) : undefined;
    return toFlowNode(
      v,
      {
        x: p.x,
        y: p.y,
        ...(s?.w !== undefined ? { w: s.w } : size ? { w: size.width } : {}),
        ...(s?.h !== undefined ? { h: s.h } : size ? { h: size.height } : {}),
      },
      undefined,
      undefined,
      manifest
        ? { metadata: { category: manifest.metadata.category }, decision: manifest.decision }
        : undefined,
    );
  });
  return { nodes: orderParentsFirst(nodes), edges: edgeViews.map(toCanvasEdge) };
}
