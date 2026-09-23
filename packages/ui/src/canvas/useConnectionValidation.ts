/**
 * Schema-aware connection validation for the canvas (UI.md §4.2).
 *
 * Data handles (`out:<port>` → `in:<port>`): the source port's schema must be
 * a subschema of the target port's (`isSubschema`, the compiler's own check);
 * an undecidable pair is allowed but unverified. The target port may be
 * unbound or bound by a `ref` (the new connection replaces that binding); a
 * port bound by a template or expression is edited in the inspector instead.
 *
 * Control handles (`ctl:<port>` → `ctl-in`): the port must be one of the
 * source's control-outs, both nodes must sit in the same scope (container)
 * and the target must have a control-in.
 *
 * Everywhere: no self loops, no duplicate edges, no mixing data and control.
 * Every rejection carries a human-readable reason for the handle tooltip.
 */
import { useCallback, useMemo, useState } from "react";
import type { Connection, Edge, OnConnectEnd, OnConnectStart } from "@xyflow/react";
import { isSubschema, type JsonSchemaType } from "@flowaid/workflow-core";
import {
  CONTROL_IN,
  cardControlOuts,
  cardVariantFor,
  handleId,
  hasControlIn,
  parseHandleId,
} from "@/node";
import type {
  ContractJsonSchema,
  DataEdgeVia,
  PortView,
  WorkflowEdgeView,
  WorkflowNodeView,
} from "@/types";

/** Result of a connection check: allowed (and whether the schemas were fully verified) or rejected with a reason. */
export type ConnectionCheck = { ok: true; verified: boolean } | { ok: false; reason: string };

export interface PendingConnection {
  nodeId: string;
  handleId: string | null;
  handleType: "source" | "target";
}

export interface ConnectionValidation {
  /** For React Flow's `isValidConnection` prop. */
  isValidConnection: (edge: Edge | Connection) => boolean;
  /** The full verdict for a connection, with the reason when it is rejected. */
  checkConnection: (connection: EdgeLike) => ConnectionCheck;
  /** Handle ids per node id that accept the connection currently being dragged. */
  compatibleHandles: ReadonlyMap<string, readonly string[]>;
  /** Why handles of the dragged family reject it, per node id then handle id. */
  handleReasons: ReadonlyMap<string, Readonly<Record<string, string>>>;
  /** The handle being dragged, or null. */
  pending: PendingConnection | null;
  onConnectStart: OnConnectStart;
  onConnectEnd: OnConnectEnd;
  /** The JSON Schema behind a data handle (`in:<port>` / `out:<port>`), or undefined. */
  portSchemaOf: (
    nodeId: string,
    handleId: string | null | undefined,
  ) => ContractJsonSchema | undefined;
  /** Every connection that may start at a node (the keyboard connect mode's target list). */
  connectionOptionsFrom: (nodeId: string) => ConnectionOption[];
}

/** One connection the keyboard connect mode offers: a compatible (source handle → target handle) pair. */
export interface ConnectionOption {
  source: string;
  /** Prefixed source handle id (`out:<port>` / `ctl:<port>`). */
  sourceHandle: string;
  sourceLabel: string;
  target: string;
  targetName: string;
  /** Prefixed target handle id (`in:<port>` / `ctl-in`). */
  targetHandle: string;
  targetLabel: string;
  family: "control" | "data";
  /** False when the schemas could not be fully compared (allowed but unverified). */
  verified: boolean;
}

/** An existing edge as the validator needs it: a `WorkflowEdgeView` or an xyflow `CanvasEdge`. */
export interface EdgeLike {
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
  via?: DataEdgeVia;
  data?: Record<string, unknown>;
}

const JSON_TYPES: ReadonlySet<string> = new Set<JsonSchemaType>([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
]);

function isJsonSchemaType(value: string): value is JsonSchemaType {
  return JSON_TYPES.has(value);
}

/**
 * The schema a port is checked with: its `schema`, else `{ type }` when its
 * type label names a JSON Schema primitive, else `{}` (unconstrained; named
 * types such as "decision" without a schema cannot be verified).
 */
export function portSchema(port: Pick<PortView, "type" | "schema">): ContractJsonSchema {
  if (port.schema) return port.schema;
  const t = port.type.trim().toLowerCase();
  return isJsonSchemaType(t) ? { type: t } : {};
}

/** `isSubschema(source, target)` as a connection verdict, with the failing path in the reason. */
export function checkPortSchemas(
  source: Pick<PortView, "label" | "type" | "schema">,
  target: Pick<PortView, "label" | "type" | "schema">,
): ConnectionCheck {
  const result = isSubschema(portSchema(source), portSchema(target));
  if (result.ok) return { ok: true, verified: result.verified };
  const where = result.path ? ` at ${result.path}` : "";
  return {
    ok: false,
    reason: `${source.label} does not fit ${target.label}${where}: ${result.reason}`,
  };
}

function viaOf(edge: EdgeLike): DataEdgeVia {
  if (edge.via) return edge.via;
  const v = edge.data?.via;
  return v === "template" || v === "expr" || v === "hoisted" ? v : "ref";
}

function sameEdge(a: EdgeLike, b: EdgeLike): boolean {
  return (
    a.source === b.source &&
    a.target === b.target &&
    (a.sourceHandle ?? null) === (b.sourceHandle ?? null) &&
    (a.targetHandle ?? null) === (b.targetHandle ?? null)
  );
}

/** Checks one connection against the graph (pure; `useConnectionValidation` binds it to the current nodes and edges). */
export function validateConnection(
  connection: EdgeLike,
  nodes: ReadonlyMap<string, WorkflowNodeView>,
  edges: ReadonlyArray<EdgeLike | WorkflowEdgeView>,
): ConnectionCheck {
  const source = nodes.get(connection.source);
  const target = nodes.get(connection.target);
  if (!source || !target) return { ok: false, reason: "Unknown node" };
  if (source.id === target.id) return { ok: false, reason: "A node cannot connect to itself" };
  const from = parseHandleId(connection.sourceHandle);
  const to = parseHandleId(connection.targetHandle);
  if (!from || !to) return { ok: false, reason: "Unknown handle" };
  if (from.kind === "in" || from.kind === "ctl-in")
    return { ok: false, reason: "Connections start at an output" };

  if (from.kind === "ctl") {
    if (to.kind !== "ctl-in")
      return { ok: false, reason: `Control-out ${from.port} connects to a control input` };
    if (!cardControlOuts(source).some((c) => c.id === from.port)) {
      return { ok: false, reason: `${source.name} has no control-out ${from.port}` };
    }
    if (!hasControlIn(cardVariantFor(target)))
      return { ok: false, reason: `${target.name} has no control input` };
    if ((source.parent ?? "") !== (target.parent ?? "")) {
      return { ok: false, reason: "Control edges cannot cross a container boundary" };
    }
    if (edges.some((e) => sameEdge(e, connection)))
      return { ok: false, reason: "Already connected" };
    return { ok: true, verified: true };
  }

  if (to.kind !== "in")
    return { ok: false, reason: `Output ${from.port} connects to a data input` };
  const out = source.outputs.find((p) => p.id === from.port);
  if (!out) return { ok: false, reason: `${source.name} has no output ${from.port}` };
  const input = target.inputs.find((p) => p.id === to.port);
  if (!input) return { ok: false, reason: `${target.name} has no input ${to.port}` };
  for (const e of edges) {
    if (e.target !== target.id || (e.targetHandle ?? null) !== (connection.targetHandle ?? null))
      continue;
    if (sameEdge(e, connection)) return { ok: false, reason: "Already connected" };
    const via = viaOf(e);
    if (via !== "ref") {
      return {
        ok: false,
        reason: `${input.label} is bound by ${via === "expr" ? "an expression" : `a ${via} binding`}; edit it in the inspector`,
      };
    }
  }
  return checkPortSchemas(out, input);
}

/** The target handles of a node, in card order. */
function targetHandles(node: WorkflowNodeView): string[] {
  const ids = node.inputs.map((p) => handleId("in", p.id));
  return hasControlIn(cardVariantFor(node)) ? [CONTROL_IN, ...ids] : ids;
}

/** The source handles of a node, in card order. */
function sourceHandles(node: WorkflowNodeView): string[] {
  return [
    ...cardControlOuts(node).map((c) => handleId("ctl", c.id)),
    ...node.outputs.map((p) => handleId("out", p.id)),
  ];
}

/** Whether two handle ids belong to the same family (data or control). */
function sameFamily(a: string | null, b: string): boolean {
  const pa = parseHandleId(a);
  const pb = parseHandleId(b);
  if (!pa || !pb) return false;
  const control = (k: string) => k === "ctl" || k === "ctl-in";
  return control(pa.kind) === control(pb.kind);
}

/** The label a handle shows: the port or control-out label, "control in" for the notch. */
export function handleLabel(node: WorkflowNodeView, id: string): string {
  const parsed = parseHandleId(id);
  if (!parsed) return id;
  if (parsed.kind === "ctl-in") return "control in";
  if (parsed.kind === "ctl")
    return cardControlOuts(node).find((c) => c.id === parsed.port)?.label ?? parsed.port;
  const ports = parsed.kind === "in" ? node.inputs : node.outputs;
  return ports.find((p) => p.id === parsed.port)?.label ?? parsed.port;
}

/**
 * Every allowed connection from `sourceId`: each of its source handles (control-outs, then
 * data outputs, in card order) against every other node's target handles, kept when
 * `validateConnection` accepts it. Control options come first, then data, each in node order.
 */
export function connectionOptionsFrom(
  sourceId: string,
  nodes: ReadonlyMap<string, WorkflowNodeView>,
  edges: ReadonlyArray<EdgeLike | WorkflowEdgeView>,
): ConnectionOption[] {
  const source = nodes.get(sourceId);
  if (!source) return [];
  const control: ConnectionOption[] = [];
  const data: ConnectionOption[] = [];
  for (const sourceHandle of sourceHandles(source)) {
    const family = parseHandleId(sourceHandle)?.kind === "ctl" ? "control" : "data";
    for (const target of nodes.values()) {
      if (target.id === source.id) continue;
      for (const targetHandle of targetHandles(target)) {
        if (!sameFamily(sourceHandle, targetHandle)) continue;
        const verdict = validateConnection(
          { source: source.id, sourceHandle, target: target.id, targetHandle },
          nodes,
          edges,
        );
        if (!verdict.ok) continue;
        (family === "control" ? control : data).push({
          source: source.id,
          sourceHandle,
          sourceLabel: handleLabel(source, sourceHandle),
          target: target.id,
          targetName: target.name,
          targetHandle,
          targetLabel: handleLabel(target, targetHandle),
          family,
          verified: verdict.verified,
        });
      }
    }
  }
  return [...control, ...data];
}

export function useConnectionValidation(
  nodes: WorkflowNodeView[],
  edges: ReadonlyArray<EdgeLike | WorkflowEdgeView>,
): ConnectionValidation {
  const [pending, setPending] = useState<PendingConnection | null>(null);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const checkConnection = useCallback(
    (c: EdgeLike) => validateConnection(c, byId, edges),
    [byId, edges],
  );

  const isValidConnection = useCallback(
    (c: Edge | Connection): boolean =>
      checkConnection({
        source: c.source,
        sourceHandle: c.sourceHandle,
        target: c.target,
        targetHandle: c.targetHandle,
      }).ok,
    [checkConnection],
  );

  const portSchemaOf = useCallback(
    (nodeId: string, id: string | null | undefined) => {
      const node = byId.get(nodeId);
      const parsed = parseHandleId(id);
      if (!node || !parsed || parsed.kind === "ctl" || parsed.kind === "ctl-in") return undefined;
      const port = (parsed.kind === "in" ? node.inputs : node.outputs).find(
        (p) => p.id === parsed.port,
      );
      return port ? portSchema(port) : undefined;
    },
    [byId],
  );

  const { compatibleHandles, handleReasons } = useMemo(() => {
    const compatible = new Map<string, string[]>();
    const reasons = new Map<string, Record<string, string>>();
    if (!pending) return { compatibleHandles: compatible, handleReasons: reasons };
    const fromSource = pending.handleType === "source";
    for (const node of nodes) {
      if (node.id === pending.nodeId) continue;
      const ok: string[] = [];
      const why: Record<string, string> = {};
      for (const id of fromSource ? targetHandles(node) : sourceHandles(node)) {
        const c: EdgeLike = fromSource
          ? {
              source: pending.nodeId,
              sourceHandle: pending.handleId,
              target: node.id,
              targetHandle: id,
            }
          : {
              source: node.id,
              sourceHandle: id,
              target: pending.nodeId,
              targetHandle: pending.handleId,
            };
        const verdict = checkConnection(c);
        if (verdict.ok) ok.push(id);
        else if (sameFamily(pending.handleId, id)) why[id] = verdict.reason;
      }
      compatible.set(node.id, ok);
      if (Object.keys(why).length) reasons.set(node.id, why);
    }
    return { compatibleHandles: compatible, handleReasons: reasons };
  }, [pending, nodes, checkConnection]);

  const onConnectStart = useCallback<OnConnectStart>((_event, params) => {
    if (!params.nodeId || !params.handleType) return;
    setPending({ nodeId: params.nodeId, handleId: params.handleId, handleType: params.handleType });
  }, []);

  const onConnectEnd = useCallback<OnConnectEnd>(() => {
    setPending(null);
  }, []);

  const optionsFrom = useCallback(
    (nodeId: string) => connectionOptionsFrom(nodeId, byId, edges),
    [byId, edges],
  );

  return {
    isValidConnection,
    checkConnection,
    compatibleHandles,
    handleReasons,
    pending,
    onConnectStart,
    onConnectEnd,
    portSchemaOf,
    connectionOptionsFrom: optionsFrom,
  };
}
