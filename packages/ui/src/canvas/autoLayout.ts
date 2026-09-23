/**
 * Layered left-to-right layout with no external dependencies.
 *
 * 1. Back edges (found by DFS) are ignored so cycles do not break layering.
 * 2. Longest-path layering: a node's layer is one past its deepest predecessor.
 * 3. Barycenter ordering: nodes in each layer are sorted by the mean order of
 *    their neighbours in the adjacent layer, sweeping down and up a few times
 *    to reduce crossings.
 * 4. Coordinates: layers are stacked left to right with `layerGap` between the
 *    widest node of one layer and the next; nodes in a layer are stacked with
 *    `nodeGap` and each layer is centred on the mean centre of its predecessors.
 *
 * Compound graphs (loop/foreach bodies, UI.md §4.2): nodes with a `parent` are
 * laid out inside their container first, innermost frames first, using only
 * the edges between nodes of that container (an edge into or out of a nested
 * frame counts as an edge of the frame). Each container is then sized to fit
 * its children (`framePadding` around them, `frameHeader` above) and laid out
 * as one box at its own level. Child positions are relative to their
 * container's top-left, which is how xyflow positions nodes with `parentId`.
 */
import {
  CONTAINER_HEADER_HEIGHT,
  CONTAINER_MIN_HEIGHT,
  CONTAINER_MIN_WIDTH,
  CONTAINER_PADDING,
  cardVariantFor,
  nodeTypeLabel,
} from "@/node";
import type { WorkflowNodeView } from "@/types";
import type { CanvasPoint } from "./types";

export interface LayoutNodeInput {
  id: string;
  width?: number;
  height?: number;
  /** React Flow fills this after the first render. */
  measured?: { width?: number; height?: number };
  /** Container (loop/foreach) the node sits in; its position is returned relative to that frame. */
  parent?: string;
  /** Container ids may be passed as `parentId` (xyflow's name) instead of `parent`. */
  parentId?: string;
}

export interface LayoutEdgeInput {
  source: string;
  target: string;
}

export interface AutoLayoutOptions {
  /** Vertical gap between nodes in the same layer. */
  nodeGap?: number;
  /** Horizontal gap between layers. */
  layerGap?: number;
  /** Fallback size when a node has not been measured. */
  defaultWidth?: number;
  defaultHeight?: number;
  /** Origin of the whole layout. */
  origin?: CanvasPoint;
  /** Space between a frame's border and its children (default `CONTAINER_PADDING`). */
  framePadding?: number;
  /** Height of a frame's header, above its children (default `CONTAINER_HEADER_HEIGHT`). */
  frameHeader?: number;
  /** Smallest frame a container is sized to (default `CONTAINER_MIN_WIDTH` × `CONTAINER_MIN_HEIGHT`). */
  minFrameWidth?: number;
  minFrameHeight?: number;
}

export interface AutoLayoutResult {
  /** Top-left per node: absolute for top-level nodes, relative to the frame for nodes with a parent. */
  positions: Map<string, CanvasPoint>;
  /** Size of every container that has children, fitted around them (`layout.nodes[id].w/h`). */
  sizes: Map<string, { width: number; height: number }>;
  /** Top-level node ids grouped by layer, in final order. */
  layers: string[][];
  /** Edges that were ignored to break cycles (endpoints lifted to the level they were laid out at). */
  backEdges: LayoutEdgeInput[];
}

function sizeOf(n: LayoutNodeInput, dw: number, dh: number): { w: number; h: number } {
  return {
    w: n.measured?.width ?? n.width ?? dw,
    h: n.measured?.height ?? n.height ?? dh,
  };
}

/** Finds edges that close a cycle (DFS back edges) so they can be ignored. */
export function findBackEdges(nodeIds: string[], edges: LayoutEdgeInput[]): LayoutEdgeInput[] {
  const out = new Map<string, LayoutEdgeInput[]>();
  for (const id of nodeIds) out.set(id, []);
  for (const e of edges) {
    if (!out.has(e.source) || !out.has(e.target)) continue;
    out.get(e.source)?.push(e);
  }
  const state = new Map<string, 0 | 1 | 2>();
  const back: LayoutEdgeInput[] = [];
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of out.get(id) ?? []) {
      const s = state.get(e.target) ?? 0;
      if (s === 1) back.push(e);
      else if (s === 0) visit(e.target);
    }
    state.set(id, 2);
  };
  for (const id of nodeIds) if ((state.get(id) ?? 0) === 0) visit(id);
  return back;
}

interface FlatLayoutOptions {
  nodeGap: number;
  layerGap: number;
  defaultWidth: number;
  defaultHeight: number;
  origin: CanvasPoint;
}

interface FlatLayoutResult {
  positions: Map<string, CanvasPoint>;
  layers: string[][];
  backEdges: LayoutEdgeInput[];
}

function parentOf(n: LayoutNodeInput): string | undefined {
  return n.parent ?? n.parentId;
}

/**
 * Lays out a compound graph: every container's children inside it (innermost first), then
 * each level with the containers as fitted boxes. See the module comment.
 */
export function autoLayout(
  nodes: LayoutNodeInput[],
  edges: LayoutEdgeInput[],
  options: AutoLayoutOptions = {},
): AutoLayoutResult {
  const {
    nodeGap = 40,
    layerGap = 96,
    defaultWidth = 232,
    defaultHeight = 96,
    origin = { x: 0, y: 0 },
    framePadding = CONTAINER_PADDING,
    frameHeader = CONTAINER_HEADER_HEIGHT,
    minFrameWidth = CONTAINER_MIN_WIDTH,
    minFrameHeight = CONTAINER_MIN_HEIGHT,
  } = options;
  const flat = { nodeGap, layerGap, defaultWidth, defaultHeight };
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // The level each node is laid out at: its parent when that parent is in the graph and the
  // parent chain does not loop back to the node; the top level otherwise.
  const levelOf = new Map<string, string | undefined>();
  for (const n of nodes) {
    let parent = parentOf(n);
    const seen = new Set<string>([n.id]);
    let cursor = parent;
    while (cursor !== undefined) {
      if (seen.has(cursor) || !byId.has(cursor)) {
        parent = undefined;
        break;
      }
      seen.add(cursor);
      const next = byId.get(cursor);
      cursor = next ? parentOf(next) : undefined;
    }
    levelOf.set(n.id, parent);
  }
  const childrenOf = new Map<string | undefined, LayoutNodeInput[]>();
  for (const n of nodes) {
    const level = levelOf.get(n.id);
    const list = childrenOf.get(level);
    if (list) list.push(n);
    else childrenOf.set(level, [n]);
  }

  /** The ancestor of `id` (or `id` itself) laid out directly at `level`, if any. */
  const representativeAt = (id: string, level: string | undefined): string | undefined => {
    let cursor: string | undefined = id;
    const seen = new Set<string>();
    while (cursor !== undefined && !seen.has(cursor)) {
      seen.add(cursor);
      const up = levelOf.get(cursor);
      if (!byId.has(cursor)) return undefined;
      if (up === level) return cursor;
      cursor = up;
    }
    return undefined;
  };

  const positions = new Map<string, CanvasPoint>();
  const sizes = new Map<string, { width: number; height: number }>();
  const backEdges: LayoutEdgeInput[] = [];
  let rootLayers: string[][] = [];

  const layoutLevel = (
    level: string | undefined,
    levelOrigin: CanvasPoint,
  ): { width: number; height: number } => {
    const members = childrenOf.get(level) ?? [];
    // Size nested frames first so this level sees them as boxes.
    const boxes: LayoutNodeInput[] = members.map((m) => {
      if (!childrenOf.has(m.id)) return m;
      const content = layoutLevel(m.id, { x: framePadding, y: frameHeader + framePadding });
      const size = {
        width: Math.max(minFrameWidth, content.width + 2 * framePadding),
        height: Math.max(minFrameHeight, frameHeader + content.height + 2 * framePadding),
      };
      sizes.set(m.id, size);
      return { id: m.id, width: size.width, height: size.height };
    });
    const lifted: LayoutEdgeInput[] = [];
    const seenPairs = new Set<string>();
    for (const e of edges) {
      const source = representativeAt(e.source, level);
      const target = representativeAt(e.target, level);
      if (source === undefined || target === undefined || source === target) continue;
      const key = `${source}\u0000${target}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      lifted.push(source === e.source && target === e.target ? e : { source, target });
    }
    const result = layoutFlat(boxes, lifted, { ...flat, origin: levelOrigin });
    backEdges.push(...result.backEdges);
    if (level === undefined) rootLayers = result.layers;
    let right = levelOrigin.x;
    let bottom = levelOrigin.y;
    for (const b of boxes) {
      const p = result.positions.get(b.id);
      if (!p) continue;
      positions.set(b.id, p);
      const sz = sizeOf(b, defaultWidth, defaultHeight);
      right = Math.max(right, p.x + sz.w);
      bottom = Math.max(bottom, p.y + sz.h);
    }
    return { width: right - levelOrigin.x, height: bottom - levelOrigin.y };
  };

  layoutLevel(undefined, origin);
  return { positions, sizes, layers: rootLayers, backEdges };
}

/** The flat layered layout of one level (the algorithm in the module comment, steps 1–4). */
function layoutFlat(
  nodes: LayoutNodeInput[],
  edges: LayoutEdgeInput[],
  options: FlatLayoutOptions,
): FlatLayoutResult {
  const { nodeGap, layerGap, defaultWidth, defaultHeight, origin } = options;

  const ids = nodes.map((n) => n.id);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const backEdges = findBackEdges(ids, edges);
  const backSet = new Set(backEdges);
  const forward = edges.filter(
    (e) => !backSet.has(e) && byId.has(e.source) && byId.has(e.target) && e.source !== e.target,
  );

  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const id of ids) {
    preds.set(id, []);
    succs.set(id, []);
  }
  for (const e of forward) {
    preds.get(e.target)?.push(e.source);
    succs.get(e.source)?.push(e.target);
  }

  // Longest-path layering (memoised DFS over the acyclic forward graph).
  const layerOf = new Map<string, number>();
  const layerFor = (id: string): number => {
    const cached = layerOf.get(id);
    if (cached !== undefined) return cached;
    layerOf.set(id, 0);
    let l = 0;
    for (const p of preds.get(id) ?? []) l = Math.max(l, layerFor(p) + 1);
    layerOf.set(id, l);
    return l;
  };
  for (const id of ids) layerFor(id);

  const layerCount = ids.length === 0 ? 0 : Math.max(...ids.map((id) => layerOf.get(id) ?? 0)) + 1;
  const layers: string[][] = Array.from({ length: layerCount }, () => []);
  for (const id of ids) layers[layerOf.get(id) ?? 0]?.push(id);

  // Barycenter ordering.
  const order = new Map<string, number>();
  const reindex = () => {
    for (const layer of layers) layer.forEach((id, i) => order.set(id, i));
  };
  reindex();
  const bary = (id: string, neighbours: string[]): number => {
    if (neighbours.length === 0) return order.get(id) ?? 0;
    return neighbours.reduce((s, n) => s + (order.get(n) ?? 0), 0) / neighbours.length;
  };
  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0;
    const seq = down ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const layer of seq) {
      const keyed = layer.map((id) => ({
        id,
        b: bary(id, down ? (preds.get(id) ?? []) : (succs.get(id) ?? [])),
        i: order.get(id) ?? 0,
      }));
      keyed.sort((a, b) => a.b - b.b || a.i - b.i);
      layer.splice(0, layer.length, ...keyed.map((k) => k.id));
      reindex();
    }
  }

  // Coordinates.
  const positions = new Map<string, CanvasPoint>();
  const centres = new Map<string, number>();
  let x = origin.x;
  for (const layer of layers) {
    const sizes = layer.map((id) => {
      const n = byId.get(id);
      return n ? sizeOf(n, defaultWidth, defaultHeight) : { w: defaultWidth, h: defaultHeight };
    });
    const layerWidth = Math.max(0, ...sizes.map((s) => s.w));
    const stackHeight =
      sizes.reduce((s, sz) => s + sz.h, 0) + Math.max(0, layer.length - 1) * nodeGap;

    // Centre this layer on the mean centre of its predecessors (or the origin).
    const predCentres: number[] = [];
    for (const id of layer)
      for (const p of preds.get(id) ?? []) {
        const c = centres.get(p);
        if (c !== undefined) predCentres.push(c);
      }
    const target =
      predCentres.length > 0
        ? predCentres.reduce((a, b) => a + b, 0) / predCentres.length
        : origin.y + stackHeight / 2;
    let y = target - stackHeight / 2;
    layer.forEach((id, i) => {
      const sz = sizes[i] ?? { w: defaultWidth, h: defaultHeight };
      positions.set(id, { x, y });
      centres.set(id, y + sz.h / 2);
      y += sz.h + nodeGap;
    });
    x += layerWidth + layerGap;
  }

  // Normalise so the top-most node sits at origin.y.
  let minY = Number.POSITIVE_INFINITY;
  for (const p of positions.values()) minY = Math.min(minY, p.y);
  if (Number.isFinite(minY) && minY !== origin.y) {
    const dy = origin.y - minY;
    for (const [id, p] of positions) positions.set(id, { x: p.x, y: p.y + dy });
  }

  return { positions, layers, backEdges };
}

/**
 * Approximate rendered height of a node card before React Flow has measured
 * it, so first layouts leave room for tall cards. `reserveDistribution` adds
 * space for a decision node's inline distribution.
 */
export function estimateNodeHeight(node: WorkflowNodeView, reserveDistribution = false): number {
  const variant = cardVariantFor(node);
  if (variant === "start" || variant === "end") return 32;
  if (variant === "container") return CONTAINER_MIN_HEIGHT;
  if (variant === "note") return 20 + Math.ceil((node.description?.length ?? 0) / 36) * 17;
  const kind = nodeTypeLabel(node);
  let h = 10 + 20; // top padding + header
  if (node.description) h += 20;
  if (node.meta && node.meta.length > 0) h += 22;
  const routes = node.routes?.length ?? 0;
  if (routes > 0) h += 8 + routes * 22;
  else if (variant === "gate") h += 8 + 3 * 22;
  if (node.category === "decision" && reserveDistribution) {
    h += 8 + (kind === "boolean" ? 2 : 4) * 18;
  }
  if (node.category === "human") h += 20;
  // Right edge: control-outs (`done` when no routes) stacked above the data-outs.
  const stacked = Math.max(node.inputs.length, routes > 0 ? 0 : node.outputs.length + 1);
  h = Math.max(h, 10 + stacked * 14 + 10);
  h += 30; // footer
  return h;
}

/**
 * Convenience: returns a copy of `nodes` with `position` set from `autoLayout` (relative to
 * the frame for nodes with a parent) and each fitted container's `width`/`height`.
 */
export function applyAutoLayout<T extends LayoutNodeInput & { position: CanvasPoint }>(
  nodes: T[],
  edges: LayoutEdgeInput[],
  options?: AutoLayoutOptions,
): T[] {
  const { positions, sizes } = autoLayout(nodes, edges, options);
  return nodes.map((n) => {
    const p = positions.get(n.id);
    const size = sizes.get(n.id);
    if (!p && !size) return n;
    return {
      ...n,
      ...(p ? { position: p } : null),
      ...(size ? { width: size.width, height: size.height } : null),
    };
  });
}
