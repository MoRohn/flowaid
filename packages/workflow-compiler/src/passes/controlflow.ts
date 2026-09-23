/**
 * Pass 5 — dependency & guards (ARCHITECTURE.md §4.1, §4.3).
 *
 * Per scope: the union of in-scope data dependencies (including hoisted ones) and control
 * edges; Tarjan SCC for cycles; reachability from the input node (root) or the body entries;
 * guards in topological order with exclusive control groups; conditional data dependencies;
 * output ambiguity; branch, join, loop and foreach checks; race private subgraphs.
 */
import {
  isSubschema,
  printAst,
  type ExprAst,
  type Guard,
  type JsonSchema,
} from "@flowaid/workflow-core";
import type { CompileContext, NodeInfo } from "../context.js";
import { nodePath } from "../diagnostics.js";
import { ALWAYS, and, andAll, exclusive, implies, orAll, type Exclusivity } from "../guards.js";
import { compareStrings, isPlainObject, sortedUnique } from "../util.js";

export interface ScopeGraph {
  id: string;
  /** Active, reachable nodes of the scope in definition order. */
  nodes: string[];
  /** In-scope predecessors per node (data, hoisted and control). */
  preds: Map<string, Set<string>>;
  succs: Map<string, Set<string>>;
  /** Deterministic topological order (Kahn, ties by node id); empty when the scope has a cycle. */
  order: string[];
  entries: string[];
}

export interface ControlFlow {
  scopes: Map<string, ScopeGraph>;
  /** Race joins: edge id → private subgraph node ids. */
  privateSubgraphs: Map<string, Record<string, string[]>>;
  exclusivity: Exclusivity;
}

export function controlFlowPass(ctx: CompileContext): ControlFlow {
  const exclusivity: Exclusivity = (id) => ctx.node(id)?.exclusiveFamilies ?? [];
  const scopes = new Map<string, ScopeGraph>();
  const scopeIds = ["", ...[...ctx.bodies.keys()].filter((id) => !ctx.dropped.has(id))];
  for (const scope of scopeIds) scopes.set(scope, buildScope(ctx, scope));

  const cyclic = detectCycles(ctx, scopes);
  pruneUnreachable(ctx, scopes);
  for (const graph of scopes.values()) graph.order = cyclic.has(graph.id) ? [] : topoOrder(graph);

  const privateSubgraphs = new Map<string, Record<string, string[]>>();
  if (cyclic.size === 0) {
    // Outer scopes first: a body's guards are relative to its own scope, so order is free.
    for (const graph of scopes.values()) computeGuards(ctx, graph, exclusivity);
    checkConditionalDeps(ctx, scopes, exclusivity);
    checkOutputs(ctx, exclusivity);
    for (const graph of scopes.values()) {
      for (const id of graph.nodes) {
        const info = ctx.node(id);
        if (!info) continue;
        if (info.node.kind === "join") {
          const subgraphs = checkJoin(ctx, info, graph);
          if (subgraphs) privateSubgraphs.set(id, subgraphs);
        }
      }
    }
  }
  for (const info of ctx.active()) {
    if (info.node.kind === "branch") checkBranch(ctx, info);
    if (info.node.kind === "loop") checkLoop(ctx, info);
    if (info.node.kind === "foreach") checkForeach(ctx, info);
    if (info.manifest?.decision?.kind === "router") checkRouter(ctx, info);
  }
  checkPorts(ctx, scopes);
  return { scopes, privateSubgraphs, exclusivity };
}

// ── graphs ──────────────────────────────────────────────────────────────────

function buildScope(ctx: CompileContext, scope: string): ScopeGraph {
  const nodes = ctx
    .active()
    .filter((n) => n.scope === scope)
    .map((n) => n.node.id);
  const members = new Set(nodes);
  const preds = new Map<string, Set<string>>(nodes.map((n) => [n, new Set<string>()]));
  const succs = new Map<string, Set<string>>(nodes.map((n) => [n, new Set<string>()]));
  const link = (from: string, to: string) => {
    if (!members.has(from) || !members.has(to) || from === to) return;
    preds.get(to)?.add(from);
    succs.get(from)?.add(to);
  };
  for (const id of nodes) {
    const info = ctx.node(id);
    if (!info) continue;
    for (const dep of info.dataIn) link(dep.from.node, id);
    for (const edge of info.controlIn) link(edge.from.node, id);
  }
  return { id: scope, nodes, preds, succs, order: [], entries: [] };
}

/** Tarjan's SCC per scope; every non-trivial component is one E_CYCLE. */
function detectCycles(ctx: CompileContext, scopes: Map<string, ScopeGraph>): Set<string> {
  const cyclicScopes = new Set<string>();
  for (const graph of scopes.values()) {
    let index = 0;
    const indexOf = new Map<string, number>();
    const low = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const components: string[][] = [];
    const strong = (v: string): void => {
      indexOf.set(v, index);
      low.set(v, index);
      index += 1;
      stack.push(v);
      onStack.add(v);
      for (const w of [...(graph.succs.get(v) ?? [])].sort(compareStrings)) {
        if (!indexOf.has(w)) {
          strong(w);
          low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v) ?? 0, indexOf.get(w) ?? 0));
        }
      }
      if (low.get(v) === indexOf.get(v)) {
        const component: string[] = [];
        let w: string | undefined;
        do {
          w = stack.pop();
          if (w === undefined) break;
          onStack.delete(w);
          component.push(w);
        } while (w !== v);
        if (component.length > 1) components.push(component.sort(compareStrings));
      }
    };
    for (const v of graph.nodes) if (!indexOf.has(v)) strong(v);
    for (const component of components) {
      cyclicScopes.add(graph.id);
      const first = component[0] ?? "";
      const info = ctx.node(first);
      ctx.diagnostics.add(
        "E_CYCLE",
        `These nodes depend on each other in a cycle: ${component.join(", ")}. Break the cycle, or use a loop to repeat work`,
        { nodeId: first, ...(info ? { path: nodePath(info.index) } : {}), scope: graph.id },
        { related: component.slice(1).map((id) => ({ nodeId: id, message: "in the cycle" })) },
      );
    }
  }
  return cyclicScopes;
}

/**
 * Reachability: from the input node in the root scope, from the body entries in a container.
 * Unreachable nodes are dropped (W_UNREACHABLE); a reachable node that requires an unreachable
 * producer is E_DANGLING_DEPENDENCY.
 */
function pruneUnreachable(ctx: CompileContext, scopes: Map<string, ScopeGraph>): void {
  for (const graph of scopes.values()) {
    const starts =
      graph.id === ""
        ? graph.nodes.filter((id) => ctx.node(id)?.node.kind === "input")
        : graph.nodes.filter((id) => (graph.preds.get(id)?.size ?? 0) === 0);
    const reached = new Set<string>(starts);
    const queue = [...starts];
    while (queue.length > 0) {
      const v = queue.shift();
      if (v === undefined) break;
      for (const w of graph.succs.get(v) ?? []) {
        if (!reached.has(w)) {
          reached.add(w);
          queue.push(w);
        }
      }
    }
    const unreachable = graph.nodes.filter((id) => !reached.has(id));
    for (const id of unreachable) {
      const info = ctx.node(id);
      if (!info) continue;
      ctx.diagnostics.add(
        "W_UNREACHABLE",
        graph.id === ""
          ? `'${id}' is not connected to the input node and never runs`
          : `'${id}' cannot start inside '${graph.id}'`,
        { nodeId: id, path: nodePath(info.index), scope: graph.id },
      );
    }
    for (const id of graph.nodes) {
      if (!reached.has(id)) continue;
      const info = ctx.node(id);
      if (!info) continue;
      for (const dep of info.dataIn) {
        if (!dep.optional && unreachable.includes(dep.from.node)) {
          ctx.diagnostics.add(
            "E_DANGLING_DEPENDENCY",
            `'${id}' needs '${dep.from.node}.${dep.from.port}', but '${dep.from.node}' never runs`,
            { nodeId: id, path: dep.definitionPath, bindingPath: dep.bindingPath, scope: graph.id },
          );
        }
      }
    }
    for (const id of unreachable) {
      ctx.dropped.add(id);
      // The body of a dropped container goes with it.
      for (const bodyId of ctx.bodies.get(id) ?? []) ctx.dropped.add(bodyId);
    }
    if (unreachable.length > 0) {
      const keep = new Set(graph.nodes.filter((id) => reached.has(id)));
      graph.nodes = graph.nodes.filter((id) => keep.has(id));
      for (const id of unreachable) {
        graph.preds.delete(id);
        graph.succs.delete(id);
      }
      for (const set of [...graph.preds.values(), ...graph.succs.values()]) {
        for (const id of unreachable) set.delete(id);
      }
    }
  }
  for (const [id, graph] of [...scopes])
    if (id !== "" && ctx.dropped.has(id)) scopes.delete(graph.id);
}

function topoOrder(graph: ScopeGraph): string[] {
  const indegree = new Map(graph.nodes.map((id) => [id, graph.preds.get(id)?.size ?? 0]));
  graph.entries = graph.nodes.filter((id) => (indegree.get(id) ?? 0) === 0).sort(compareStrings);
  const ready = [...graph.entries];
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort(compareStrings);
    const v = ready.shift();
    if (v === undefined) break;
    order.push(v);
    for (const w of graph.succs.get(v) ?? []) {
      const d = (indegree.get(w) ?? 0) - 1;
      indegree.set(w, d);
      if (d === 0) ready.push(w);
    }
  }
  return order;
}

// ── guards ──────────────────────────────────────────────────────────────────

/** Whether an edge from `(src, port)` adds a literal (the port is one of several outcomes). */
function hasLiteral(src: NodeInfo, port: string): boolean {
  if (src.node.kind === "branch") return true;
  return src.exclusiveFamilies.some((family) => family.includes(port));
}

function edgeGuard(
  ctx: CompileContext,
  from: { node: string; port: string },
  exclusivity: Exclusivity,
): Guard {
  const src = ctx.node(from.node);
  const base = src?.guard ?? ALWAYS;
  if (!src || !hasLiteral(src, from.port)) return base;
  return and(base, [[{ node: from.node, port: from.port }]], exclusivity);
}

/** Required, in-scope producers of a node (their guards are conjoined into its own). */
function requiredProducers(ctx: CompileContext, info: NodeInfo): string[] {
  const out: string[] = [];
  for (const dep of info.dataIn) {
    if (dep.optional) continue;
    const producer = ctx.node(dep.from.node);
    if (!producer || producer.scope !== info.scope || ctx.dropped.has(producer.node.id)) continue;
    if (!out.includes(producer.node.id)) out.push(producer.node.id);
  }
  return out;
}

function computeGuards(ctx: CompileContext, graph: ScopeGraph, exclusivity: Exclusivity): void {
  for (const id of graph.order) {
    const info = ctx.node(id);
    if (!info) continue;
    if (info.node.kind === "input") {
      info.guard = ALWAYS;
      continue;
    }
    const controlGuard = groupControl(ctx, info, exclusivity);
    const producerGuards = requiredProducers(ctx, info).map((p) => ctx.node(p)?.guard ?? ALWAYS);
    info.guard = andAll([controlGuard, ...producerGuards], exclusivity);
  }
}

/** Partitions incoming edges into exclusive groups (OR within, AND across) and returns their guard. */
function groupControl(ctx: CompileContext, info: NodeInfo, exclusivity: Exclusivity): Guard {
  const edges = info.controlIn;
  info.groups = new Map();
  if (edges.length === 0) return ALWAYS;
  const guards = edges.map((e) => edgeGuard(ctx, e.from, exclusivity));
  // Union-find over the exclusivity relation.
  const parent = edges.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] ?? r;
    return r;
  };
  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      const gi = guards[i];
      const gj = guards[j];
      if (gi && gj && exclusive(gi, gj, exclusivity)) {
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
      }
    }
  }
  const groupOfRoot = new Map<number, number>();
  const members: number[][] = [];
  edges.forEach((edge, i) => {
    const root = find(i);
    let group = groupOfRoot.get(root);
    if (group === undefined) {
      group = members.length;
      groupOfRoot.set(root, group);
      members.push([]);
    }
    members[group]?.push(i);
    info.groups?.set(edge.id, group);
  });
  // A group must be a clique of pairwise exclusive edges; otherwise two members can co-fire.
  for (const group of members) {
    for (let a = 0; a < group.length; a += 1) {
      for (let b = a + 1; b < group.length; b += 1) {
        const ia = group[a] ?? 0;
        const ib = group[b] ?? 0;
        const ga = guards[ia];
        const gb = guards[ib];
        if (ga && gb && !exclusive(ga, gb, exclusivity)) {
          const ea = edges[ia];
          const eb = edges[ib];
          ctx.diagnostics.add(
            "E_CONTROL_AMBIGUOUS",
            `Edges '${ea?.id}' and '${eb?.id}' into '${info.node.id}' can both fire, but are grouped with edges that exclude each other; insert a join to say whether '${info.node.id}' waits for both`,
            { nodeId: info.node.id, edgeId: ea?.id, path: nodePath(info.index) },
            { related: eb ? [{ edgeId: eb.id, message: "can fire together with it" }] : [] },
          );
        }
      }
    }
  }
  if (members.length > 1) {
    ctx.diagnostics.add(
      "I_CONTROL_AND",
      `'${info.node.id}' waits for ${members.length} independent activations (one from each group of incoming edges)`,
      { nodeId: info.node.id, path: nodePath(info.index) },
    );
  }
  return andAll(
    members.map((group) =>
      orAll(
        group.map((i) => guards[i] ?? ALWAYS),
        exclusivity,
      ),
    ),
    exclusivity,
  );
}

/**
 * A required dependency is conditional when its producer may be pruned while everything else
 * that activates the consumer holds: bare use would silently prune the consumer.
 */
function checkConditionalDeps(
  ctx: CompileContext,
  scopes: Map<string, ScopeGraph>,
  exclusivity: Exclusivity,
): void {
  // Topological order, so a node whose own read was flagged does not flag its readers again.
  const flagged = new Set<string>();
  const ordered = [...scopes.values()]
    .flatMap((g) => g.order)
    .map((id) => ctx.node(id))
    .filter((n): n is NodeInfo => n !== undefined);
  for (const info of ordered) {
    // A join collects its inputs as null when their producers are pruned, by definition.
    if (info.guard === undefined || info.node.kind === "input" || info.node.kind === "join")
      continue;
    const hasControl = info.controlIn.length > 0;
    const inScope = info.dataIn.filter((d) => {
      const p = ctx.node(d.from.node);
      return (
        p !== undefined &&
        p.scope === info.scope &&
        d.via !== "hoisted" &&
        !ctx.dropped.has(p.node.id)
      );
    });
    // Values of the input node are always there; reading them establishes no activation path.
    const producers = sortedUnique(
      inScope
        .filter((d) => !d.optional && ctx.node(d.from.node)?.node.kind !== "input")
        .map((d) => d.from.node),
    );
    for (const dep of inScope) {
      const producer = ctx.node(dep.from.node);
      if (!producer?.guard || flagged.has(producer.node.id)) continue;
      const others = producers.filter((p) => p !== dep.from.node);
      // A node activated only by this producer simply inherits its condition.
      if (!dep.optional && !hasControl && others.length === 0) continue;
      const activation = andAll(
        [
          hasControl ? groupGuard(ctx, info, exclusivity) : ALWAYS,
          ...others.map((p) => ctx.node(p)?.guard ?? ALWAYS),
        ],
        exclusivity,
      );
      if (implies(activation, producer.guard)) continue;
      const where = {
        nodeId: info.node.id,
        path: dep.definitionPath,
        bindingPath: dep.bindingPath,
      };
      if (dep.optional) {
        ctx.diagnostics.add(
          "W_NULLABLE_INPUT",
          `'${dep.from.node}.${dep.from.port}' may not exist when '${info.node.id}' runs; its default is used then`,
          where,
        );
      } else {
        flagged.add(info.node.id);
        ctx.diagnostics.add(
          "E_CONDITIONAL_DATA_DEP",
          `'${info.node.id}' reads '${dep.from.node}.${dep.from.port}', which only exists on some paths; wrap it in coalesce(…) or give the reference a default`,
          where,
          {
            related: [
              { nodeId: dep.from.node, message: `runs only when ${describeGuard(producer.guard)}` },
            ],
          },
        );
      }
    }
  }
}

function groupGuard(ctx: CompileContext, info: NodeInfo, exclusivity: Exclusivity): Guard {
  const groups = new Map<number, Guard[]>();
  for (const edge of info.controlIn) {
    const g = info.groups?.get(edge.id) ?? 0;
    const list = groups.get(g) ?? [];
    list.push(edgeGuard(ctx, edge.from, exclusivity));
    groups.set(g, list);
  }
  return andAll(
    [...groups.values()].map((gs) => orAll(gs, exclusivity)),
    exclusivity,
  );
}

export function describeGuard(guard: Guard): string {
  if (guard.length === 0) return "never";
  if (guard.length === 1 && guard[0]?.length === 0) return "always";
  return guard.map((clause) => clause.map((l) => `${l.node}.${l.port}`).join(" and ")).join(" or ");
}

function checkOutputs(ctx: CompileContext, exclusivity: Exclusivity): void {
  const outputs = ctx.active().filter((n) => n.node.kind === "output" && n.scope === "" && n.guard);
  for (let i = 0; i < outputs.length; i += 1) {
    for (let j = i + 1; j < outputs.length; j += 1) {
      const a = outputs[i];
      const b = outputs[j];
      if (!a?.guard || !b?.guard) continue;
      if (a.node.kind === "output" && a.node.earlyExit) continue;
      if (!exclusive(a.guard, b.guard, exclusivity)) {
        ctx.diagnostics.add(
          "W_OUTPUT_AMBIGUOUS",
          `Outputs '${a.node.id}' and '${b.node.id}' can both complete in one run; the run output merges them in completion order`,
          { nodeId: b.node.id, path: nodePath(b.index) },
          { related: [{ nodeId: a.node.id, message: "can complete in the same run" }] },
        );
      }
    }
  }
}

// ── kind checks ─────────────────────────────────────────────────────────────

function literalComparison(
  ast: ExprAst,
): { ref: ExprAst; value: string | number | boolean | null } | null {
  if (ast.kind !== "binary" || ast.op !== "==") return null;
  if (ast.left.kind === "ref" && ast.right.kind === "literal")
    return { ref: ast.left, value: ast.right.value };
  if (ast.right.kind === "ref" && ast.left.kind === "literal")
    return { ref: ast.right, value: ast.left.value };
  return null;
}

function checkBranch(ctx: CompileContext, info: NodeInfo): void {
  const node = info.node;
  if (node.kind !== "branch") return;
  const seen = new Map<string, number>();
  node.cases.forEach((c, i) => {
    const compiled = info.compiled.get(`when/${i}`);
    if (!compiled || compiled.kind !== "expr") return;
    const where = { nodeId: node.id, path: nodePath(info.index, "cases", i, "when") };
    const printed = printAst(compiled.ast);
    const earlier = seen.get(printed);
    if (earlier !== undefined && node.mode === "first") {
      ctx.diagnostics.add(
        "W_BRANCH_SHADOWED",
        `Case '${c.port}' repeats case ${earlier} and never fires`,
        where,
      );
    }
    if (earlier === undefined) seen.set(printed, i);
    const cmp = literalComparison(compiled.ast);
    if (cmp && cmp.ref.kind === "ref") {
      const dep = info.dataIn.find(
        (d) =>
          d.to.port === c.port &&
          cmp.ref.kind === "ref" &&
          cmp.ref.ref.kind === "port" &&
          d.from.node === cmp.ref.ref.node,
      );
      const schema = dep?.sourceSchema;
      if (schema && Array.isArray(schema.enum) && !schema.enum.includes(cmp.value)) {
        ctx.diagnostics.add(
          "W_IMPOSSIBLE_BRANCH",
          `Case '${c.port}' compares with ${JSON.stringify(cmp.value)}, which is not one of ${JSON.stringify(schema.enum)}`,
          where,
        );
      }
    }
  });
}

function checkRouter(ctx: CompileContext, info: NodeInfo): void {
  if (info.node.kind !== "task") return;
  const routes = info.node.config.routes;
  const keys = Array.isArray(routes)
    ? routes.map(String)
    : isPlainObject(routes)
      ? Object.keys(routes)
      : [];
  const dep = info.dataIn.find((d) => d.to.port === "decision");
  const producer = dep ? ctx.node(dep.from.node) : undefined;
  if (!producer || producer.node.kind !== "task" || producer.manifest?.decision?.kind !== "choice")
    return;
  const options = producer.node.config.options;
  const available = isPlainObject(options) ? Object.keys(options) : [];
  for (const key of keys) {
    if (!available.includes(key)) {
      ctx.diagnostics.add(
        "W_UNREACHABLE_ROUTE",
        `Route '${key}' is not an option of '${producer.node.id}' (${available.join(", ")}) and never fires`,
        { nodeId: info.node.id, path: nodePath(info.index, "config", "routes"), port: key },
      );
    }
  }
}

function checkJoin(
  ctx: CompileContext,
  info: NodeInfo,
  graph: ScopeGraph,
): Record<string, string[]> | null {
  const node = info.node;
  if (node.kind !== "join") return null;
  const where = { nodeId: node.id, path: nodePath(info.index) };
  const n = info.controlIn.length;
  if (n === 0) {
    ctx.diagnostics.add(
      "E_JOIN_CONFIG",
      `Join '${node.id}' has no incoming edges to wait for`,
      where,
    );
    return null;
  }
  if (node.mode.type === "count" && node.mode.n > n) {
    ctx.diagnostics.add(
      "E_JOIN_CONFIG",
      `Join '${node.id}' waits for ${node.mode.n} arrivals but has only ${n} incoming edges`,
      where,
    );
  }
  if ((node.mode.type === "race" || node.mode.type === "any") && n < 2) {
    ctx.diagnostics.add(
      "E_JOIN_CONFIG",
      `A ${node.mode.type} join needs at least two incoming edges`,
      where,
    );
  }
  if (node.mode.type !== "race") return {};
  // Private subgraph of each input: ancestors of its source that feed nothing but that input.
  const ancestors = (start: string): Set<string> => {
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length > 0) {
      const v = queue.shift();
      if (v === undefined) break;
      for (const p of graph.preds.get(v) ?? []) {
        if (!seen.has(p) && ctx.node(p)?.node.kind !== "input") {
          seen.add(p);
          queue.push(p);
        }
      }
    }
    return seen;
  };
  const perEdge = info.controlIn.map((e) => ({ edge: e.id, anc: ancestors(e.from.node) }));
  const result: Record<string, string[]> = {};
  for (const { edge, anc } of perEdge) {
    const others = new Set(perEdge.filter((p) => p.edge !== edge).flatMap((p) => [...p.anc]));
    const set = new Set([...anc].filter((id) => !others.has(id)));
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of [...set]) {
        const escapes = [...(graph.succs.get(id) ?? [])].some((s) => s !== node.id && !set.has(s));
        if (escapes) {
          set.delete(id);
          changed = true;
        }
      }
    }
    result[edge] = [...set].sort(compareStrings);
  }
  return result;
}

function checkLoop(ctx: CompileContext, info: NodeInfo): void {
  const node = info.node;
  if (node.kind !== "loop") return;
  const where = (...rest: (string | number)[]) => ({
    nodeId: node.id,
    path: nodePath(info.index, ...rest),
  });
  if (node.exitWhen === undefined) {
    ctx.diagnostics.add(
      "W_LOOP_NO_EXIT",
      `Loop '${node.id}' has no exitWhen and always runs ${node.bounds.maxIterations} iterations`,
      where(),
    );
  }
  checkBounds(ctx, info);
  const carryProps = isPlainObject(node.carrySchema.properties) ? node.carrySchema.properties : {};
  for (const key of Object.keys(node.carry.next)) {
    const target = carryProps[key];
    const compiled = info.compiled.get(`next/${key}`);
    if (!target) {
      ctx.diagnostics.add(
        "E_CARRY_TYPE_MISMATCH",
        `carry.next.${key} is not a property of carrySchema`,
        where("carry", "next", key),
      );
      continue;
    }
    if (!compiled) continue;
    const fit = isSubschema(compiled.schema, target);
    if (!fit.ok) {
      ctx.diagnostics.add(
        "E_CARRY_TYPE_MISMATCH",
        `carry.next.${key} does not fit carrySchema: ${fit.reason}`,
        where("carry", "next", key),
      );
    }
  }
  for (const [key, value] of Object.entries(node.carry.initial)) {
    const target = carryProps[key];
    if (!target && node.carrySchema.additionalProperties === false) {
      ctx.diagnostics.add(
        "E_CARRY_TYPE_MISMATCH",
        `carry.initial.${key} is not a property of carrySchema`,
        where("carry", "initial", key),
      );
      continue;
    }
    if (!target) continue;
    const fit = isSubschema(literalOf(value), target);
    if (!fit.ok) {
      ctx.diagnostics.add(
        "E_CARRY_TYPE_MISMATCH",
        `carry.initial.${key} does not fit carrySchema: ${fit.reason}`,
        where("carry", "initial", key),
      );
    }
  }
}

function literalOf(value: unknown): JsonSchema {
  if (value === null) return { type: "null" };
  if (typeof value === "boolean") return { type: "boolean", const: value };
  if (typeof value === "string") return { type: "string", const: value };
  if (typeof value === "number")
    return { type: Number.isInteger(value) ? "integer" : "number", const: value };
  return {};
}

const AI_CAPABILITIES = new Set(["decision", "generation"]);

function checkBounds(ctx: CompileContext, info: NodeInfo): void {
  const node = info.node;
  if (node.kind !== "loop" && node.kind !== "foreach") return;
  const bounds = node.bounds;
  const body = ctx.bodies.get(node.id) ?? [];
  const spendsAi = body.some((id) =>
    ctx.node(id)?.manifest?.capabilities.some((c) => AI_CAPABILITIES.has(c)),
  );
  const loose =
    bounds.maxIterations > 1000 && bounds.timeoutMs === undefined
      ? `up to ${bounds.maxIterations} iterations with no timeout`
      : spendsAi && bounds.maxCostUsd === undefined && bounds.maxTokens === undefined
        ? "a body that calls AI models with no cost or token bound"
        : null;
  if (loose) {
    ctx.diagnostics.add(
      "W_LOOSE_BOUNDS",
      `'${node.id}' has ${loose}; add ${loose.startsWith("up to") ? "bounds.timeoutMs" : "bounds.maxCostUsd or bounds.maxTokens"}`,
      {
        nodeId: node.id,
        path: nodePath(info.index, "bounds"),
      },
    );
  }
}

function checkForeach(ctx: CompileContext, info: NodeInfo): void {
  const node = info.node;
  if (node.kind !== "foreach") return;
  checkBounds(ctx, info);
  const items = info.compiled.get("items");
  if (items && Object.keys(items.schema).length > 0) {
    const fit = isSubschema(items.schema, { type: "array" });
    if (!fit.ok) {
      ctx.diagnostics.add(
        "E_FOREACH_NOT_ARRAY",
        `foreach '${node.id}' iterates over a value that is not an array`,
        {
          nodeId: node.id,
          path: nodePath(info.index, "items"),
        },
      );
    }
  }
  if (!node.collect) {
    const consumer = ctx
      .active()
      .find((other) =>
        other.dataIn.some((d) => d.from.node === node.id && d.from.port === "results"),
      );
    if (consumer) {
      ctx.diagnostics.add(
        "E_FOREACH_COLLECT_MISSING",
        `'${consumer.node.id}' reads '${node.id}.results', but '${node.id}' has no collect binding`,
        { nodeId: node.id, path: nodePath(info.index) },
        { related: [{ nodeId: consumer.node.id, message: "reads results" }] },
      );
    }
  }
}

/** Unwired routing ports: a routed `failed` port, or a human outcome while its siblings are wired. */
function checkPorts(ctx: CompileContext, scopes: Map<string, ScopeGraph>): void {
  const wired = new Map<string, Set<string>>();
  for (const info of ctx.active()) {
    for (const edge of info.controlIn) {
      const set = wired.get(edge.from.node) ?? new Set<string>();
      set.add(edge.from.port);
      wired.set(edge.from.node, set);
    }
  }
  for (const graph of scopes.values()) {
    for (const id of graph.nodes) {
      const info = ctx.node(id);
      if (!info) continue;
      const ports = wired.get(id);
      const flagged = new Set<string>();
      if (info.controlOut.includes("failed") && !ports?.has("failed")) flagged.add("failed");
      if (info.node.kind === "human" && ports && ports.size > 0) {
        for (const p of info.controlOut) if (p !== "expired" && !ports.has(p)) flagged.add(p);
      }
      for (const port of flagged) {
        ctx.diagnostics.add(
          "W_CONTROL_PORT_UNCONNECTED",
          `'${id}' can fire '${port}', but nothing is connected to it; that path ends the branch`,
          { nodeId: id, port, path: nodePath(info.index) },
        );
      }
      const consumed = (ports?.size ?? 0) > 0 || ctx.readNodes.has(id);
      if (!consumed && info.node.kind === "task" && info.outputs.size > 0) {
        ctx.diagnostics.add("I_DANGLING_OUTPUT", `The result of '${id}' is not used by any node`, {
          nodeId: id,
          path: nodePath(info.index),
        });
      }
    }
  }
}
