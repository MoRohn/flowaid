/**
 * `diff(a, b)` (ARCHITECTURE.md §4.7): what changed between two definitions, over their canonical
 * forms. Nodes and edges are matched by id; everything else is an RFC 6902 patch per section.
 * `layout` never counts as a change unless it is the only one (`layoutOnly`).
 */
import {
  WorkflowDefinitionSchema,
  escapePointerToken,
  type JsonPatch,
  type JsonValue,
  type WorkflowDefinition,
} from "@flowaid/workflow-core";
import { stableStringify } from "@flowaid/shared";
import { compareStrings, isPlainObject } from "./util.js";

export interface WorkflowDiff {
  nodes: { added: string[]; removed: string[]; changed: { id: string; patch: JsonPatch }[] };
  edges: { added: string[]; removed: string[] };
  inputs: JsonPatch;
  outputs: JsonPatch;
  variables: JsonPatch;
  secrets: JsonPatch;
  execution: JsonPatch;
  /** Name, description, triggers and metadata (paths from the document root). */
  document: JsonPatch;
  /** Only `layout` differs. */
  layoutOnly: boolean;
}

const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

/** A minimal RFC 6902 patch turning `a` into `b`: objects and equal-length arrays recurse, anything else is replaced. */
export function jsonPatch(a: unknown, b: unknown, base = ""): JsonPatch {
  if (same(a, b)) return [];
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.flatMap((item, i) => jsonPatch(item, b[i], `${base}/${i}`));
  }
  if (!isPlainObject(a) || !isPlainObject(b))
    return [{ op: "replace", path: base, value: b as JsonValue }];
  const patch: JsonPatch = [];
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(compareStrings);
  for (const key of keys) {
    const path = `${base}/${escapePointerToken(key)}`;
    if (!Object.hasOwn(b, key)) patch.push({ op: "remove", path });
    else if (!Object.hasOwn(a, key)) patch.push({ op: "add", path, value: b[key] as JsonValue });
    else patch.push(...jsonPatch(a[key], b[key], path));
  }
  return patch;
}

function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

export function diff(before: unknown, after: unknown): WorkflowDiff {
  const a: WorkflowDefinition = WorkflowDefinitionSchema.parse(before);
  const b: WorkflowDefinition = WorkflowDefinitionSchema.parse(after);
  const nodesA = byId(a.nodes);
  const nodesB = byId(b.nodes);
  const edgesA = byId(a.edges);
  const edgesB = byId(b.edges);
  const sortedIds = (ids: Iterable<string>) => [...ids].sort(compareStrings);

  const changedNodes: { id: string; patch: JsonPatch }[] = [];
  for (const id of sortedIds(nodesA.keys())) {
    const next = nodesB.get(id);
    if (!next) continue;
    const patch = jsonPatch(nodesA.get(id), next);
    if (patch.length > 0) changedNodes.push({ id, patch });
  }
  // An edge whose endpoints changed is a different edge: removed and added under the same id.
  const edgeChanged = (id: string) => !same(edgesA.get(id), edgesB.get(id));
  const document = [
    ...jsonPatch(a.name, b.name, "/name"),
    ...jsonPatch(a.description, b.description, "/description"),
    ...jsonPatch(a.triggers, b.triggers, "/triggers"),
    ...jsonPatch(a.metadata, b.metadata, "/metadata"),
  ];
  const result: WorkflowDiff = {
    nodes: {
      added: sortedIds([...nodesB.keys()].filter((id) => !nodesA.has(id))),
      removed: sortedIds([...nodesA.keys()].filter((id) => !nodesB.has(id))),
      changed: changedNodes,
    },
    edges: {
      added: sortedIds([...edgesB.keys()].filter((id) => !edgesA.has(id) || edgeChanged(id))),
      removed: sortedIds([...edgesA.keys()].filter((id) => !edgesB.has(id) || edgeChanged(id))),
    },
    inputs: jsonPatch(a.inputs, b.inputs),
    outputs: jsonPatch(a.outputs, b.outputs),
    variables: jsonPatch(a.variables, b.variables),
    secrets: jsonPatch(a.secrets, b.secrets),
    execution: jsonPatch(a.execution, b.execution),
    document,
    layoutOnly: false,
  };
  const empty =
    result.nodes.added.length + result.nodes.removed.length + result.nodes.changed.length === 0 &&
    result.edges.added.length + result.edges.removed.length === 0 &&
    [
      result.inputs,
      result.outputs,
      result.variables,
      result.secrets,
      result.execution,
      result.document,
    ].every((p) => p.length === 0);
  result.layoutOnly = empty && !same(a.layout ?? null, b.layout ?? null);
  return result;
}
