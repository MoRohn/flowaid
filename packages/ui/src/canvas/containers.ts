/**
 * Container (loop/foreach frame) geometry for the canvas: which frame a
 * dropped node lands in, how its position changes when it moves between
 * frames, and how xyflow node changes map onto `definition.layout`
 * (UI.md §4.1 `moveNodes` / `setParent`, §4.2 projection). Pure functions.
 */
import type { Node, NodeChange } from "@xyflow/react";
import { CONTAINER_HEADER_HEIGHT } from "@/node";
import type { CanvasLayout, CanvasPoint, ParentDrop } from "./types";

/** An axis-aligned box in absolute flow coordinates. */
export interface FlowBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A dragged node at its drop position, with the container it currently belongs to. */
export interface DroppedBox extends FlowBox {
  parent?: string;
}

/** `value` within [min, max]; `min` wins when the range is empty (a node larger than its frame). */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/** Depth of `id` in the container tree (0 at the top level); a parent cycle stops the walk. */
export function containerDepth(id: string, parentOf: (id: string) => string | undefined): number {
  let depth = 0;
  const seen = new Set<string>([id]);
  let cursor = parentOf(id);
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor);
    depth += 1;
    cursor = parentOf(cursor);
  }
  return depth;
}

/** Whether `id` sits (at any depth) inside the container `ancestor`. */
export function isInside(
  id: string,
  ancestor: string,
  parentOf: (id: string) => string | undefined,
): boolean {
  const seen = new Set<string>([id]);
  let cursor = parentOf(id);
  while (cursor !== undefined && !seen.has(cursor)) {
    if (cursor === ancestor) return true;
    seen.add(cursor);
    cursor = parentOf(cursor);
  }
  return false;
}

/**
 * The innermost frame containing `point`: the deepest in the container tree, then the
 * smallest. Frames in `exclude` (the dragged nodes and everything inside them) never match.
 */
export function frameAt(
  point: CanvasPoint,
  frames: readonly FlowBox[],
  parentOf: (id: string) => string | undefined,
  exclude: ReadonlySet<string> = new Set(),
): FlowBox | undefined {
  let best: { frame: FlowBox; depth: number; area: number } | undefined;
  for (const f of frames) {
    if (exclude.has(f.id)) continue;
    if (point.x < f.x || point.x > f.x + f.width || point.y < f.y || point.y > f.y + f.height)
      continue;
    const depth = containerDepth(f.id, parentOf);
    const area = f.width * f.height;
    if (!best || depth > best.depth || (depth === best.depth && area < best.area))
      best = { frame: f, depth, area };
  }
  return best?.frame;
}

/**
 * Where a drag ends up (UI.md §4.2 "node dropped into a container frame"): each dropped node
 * whose centre now lies in a different frame (or outside every frame) changes parent. A frame
 * is never dropped into itself or into a frame inside it, and frames that move with the drag
 * are not targets. Returns one entry per new parent with each node's position relative to it
 * (absolute when leaving every frame), in the order the nodes were given. A node entering a
 * frame is kept inside it, below the header (`top`), as `extent: 'parent'` will hold it there.
 */
export function planParentDrops(
  dropped: readonly DroppedBox[],
  frames: readonly FlowBox[],
  parentOf: (id: string) => string | undefined,
  { top = CONTAINER_HEADER_HEIGHT }: { top?: number } = {},
): ParentDrop[] {
  const moving = new Set(dropped.map((d) => d.id));
  const exclude = new Set<string>(moving);
  for (const f of frames) {
    for (const id of moving) if (isInside(f.id, id, parentOf)) exclude.add(f.id);
  }
  const byParent = new Map<string | undefined, ParentDrop>();
  for (const d of dropped) {
    // A node dragged together with its own container keeps its parent.
    if (d.parent !== undefined && moving.has(d.parent)) continue;
    const centre = { x: d.x + d.width / 2, y: d.y + d.height / 2 };
    const target = frameAt(centre, frames, parentOf, exclude);
    const parent = target?.id;
    if (parent === d.parent) continue;
    const position = target
      ? {
          x: clamp(d.x - target.x, 0, target.width - d.width),
          y: clamp(d.y - target.y, top, target.height - d.height),
        }
      : { x: d.x, y: d.y };
    const entry = byParent.get(parent);
    if (entry) {
      entry.ids.push(d.id);
      entry.positions[d.id] = position;
    } else {
      byParent.set(parent, { parent, ids: [d.id], positions: { [d.id]: position } });
    }
  }
  return [...byParent.values()];
}

/**
 * Applies xyflow node changes to a workflow `layout` (layout-only, not recorded in undo
 * history): a `position` change moves `layout.nodes[id].x/y`, a `NodeResizer` change
 * (`dimensions` with `setAttributes`) sets `w`/`h`, and `remove` drops the entry. Measured
 * dimensions, selection and other changes leave the layout alone. Returns the same object
 * when nothing changed.
 */
export function applyLayoutChanges<N extends Node>(
  layout: CanvasLayout,
  changes: readonly NodeChange<N>[],
): CanvasLayout {
  let nodes: CanvasLayout["nodes"] | undefined;
  const write = (): CanvasLayout["nodes"] => {
    nodes ??= { ...layout.nodes };
    return nodes;
  };
  for (const change of changes) {
    if (change.type === "position" && change.position) {
      const current = (nodes ?? layout.nodes)[change.id];
      const { x, y } = change.position;
      if (current && current.x === x && current.y === y) continue;
      write()[change.id] = { ...current, x, y };
    } else if (change.type === "dimensions" && change.setAttributes && change.dimensions) {
      const current = (nodes ?? layout.nodes)[change.id] ?? { x: 0, y: 0 };
      const { width, height } = change.dimensions;
      const next = { ...current };
      if (change.setAttributes !== "height") next.w = width;
      if (change.setAttributes !== "width") next.h = height;
      if (next.w === current.w && next.h === current.h && change.id in (nodes ?? layout.nodes))
        continue;
      write()[change.id] = next;
    } else if (change.type === "remove") {
      if (!(change.id in (nodes ?? layout.nodes))) continue;
      const { [change.id]: _removed, ...rest } = write();
      nodes = rest;
    }
  }
  return nodes ? { ...layout, nodes } : layout;
}
