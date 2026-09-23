/**
 * Decision batch groups (ARCHITECTURE.md §4.4). TypeSafe answers several questions over one
 * `state` in a single request. A batch group is a maximal set of boolean/choice/score decision
 * nodes in one scope with an identical `state` binding, the same primary hop and credential,
 * identical guards and no dependency path between them. Groups are formed greedily in node-id
 * order, so the result is deterministic.
 */
import { sha256Json } from "@flowaid/shared";
import type { BatchGroup, ProviderHop } from "@flowaid/workflow-core";
import type { CompileContext } from "./context.js";
import type { ScopeGraph } from "./passes/controlflow.js";
import { compareStrings } from "./util.js";

const BATCHABLE = new Set(["boolean", "choice", "score"]);

function reachable(graph: ScopeGraph, from: string, to: string): boolean {
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const v = queue.shift();
    if (v === undefined) break;
    if (v === to) return true;
    for (const w of graph.succs.get(v) ?? []) {
      if (!seen.has(w)) {
        seen.add(w);
        queue.push(w);
      }
    }
  }
  return false;
}

export function batchGroups(
  ctx: CompileContext,
  scopes: Map<string, ScopeGraph>,
  primary: ProviderHop,
): Map<string, BatchGroup> {
  const groups = new Map<string, BatchGroup>();
  if (!ctx.definition.execution.decisions.batching) return groups;

  const buckets = new Map<string, { scope: string; hash: string; members: string[] }>();
  for (const info of ctx.active()) {
    if (info.node.kind !== "task") continue;
    const kind = info.manifest?.decision?.kind;
    if (!kind || !BATCHABLE.has(kind)) continue;
    const state = info.node.inputs.state;
    if (state === undefined) continue;
    const hash = sha256Json(state);
    const key = JSON.stringify([
      info.scope,
      hash,
      primary,
      info.node.credentials.typesafe ?? null,
      info.guard ?? null,
    ]);
    const bucket = buckets.get(key) ?? { scope: info.scope, hash, members: [] };
    bucket.members.push(info.node.id);
    buckets.set(key, bucket);
  }

  for (const bucket of buckets.values()) {
    if (bucket.members.length < 2) continue;
    const graph = scopes.get(bucket.scope);
    if (!graph) continue;
    const partitions: string[][] = [];
    for (const id of [...bucket.members].sort(compareStrings)) {
      const home = partitions.find((group) =>
        group.every((other) => !reachable(graph, other, id) && !reachable(graph, id, other)),
      );
      if (home) home.push(id);
      else partitions.push([id]);
    }
    for (const nodes of partitions) {
      if (nodes.length < 2) continue;
      const id = `batch_${nodes[0]}`;
      groups.set(id, { id, scope: bucket.scope, nodes, primary, stateBindingHash: bucket.hash });
      ctx.diagnostics.add(
        "I_BATCH_GROUP",
        `${nodes.map((n) => `'${n}'`).join(", ")} ask about the same state and run as one decision request`,
        { nodeId: nodes[0], scope: bucket.scope },
        { related: nodes.slice(1).map((n) => ({ nodeId: n, message: "in the same batch" })) },
      );
    }
  }
  return groups;
}
