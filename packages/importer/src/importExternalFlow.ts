/**
 * `importExternalFlow(flowData)` → `{ definition, report }` (ARCHITECTURE.md §10.9).
 *
 * Pipeline: parse and sanitise the export → graphs → plan every node (ids and ports) → map each
 * node → containers (iterations become `foreach`, back-edge loops become `loop` around their
 * body) → control edges → output nodes for terminal nodes → the definition, validated against
 * `WorkflowDefinitionSchema`. Nodes without an equivalent become `flowaid.dev.todo`
 * placeholders that fail compilation with `E_IMPORT_UNSUPPORTED`, so nothing degrades silently.
 */
import { uuidv7 } from "@flowaid/shared";
import {
  WORKFLOW_SCHEMA_URI,
  WorkflowDefinitionSchema,
  type Binding,
  type JsonObject,
  type JsonSchema,
  type WorkflowNode,
} from "@flowaid/workflow-core";
import { Builder, portRef, type Mapped } from "./builder.js";
import { constructGraphs, handleOutput, reachable, reaching } from "./graph.js";
import { importChatFlow } from "./langchain-map.js";
import { build, CONTAINERS, plan } from "./map.js";
import { textBinding } from "./templates.js";
import {
  ExternalFlowError,
  type ExternalFlowFormat,
  type ImportOptions,
  type ImportReport,
  type ImportResult,
  type SourceFlow,
  type SourceNode,
} from "./types.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The export's graph, from the file's JSON (a flow, or a record holding `flowData`). */
export function parseExternalFlow(data: unknown): SourceFlow {
  let value = typeof data === "string" ? (JSON.parse(data) as unknown) : data;
  let name: string | undefined;
  if (isRecord(value) && typeof value.flowData === "string") {
    name = typeof value.name === "string" ? value.name : undefined;
    value = JSON.parse(value.flowData) as unknown;
  }
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges))
    throw new ExternalFlowError("not a flow export: expected { nodes: [...], edges: [...] }");
  const nodes: SourceNode[] = [];
  for (const raw of value.nodes) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !isRecord(raw.data)) continue;
    const d = raw.data;
    if (typeof d.name !== "string") continue;
    nodes.push({
      id: raw.id,
      ...(typeof raw.type === "string" ? { type: raw.type } : {}),
      ...(isRecord(raw.position) ? { position: raw.position } : {}),
      ...(typeof raw.parentNode === "string" ? { parentNode: raw.parentNode } : {}),
      data: {
        name: d.name,
        ...(typeof d.label === "string" ? { label: d.label } : {}),
        ...(typeof d.category === "string" ? { category: d.category } : {}),
        ...(isRecord(d.inputs) ? { inputs: d.inputs } : {}),
      },
    });
  }
  if (nodes.length === 0) throw new ExternalFlowError("the flow export has no nodes");
  const edges = value.edges
    .filter(isRecord)
    .filter((e) => typeof e.source === "string" && typeof e.target === "string")
    .map((e) => ({
      source: e.source as string,
      target: e.target as string,
      ...(typeof e.sourceHandle === "string" ? { sourceHandle: e.sourceHandle } : {}),
      ...(typeof e.targetHandle === "string" ? { targetHandle: e.targetHandle } : {}),
    }));
  return {
    ...((name ?? (typeof value.name === "string" ? value.name : undefined))
      ? { name: name ?? (value.name as string) }
      : {}),
    nodes,
    edges,
  };
}

/** Whether a parsed JSON document looks like an external flow export (and not a FlowAId definition). */
export function isExternalFlowExport(data: unknown): boolean {
  if (!isRecord(data) || "$schema" in data) return false;
  try {
    parseExternalFlow(data);
    return true;
  } catch {
    return false;
  }
}

export function detectFormat(flow: SourceFlow): ExternalFlowFormat {
  return flow.nodes.some((n) => n.data.name.endsWith("Agentflow")) ? "agentflow" : "chatflow";
}

function importAgentFlow(flow: SourceFlow, b: Builder): void {
  const graphs = constructGraphs(flow);
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const start = flow.nodes.find((n) => n.data.name === "startAgentflow");
  // start first so it keeps the id `start`
  const ordered = start ? [start, ...flow.nodes.filter((n) => n !== start)] : flow.nodes;
  for (const n of ordered) {
    const m = plan(n, b);
    if (m) b.mapped.set(n.id, m);
  }
  if (!start) {
    b.reserve("start");
    b.input("question", { type: "string" }, true);
    b.add({ id: "start", kind: "input", name: "Start", disabled: false }, { x: -300, y: 0 });
    b.issue(
      "W_IMPORT_APPROXIMATE",
      "the flow had no start node; one was added with a `question` input",
    );
  }

  for (const n of ordered) {
    const m = b.mapped.get(n.id) as Mapped;
    if (!CONTAINERS.has(n.data.name)) build(n, m, b);
  }

  // containers
  const parentOf = new Map<string, string>(); // FlowAId child id → container id
  for (const n of flow.nodes.filter((x) => x.data.name === "iterationAgentflow")) {
    const m = b.mapped.get(n.id) as Mapped;
    const children = flow.nodes.filter((c) => c.parentNode === n.id);
    for (const c of children) parentOf.set((b.mapped.get(c.id) as Mapped).id, m.id);
    const childIds = new Set(children.map((c) => c.id));
    const terminal = children.find(
      (c) => !(graphs.out.get(c.id) ?? []).some((e) => childIds.has(e.target)),
    );
    const tm = terminal ? b.mapped.get(terminal.id) : undefined;
    const itemsSource =
      typeof n.data.inputs?.iterationInput === "string" ? n.data.inputs.iterationInput : "";
    let items: Binding = textBinding(itemsSource, b, n.id);
    if (items.kind === "literal" && typeof items.value === "string") {
      try {
        items = { kind: "literal", value: JSON.parse(items.value) as never };
      } catch {
        items = { kind: "literal", value: [] };
      }
    }
    b.add(
      {
        id: m.id,
        kind: "foreach",
        name: n.data.label ?? "Iteration",
        items,
        concurrency: 1,
        failurePolicy: "fail_fast",
        bounds: { maxIterations: 1000, maxCostUsd: 1 },
        ...(tm?.port ? { collect: portRef(tm.id, tm.port) } : {}),
        disabled: false,
      },
      n.position,
    );
    b.report(n, "converted", { nodeId: m.id, targetType: "foreach" });
    b.issue(
      "W_IMPORT_APPROXIMATE",
      `${n.data.label ?? n.id}: iterations run one item at a time and collect ${tm ? `each item's '${tm.port}'` : "nothing"}; raise concurrency when the body is independent`,
      { nodeId: m.id, sourceId: n.id },
    );
  }

  const loopBody = new Map<string, { loop: SourceNode; entry: string; body: Set<string> }>();
  for (const n of flow.nodes.filter((x) => x.data.name === "loopAgentflow")) {
    const m = b.mapped.get(n.id) as Mapped;
    const back =
      typeof n.data.inputs?.loopBackToNode === "string" ? n.data.inputs.loopBackToNode : "";
    const entry = back.split("-")[0] ?? "";
    const max = Number(n.data.inputs?.maxLoopCount ?? 5);
    if (!byId.has(entry)) {
      b.todo(n, "the loop's target node is missing", ["exhausted"], undefined, m.id);
      continue;
    }
    const forward = reachable(graphs, entry, n.id);
    const backward = reaching(graphs, n.id);
    const body = new Set([...forward].filter((id) => backward.has(id) && id !== n.id));
    loopBody.set(n.id, { loop: n, entry, body });
    for (const id of body) parentOf.set((b.mapped.get(id) as Mapped).id, m.id);
    b.add(
      {
        id: m.id,
        kind: "loop",
        name: n.data.label ?? "Loop",
        carrySchema: { type: "object", properties: {} },
        carry: { initial: {}, next: {} },
        result: {},
        bounds: {
          maxIterations: Number.isInteger(max) && max > 0 ? Math.min(max, 10_000) : 5,
          maxCostUsd: 1,
        },
        onExhausted: "route",
        disabled: false,
      },
      n.position,
    );
    b.report(n, "converted", { nodeId: m.id, targetType: "loop" });
    b.issue(
      "W_IMPORT_APPROXIMATE",
      `${n.data.label ?? n.id}: the loop back to '${byId.get(entry)?.data.label ?? entry}' is now a loop container that runs its body ${max} times; add an exit condition to stop earlier`,
      { nodeId: m.id, sourceId: n.id },
    );
  }
  for (const node of b.nodes) {
    const parent = parentOf.get(node.id);
    if (parent) node.parent = parent;
  }
  // nodes after a loop read its body's results through the loop's `result` output
  for (const [loopSource, { body }] of loopBody) {
    const loopId = (b.mapped.get(loopSource) as Mapped).id;
    const exposed = new Map<string, string>(); // body node id → its result port
    for (const id of body) {
      const m = b.mapped.get(id) as Mapped;
      if (m.port) exposed.set(m.id, m.port);
    }
    const loopNode = b.nodes.find((n) => n.id === loopId);
    if (loopNode?.kind === "loop")
      loopNode.result = Object.fromEntries(
        [...exposed].map(([id, port]) => [id, portRef(id, port)]),
      );
    for (const node of b.nodes) {
      if (node.parent === loopId || node.id === loopId) continue;
      rewriteRefs(node, loopId, exposed);
    }
  }

  // control edges
  const notes = new Set(
    flow.nodes.filter((n) => n.data.name === "stickyNoteAgentflow").map((n) => n.id),
  );
  const idOf = (sourceId: string) => (b.mapped.get(sourceId) as Mapped).id;
  const scopeOf = (sourceId: string) => parentOf.get(idOf(sourceId));
  let dropped = 0;
  for (const e of flow.edges) {
    if (notes.has(e.source) || notes.has(e.target)) continue;
    const sm = b.mapped.get(e.source);
    const tm = b.mapped.get(e.target);
    if (!sm || !tm) continue;
    const loopOfTarget = loopBody.get(e.target);
    if (loopOfTarget && loopOfTarget.body.has(e.source)) continue; // the back edge itself
    let to = tm.id;
    for (const { loop, entry, body } of loopBody.values()) {
      if (e.target === entry && !body.has(e.source)) to = (b.mapped.get(loop.id) as Mapped).id;
    }
    const out = handleOutput(e.sourceHandle);
    const port = (out !== undefined ? sm.ports?.[out] : undefined) ?? sm.donePort;
    const fromScope = scopeOf(e.source);
    const toScope = to === tm.id ? scopeOf(e.target) : parentOf.get(to);
    if (fromScope !== toScope) {
      dropped += 1;
      continue;
    }
    b.edge(sm.id, port, to);
  }
  if (dropped > 0)
    b.issue(
      "W_IMPORT_APPROXIMATE",
      `${dropped} edge(s) crossed an iteration or loop boundary and were dropped; connect the container instead`,
    );

  // outputs for nodes whose result ends the flow
  const hasOut = new Set(b.edges.map((e) => e.from.node));
  const terminals = b.nodes.filter(
    (n) =>
      !n.parent &&
      !hasOut.has(n.id) &&
      n.kind !== "output" &&
      n.kind !== "note" &&
      n.kind !== "input" &&
      n.kind !== "branch",
  );
  for (const t of terminals) {
    const source = [...b.mapped.entries()].find(([, m]) => m.id === t.id);
    const m = source?.[1];
    const port = m?.port ?? (t.kind === "loop" ? "result" : undefined);
    const outId = b.id(`out_${t.id}`);
    const pos = b.layout.get(t.id);
    b.outputProps.set("answer", {});
    b.add(
      {
        id: outId,
        kind: "output",
        name: `Result of ${t.name}`.slice(0, 120),
        value: {
          kind: "object",
          fields: { answer: port ? portRef(t.id, port) : { kind: "literal", value: null } },
        },
        earlyExit: false,
        disabled: false,
      },
      pos ? { x: pos.x + 320, y: pos.y } : undefined,
    );
    b.edge(t.id, m?.donePort ?? "done", outId);
  }
  if (!b.nodes.some((n) => n.kind === "output")) {
    const outId = b.id("result");
    b.outputProps.set("answer", {});
    b.add({
      id: outId,
      kind: "output",
      name: "Result",
      value: { kind: "object", fields: { answer: { kind: "literal", value: null } } },
      earlyExit: false,
      disabled: false,
    });
    b.edge("start", "done", outId);
  }
}

/** Redirects `bodyNode.port` references (bindings, templates, expressions) to `loop.result.bodyNode`. */
function rewriteRefs(value: unknown, loopId: string, exposed: Map<string, string>): void {
  if (Array.isArray(value)) {
    for (const v of value) rewriteRefs(v, loopId, exposed);
    return;
  }
  if (!isRecord(value)) return;
  if (
    value.kind === "port" &&
    typeof value.node === "string" &&
    exposed.get(value.node) === value.port
  ) {
    const path = typeof value.path === "string" ? value.path : "";
    value.path = `/${value.node}${path}`;
    value.node = loopId;
    value.port = "result";
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string" && (k === "source" || k === "when" || v.includes("{{"))) {
      let text = v;
      for (const [id, port] of exposed)
        text = text.replace(new RegExp(`\\b${id}\\.${port}\\b`, "g"), `${loopId}.result.${id}`);
      value[k] = text;
    } else rewriteRefs(v, loopId, exposed);
  }
}

/** Imports an external flow export as a FlowAId workflow definition with a migration report. */
export function importExternalFlow(data: unknown, options: ImportOptions = {}): ImportResult {
  const flow = parseExternalFlow(data);
  const format = detectFormat(flow);
  const b = new Builder();
  if (format === "agentflow") importAgentFlow(flow, b);
  else importChatFlow(flow, b);

  const name = (options.name ?? flow.name ?? "Imported flow").slice(0, 120) || "Imported flow";
  const properties: Record<string, JsonSchema> = Object.fromEntries(b.inputProps);
  const inputs: JsonObject = {
    type: "object",
    properties: properties as JsonObject,
    ...(b.requiredInputs.size > 0 ? { required: [...b.requiredInputs] } : {}),
  };
  const outputs: JsonObject = {
    type: "object",
    properties: Object.fromEntries(b.outputProps) as JsonObject,
  };
  const definition = WorkflowDefinitionSchema.parse({
    $schema: WORKFLOW_SCHEMA_URI,
    id: options.id ?? uuidv7(),
    name,
    description: `Imported from an external flow export (${format === "agentflow" ? "agent flow" : "LangChain chat flow"}).`,
    inputs,
    outputs,
    nodes: b.nodes satisfies WorkflowNode[],
    edges: b.edges,
    variables: [...b.variables].map(([n, v]) => ({ name: n, ...v })),
    secrets: [...b.secrets].map(([n, credentialType]) => ({ name: n, credentialType })),
    layout: { nodes: Object.fromEntries(b.layout) },
  });

  const counts = { imported: 0, converted: 0, needsConfig: 0, unsupported: 0 };
  for (const r of b.reports) {
    if (r.status === "imported") counts.imported += 1;
    else if (r.status === "converted") counts.converted += 1;
    else if (r.status === "needs_config") counts.needsConfig += 1;
    else counts.unsupported += 1;
  }
  const report: ImportReport = {
    format,
    workflowName: name,
    counts,
    nodes: b.reports,
    issues: b.issues,
    secrets: [...b.secrets.keys()],
  };
  return { definition, report };
}
