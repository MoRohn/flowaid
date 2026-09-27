/**
 * Graph helpers over an external flow export: forward and reverse adjacency (the shape the
 * source editor's `constructGraphs` helper builds; this is an independent implementation), the
 * output index of a source handle, and reachability for loop bodies.
 */
import type { SourceEdge, SourceFlow } from "./types.js";

export interface Graphs {
  /** node id → outgoing edges */
  out: Map<string, SourceEdge[]>;
  /** node id → incoming edges */
  in: Map<string, SourceEdge[]>;
}

export function constructGraphs(flow: SourceFlow): Graphs {
  const out = new Map<string, SourceEdge[]>();
  const inn = new Map<string, SourceEdge[]>();
  for (const n of flow.nodes) {
    out.set(n.id, []);
    inn.set(n.id, []);
  }
  for (const e of flow.edges) {
    if (!out.has(e.source) || !inn.has(e.target)) continue;
    out.get(e.source)?.push(e);
    inn.get(e.target)?.push(e);
  }
  return { out, in: inn };
}

/**
 * The output a source handle names: `condition_0-output-1` → `1`, and for single-output nodes
 * (`llm_0-output-llmAgentflow`) the trailing name.
 */
export function handleOutput(handle: string | undefined): string | undefined {
  if (!handle) return undefined;
  const i = handle.lastIndexOf("-output-");
  if (i === -1) return undefined;
  return handle.slice(i + "-output-".length).split("-")[0];
}

/** Nodes reachable from `from` by following outgoing edges (not crossing `stop`). */
export function reachable(graphs: Graphs, from: string, stop?: string): Set<string> {
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id) || id === stop) continue;
    seen.add(id);
    for (const e of graphs.out.get(id) ?? []) queue.push(e.target);
  }
  return seen;
}

/** Nodes that can reach `to` by following incoming edges backwards. */
export function reaching(graphs: Graphs, to: string): Set<string> {
  const seen = new Set<string>();
  const queue = [to];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of graphs.in.get(id) ?? []) queue.push(e.source);
  }
  return seen;
}
