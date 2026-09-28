/**
 * The builder's pure model (UI.md §4): definition + plan + catalog → the canvas projection, and the
 * small structural helpers the store's actions use. The definition is the only truth; nothing here
 * mutates it.
 */
import type {
  Binding,
  ControlEdge,
  DataDependency,
  Diagnostic,
  ExecutionPlan,
  JsonObject,
  JsonSchema,
  NodeCategory,
  NodeManifest,
  WorkflowDefinition,
  WorkflowNode,
} from "@flowaid/workflow-core";
import type { ControlPortView, PortView, WorkflowEdgeView, WorkflowNodeView } from "@flowaid/ui";

export type NodeKind = WorkflowNode["kind"];

/** Latest manifest per type id, plus exact `id@version` keys. */
export class Catalog {
  private readonly byId = new Map<string, NodeManifest>();
  private readonly exact = new Map<string, NodeManifest>();
  constructor(readonly manifests: readonly NodeManifest[]) {
    for (const m of manifests) {
      this.exact.set(`${m.id}@${m.version}`, m);
      const cur = this.byId.get(m.id);
      if (!cur || compareSemver(m.version, cur.version) > 0) this.byId.set(m.id, m);
    }
  }
  get(id: string, version?: string): NodeManifest | undefined {
    return (version ? this.exact.get(`${id}@${version}`) : undefined) ?? this.byId.get(id);
  }
  latest(): NodeManifest[] {
    return [...this.byId.values()];
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

export function manifestOf(node: WorkflowNode, catalog: Catalog): NodeManifest | undefined {
  return node.kind === "task" ? catalog.get(node.type, node.typeVersion) : undefined;
}

export function categoryOf(node: WorkflowNode, catalog: Catalog): NodeCategory {
  if (node.kind === "task") return manifestOf(node, catalog)?.metadata.category ?? "flow";
  return node.kind === "human" ? "human" : "flow";
}

/** Short type label of a schema for a handle ("string", "object", "decision", "any"). */
export function typeLabel(schema: JsonSchema | undefined): string {
  if (!schema || typeof schema !== "object") return "any";
  const s = schema as Record<string, unknown>;
  const t = s.type;
  if (typeof t === "string") return t;
  if (Array.isArray(t)) return (t.find((x) => x !== "null") as string | undefined) ?? "any";
  if (s.enum) return "enum";
  if (s.anyOf || s.oneOf) return "union";
  if (s.properties) return "object";
  return "any";
}

function humanize(id: string): string {
  const s = id.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function port(id: string, schema?: JsonSchema, required?: boolean, description?: string): PortView {
  return {
    id,
    label: humanize(id),
    type: typeLabel(schema),
    ...(schema ? { schema: schema } : {}),
    ...(required !== undefined ? { required } : {}),
    ...(description ? { description } : {}),
  };
}

/** Object-schema properties as ports (the input node's outputs, a subflow's inputs). */
export function propertyPorts(schema: JsonSchema | undefined): PortView[] {
  const s = (schema ?? {}) as { properties?: Record<string, JsonSchema>; required?: string[] };
  const req = new Set(s.required ?? []);
  return Object.entries(s.properties ?? {}).map(([k, v]) => port(k, v, req.has(k)));
}

/** The data ports a node binds (its inputs), keyed by port name, with the binding. */
export function nodeBindings(node: WorkflowNode): Record<string, Binding | undefined> {
  switch (node.kind) {
    case "task":
    case "join":
    case "subflow":
      return { ...node.inputs };
    case "output":
      return { value: node.value };
    case "foreach":
      return { items: node.items };
    case "input":
    case "human":
    case "branch":
    case "loop":
    case "wait":
    case "note":
      return {};
  }
}

/** Refs to other nodes' ports anywhere inside a binding. */
export function bindingRefs(
  b: Binding | undefined,
): { node: string; port: string; path?: string }[] {
  if (!b) return [];
  switch (b.kind) {
    case "ref":
      return b.ref.kind === "port"
        ? [{ node: b.ref.node, port: b.ref.port, ...(b.ref.path ? { path: b.ref.path } : {}) }]
        : [];
    case "object":
      return Object.values(b.fields).flatMap(bindingRefs);
    case "array":
      return b.items.flatMap(bindingRefs);
    case "template":
    case "expr":
    case "literal":
      return [];
  }
}

/** Data edges straight from the bindings (`ref` only): the canvas's fallback while the plan is stale. */
export function bindingDataEdges(def: WorkflowDefinition): DataDependency[] {
  const out: DataDependency[] = [];
  for (const n of def.nodes)
    for (const [p, b] of Object.entries(nodeBindings(n)))
      for (const r of bindingRefs(b))
        out.push({
          from: { node: r.node, port: r.port },
          to: { node: n.id, port: p },
          ...(r.path ? { path: r.path } : {}),
          optional: b?.kind === "ref" && b.default !== undefined,
          via: "ref",
        });
  return out;
}

/** Control-outs a node offers before (or without) a plan. */
export function defaultControlOuts(node: WorkflowNode, catalog: Catalog): string[] {
  switch (node.kind) {
    case "note":
      return [];
    case "output":
      return [];
    case "branch":
      return [...node.cases.map((c) => c.port), node.defaultPort];
    case "human":
      return node.mode.type === "choice"
        ? node.mode.options.map((o) => o.id)
        : node.mode.type === "approval"
          ? ["approved", "rejected"]
          : ["done"];
    case "task": {
      const m = manifestOf(node, catalog);
      const named = m?.controlPorts.map((c) => c.name) ?? [];
      return named.length > 0 ? named : ["done"];
    }
    case "join":
    case "input":
    case "loop":
    case "foreach":
    case "subflow":
    case "wait":
      return ["done"];
  }
}

function inputPorts(node: WorkflowNode, catalog: Catalog, def: WorkflowDefinition): PortView[] {
  switch (node.kind) {
    case "task": {
      const m = manifestOf(node, catalog);
      const ports = (m?.inputs ?? []).map((p) => port(p.name, p.schema, p.required, p.description));
      const known = new Set(ports.map((p) => p.id));
      for (const k of Object.keys(node.inputs))
        if (!known.has(k)) ports.push(port(k, m?.dynamicInputs?.schema));
      return ports;
    }
    case "output":
      return [port("value", def.outputs, true)];
    case "foreach":
      return [port("items", { type: "array" }, true)];
    case "join":
    case "subflow":
      return Object.keys(node.inputs).map((k) => port(k));
    case "input":
    case "human":
    case "branch":
    case "loop":
    case "wait":
    case "note":
      return [];
  }
}

function outputPorts(node: WorkflowNode, catalog: Catalog, def: WorkflowDefinition): PortView[] {
  switch (node.kind) {
    case "input":
      return propertyPorts(def.inputs);
    case "task":
      return (manifestOf(node, catalog)?.outputs ?? []).map((p) =>
        port(p.name, p.schema, p.required, p.description),
      );
    case "join":
    case "output":
    case "human":
    case "branch":
    case "loop":
    case "foreach":
    case "subflow":
    case "wait":
    case "note":
      return [];
  }
}

function mergePorts(
  base: PortView[],
  extra: Iterable<[string, JsonSchema | undefined]>,
): PortView[] {
  const byId = new Map(base.map((p) => [p.id, p]));
  for (const [id, schema] of extra) {
    const cur = byId.get(id);
    if (!cur) byId.set(id, port(id, schema));
    else if (schema && !cur.schema)
      byId.set(id, { ...cur, schema: schema, type: typeLabel(schema) });
  }
  return [...byId.values()];
}

export interface Projection {
  nodes: WorkflowNodeView[];
  edges: WorkflowEdgeView[];
}

/**
 * The canvas projection (UI.md §4.2): control edges from `definition.edges`, data edges from the
 * plan (or the bindings while there is none); ports from the plan's resolved schemas when present,
 * widened with every port an edge touches so no handle is ever missing.
 */
export function project(
  def: WorkflowDefinition,
  plan: ExecutionPlan | null,
  diagnostics: readonly Diagnostic[],
  catalog: Catalog,
): Projection {
  // one drawn edge per port pair (a template may reference several paths of the same port); a
  // selectable `ref` edge wins over implicit ones so it can be deleted from the canvas
  const byPair = new Map<string, DataDependency>();
  for (const e of plan ? plan.dataEdges : bindingDataEdges(def)) {
    const k = dataEdgeId(e);
    const cur = byPair.get(k);
    if (!cur || (cur.via !== "ref" && e.via === "ref")) byPair.set(k, e);
  }
  const dataEdges = [...byPair.values()];
  const ids = new Set(def.nodes.map((n) => n.id));
  const extraIn = new Map<string, Map<string, JsonSchema | undefined>>();
  const extraOut = new Map<string, Map<string, JsonSchema | undefined>>();
  const extraCtl = new Map<string, Set<string>>();
  const add = <V>(m: Map<string, Map<string, V>>, node: string, key: string, v: V) => {
    const inner = m.get(node) ?? new Map<string, V>();
    if (!inner.has(key) || v !== undefined) inner.set(key, v);
    m.set(node, inner);
  };
  for (const e of dataEdges) {
    add(extraIn, e.to.node, e.to.port, undefined);
    add(extraOut, e.from.node, e.from.port, plan?.nodes[e.from.node]?.outputs[e.from.port]);
  }
  for (const e of def.edges) {
    const s = extraCtl.get(e.from.node) ?? new Set<string>();
    s.add(e.from.port);
    extraCtl.set(e.from.node, s);
  }
  const diagsBy = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    const id = d.location.nodeId;
    if (id) diagsBy.set(id, [...(diagsBy.get(id) ?? []), d]);
  }

  const nodes = def.nodes.map((n): WorkflowNodeView => {
    const pn = plan?.nodes[n.id];
    const planOuts = pn ? Object.entries(pn.outputs) : [];
    const outs = mergePorts(outputPorts(n, catalog, def), [
      ...planOuts,
      ...(extraOut.get(n.id) ?? new Map()),
    ]);
    const ins = mergePorts(inputPorts(n, catalog, def), extraIn.get(n.id) ?? new Map());
    const ctl = new Set(pn ? pn.controlOut : defaultControlOuts(n, catalog));
    for (const p of extraCtl.get(n.id) ?? []) ctl.add(p);
    const routes: ControlPortView[] = [...ctl].map((id) => ({
      id,
      label:
        n.kind === "branch"
          ? (n.cases.find((c) => c.port === id)?.label ?? humanize(id))
          : humanize(id),
      ...(n.kind === "branch" && n.cases.find((c) => c.port === id)
        ? { condition: n.cases.find((c) => c.port === id)?.when }
        : {}),
    }));
    const m = manifestOf(n, catalog);
    const view: WorkflowNodeView = {
      id: n.id,
      kind: n.kind,
      category: categoryOf(n, catalog),
      name: n.name,
      inputs: n.kind === "note" ? [] : ins,
      outputs: n.kind === "note" ? [] : outs,
      ...(n.kind === "note" ? {} : { routes }),
      ...(n.kind === "task" ? { nodeType: n.type } : {}),
      ...(n.kind === "note"
        ? { description: n.text }
        : n.description
          ? { description: n.description }
          : m
            ? { description: m.metadata.description }
            : {}),
      ...(n.parent ? { parent: n.parent } : {}),
      ...(n.disabled ? { disabled: true } : {}),
      ...(n.kind === "loop" || n.kind === "foreach" ? { bounds: n.bounds } : {}),
      ...(diagsBy.get(n.id) ? { diagnostics: diagsBy.get(n.id) } : {}),
      ...(n.kind === "task" ? { meta: taskMeta(n.config) } : {}),
    };
    return view;
  });

  const edges: WorkflowEdgeView[] = [
    ...def.edges
      .filter((e) => ids.has(e.from.node) && ids.has(e.to.node))
      .map((e) => controlEdgeView(e)),
    ...dataEdges
      .filter((e) => ids.has(e.from.node) && ids.has(e.to.node))
      .map((e): WorkflowEdgeView => ({
        id: dataEdgeId(e),
        kind: "data",
        source: e.from.node,
        sourceHandle: `out:${e.from.port}`,
        target: e.to.node,
        targetHandle: `in:${e.to.port}`,
        via: e.via,
        optional: e.optional,
        ...(e.path ? { path: e.path } : {}),
        ...(plan?.nodes[e.from.node]?.outputs[e.from.port]
          ? { schema: plan.nodes[e.from.node]?.outputs[e.from.port] }
          : {}),
      })),
  ];
  return { nodes, edges };
}

function taskMeta(config: Record<string, unknown>): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const model = config.model as
    | { provider?: string; model?: string; candidates?: { model?: string }[]; strategy?: string }
    | string
    | undefined;
  if (typeof model === "string") out.push({ label: "model", value: model });
  else if (model?.model) out.push({ label: "model", value: model.model });
  else if (Array.isArray(model?.candidates) && model.candidates[0]?.model) {
    // a generation policy (RFC-0005): the first candidate, how many fall back, and the routing
    const extra = model.candidates.length - 1;
    out.push({
      label: model.strategy && model.strategy !== "ordered" ? model.strategy : "model",
      value: `${model.candidates[0].model}${extra > 0 ? ` +${extra}` : ""}`,
    });
  }
  if (typeof config.method === "string" && typeof config.url === "string")
    out.push({ label: String(config.method), value: String(config.url).slice(0, 48) });
  return out.slice(0, 2);
}

export function controlEdgeView(e: ControlEdge): WorkflowEdgeView {
  return {
    id: e.id,
    kind: "control",
    source: e.from.node,
    sourceHandle: `ctl:${e.from.port}`,
    target: e.to.node,
    targetHandle: "ctl-in",
    route: e.from.port,
  };
}

export function dataEdgeId(e: Pick<DataDependency, "from" | "to">): string {
  return `d:${e.from.node}.${e.from.port}→${e.to.node}.${e.to.port}`;
}

/** Parses `d:<node>.<port>→<node>.<port>` back into its target (for edge deletes). */
export function parseDataEdgeId(id: string): { node: string; port: string } | null {
  const m = /^d:[^→]+→([^.]+)\.(.+)$/.exec(id);
  return m?.[1] && m[2] ? { node: m[1], port: m[2] } : null;
}

/** A fresh node id `<base>_<n>` unused in the definition. */
export function uniqueNodeId(def: WorkflowDefinition, base: string): string {
  const stem =
    base
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^[^a-z]+/, "")
      .replace(/_+$/, "")
      .slice(0, 40) || "node";
  const taken = new Set(def.nodes.map((n) => n.id));
  for (let i = 1; ; i++) if (!taken.has(`${stem}_${i}`)) return `${stem}_${i}`;
}

export function uniqueEdgeId(
  def: WorkflowDefinition,
  from: string,
  port: string,
  to: string,
): string {
  const base = `e_${from}_${port}_${to}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100);
  const taken = new Set(def.edges.map((e) => e.id));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

/** A blank, compilable definition: an input and an output wired together. */
export function blankDefinition(id: string, name: string): WorkflowDefinition {
  return {
    $schema: "https://flowaid.dev/schemas/workflow/v1",
    id,
    name,
    description: "",
    inputs: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
    outputs: { type: "object", properties: { message: { type: "string" } } },
    nodes: [
      { id: "start", kind: "input", name: "Start", disabled: false },
      {
        id: "end",
        kind: "output",
        name: "End",
        disabled: false,
        earlyExit: false,
        value: {
          kind: "object",
          fields: {
            message: { kind: "ref", ref: { kind: "port", node: "start", port: "message" } },
          },
        },
      },
    ],
    edges: [{ id: "e_start_end", from: { node: "start", port: "done" }, to: { node: "end" } }],
    variables: [],
    secrets: [],
    triggers: [],
    execution: {} as WorkflowDefinition["execution"],
    layout: { nodes: { start: { x: 0, y: 0 }, end: { x: 0, y: 220 } } },
    metadata: {},
  };
}

/** Structural kinds offered by the palette (the input node is unique and never added). */
export const STRUCTURAL_KINDS: {
  kind: Exclude<NodeKind, "task" | "input" | "subflow">;
  name: string;
  description: string;
  category: NodeCategory;
}[] = [
  {
    kind: "branch",
    name: "Branch",
    description: "Deterministic cases over expressions",
    category: "flow",
  },
  {
    kind: "join",
    name: "Join",
    description: "Wait for all, any, n or the first arrival",
    category: "flow",
  },
  {
    kind: "loop",
    name: "Loop",
    description: "Repeat a body with carried state until a condition",
    category: "flow",
  },
  {
    kind: "foreach",
    name: "For each",
    description: "Run a body for every item, with bounded concurrency",
    category: "flow",
  },
  {
    kind: "wait",
    name: "Wait",
    description: "Pause for a delay, a timestamp or an event",
    category: "flow",
  },
  {
    kind: "human",
    name: "Human review",
    description: "Approval, review, form or choice by a person",
    category: "human",
  },
  {
    kind: "output",
    name: "Output",
    description: "Return a value (optionally ending the run early)",
    category: "flow",
  },
  { kind: "note", name: "Note", description: "A sticky note on the canvas", category: "flow" },
];

/**
 * A new node of `kind` (a structural kind or a manifest id) with a unique id and valid defaults:
 * task config from the manifest's config schema via `defaults`, structural nodes minimal but
 * compilable.
 */
export function newNode(
  def: WorkflowDefinition,
  kind: string,
  catalog: Catalog,
  defaults: (schema: JsonSchema) => Record<string, unknown>,
  parent?: string,
): WorkflowNode | null {
  const common = { disabled: false, ...(parent ? { parent } : {}) };
  const m = catalog.get(kind);
  if (m) {
    const tail = m.id.split(".").at(-1) ?? "node";
    return {
      ...common,
      id: uniqueNodeId(def, tail),
      kind: "task",
      name: m.metadata.name,
      type: m.id,
      typeVersion: m.version,
      config: defaults(m.configSchema) as JsonObject,
      inputs: {},
      credentials: {},
    };
  }
  const s = STRUCTURAL_KINDS.find((k) => k.kind === kind);
  if (!s) return null;
  const id = uniqueNodeId(def, s.kind === "foreach" ? "each" : s.kind);
  const name = s.name;
  switch (s.kind) {
    case "branch":
      return {
        ...common,
        id,
        name,
        kind: "branch",
        mode: "first",
        cases: [{ port: "yes", when: "true" }],
        defaultPort: "no",
      };
    case "join":
      return { ...common, id, name, kind: "join", mode: { type: "all" }, inputs: {} };
    case "loop":
      return {
        ...common,
        id,
        name,
        kind: "loop",
        carrySchema: { type: "object", properties: {} },
        carry: { initial: {}, next: {} },
        result: {},
        bounds: { maxIterations: 10 },
        onExhausted: "route",
      };
    case "foreach":
      return {
        ...common,
        id,
        name,
        kind: "foreach",
        items: { kind: "literal", value: [] },
        concurrency: 4,
        failurePolicy: "fail_fast",
        bounds: { maxIterations: 100 },
      };
    case "wait":
      return { ...common, id, name, kind: "wait", until: { type: "delay", ms: 1000 } };
    case "human":
      return {
        ...common,
        id,
        name,
        kind: "human",
        mode: { type: "approval" },
        title: { kind: "literal", value: "Please review" },
        context: {},
        assignees: [],
        onExpire: "fail",
        externalReview: false,
      };
    case "output":
      return {
        ...common,
        id,
        name,
        kind: "output",
        value: { kind: "literal", value: null },
        earlyExit: false,
      };
    case "note":
      return { ...common, id, name: "Note", kind: "note", text: "" };
  }
}

/**
 * Whether the canvas should lay the graph out on open: a node has no position, or a larger graph
 * sits on a single row or column (layouts written by hand or by tools that ignore the canvas).
 */
export function needsLayout(def: WorkflowDefinition): boolean {
  const top = def.nodes.filter((n) => !n.parent);
  const pos = top.map((n) => def.layout?.nodes[n.id]);
  if (def.nodes.some((n) => !def.layout?.nodes[n.id])) return true;
  // Children sit relative to their container: a container without a size, or a child outside
  // its frame, is a layout written with absolute positions (by hand or by a tool).
  for (const n of def.nodes) {
    if (!n.parent) continue;
    const frame = def.layout?.nodes[n.parent];
    const at = def.layout?.nodes[n.id];
    if (!frame || !at) return true;
    if (frame.w === undefined || frame.h === undefined) return true;
    if (at.x < 0 || at.y < 0 || at.x > frame.w || at.y > frame.h) return true;
  }
  if (top.length <= 4) return false;
  const xs = new Set(pos.map((p) => p?.x));
  const ys = new Set(pos.map((p) => p?.y));
  return xs.size === 1 || ys.size === 1;
}
