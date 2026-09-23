/** Pure geometry used by the selection toolbar and weighted edges. */
import type { CanvasPoint } from "./types";

export interface Box extends CanvasPoint {
  width: number;
  height: number;
}

export interface BoxedNode extends Box {
  id: string;
}

export type AlignKind = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type DistributeAxis = "horizontal" | "vertical";

export function boundsOf(boxes: Box[]): Box {
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let x1 = Number.POSITIVE_INFINITY;
  let y1 = Number.POSITIVE_INFINITY;
  let x2 = Number.NEGATIVE_INFINITY;
  let y2 = Number.NEGATIVE_INFINITY;
  for (const b of boxes) {
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.width);
    y2 = Math.max(y2, b.y + b.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** New positions that align every node on one edge or axis of the selection bounds. */
export function alignNodes(nodes: BoxedNode[], kind: AlignKind): Map<string, CanvasPoint> {
  const b = boundsOf(nodes);
  const out = new Map<string, CanvasPoint>();
  for (const n of nodes) {
    let { x, y } = n;
    switch (kind) {
      case "left":
        x = b.x;
        break;
      case "center":
        x = b.x + b.width / 2 - n.width / 2;
        break;
      case "right":
        x = b.x + b.width - n.width;
        break;
      case "top":
        y = b.y;
        break;
      case "middle":
        y = b.y + b.height / 2 - n.height / 2;
        break;
      case "bottom":
        y = b.y + b.height - n.height;
        break;
    }
    out.set(n.id, { x: Math.round(x), y: Math.round(y) });
  }
  return out;
}

/**
 * New positions that spread nodes evenly along one axis: the first and last
 * stay put and the gaps between neighbours become equal.
 */
export function distributeNodes(
  nodes: BoxedNode[],
  axis: DistributeAxis,
): Map<string, CanvasPoint> {
  const out = new Map<string, CanvasPoint>();
  if (nodes.length < 3) {
    for (const n of nodes) out.set(n.id, { x: n.x, y: n.y });
    return out;
  }
  const horizontal = axis === "horizontal";
  const sorted = [...nodes].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return out;
  const span = horizontal ? last.x + last.width - first.x : last.y + last.height - first.y;
  const total = sorted.reduce((s, n) => s + (horizontal ? n.width : n.height), 0);
  const gap = (span - total) / (sorted.length - 1);
  let cursor = horizontal ? first.x : first.y;
  for (const n of sorted) {
    if (horizontal) {
      out.set(n.id, { x: Math.round(cursor), y: n.y });
      cursor += n.width + gap;
    } else {
      out.set(n.id, { x: n.x, y: Math.round(cursor) });
      cursor += n.height + gap;
    }
  }
  return out;
}

/**
 * Stroke opacity and width for a probability, following the mark's weights:
 * p = 1 → opacity 1.0, p ≈ 0.3 → 0.42, p = 0 → 0.18. Width runs 1 → 2.5 px.
 */
export function probabilityToStroke(p: number | undefined): { opacity: number; width: number } {
  if (p === undefined || !Number.isFinite(p)) return { opacity: 1, width: 1.5 };
  const c = Math.min(1, Math.max(0, p));
  return {
    opacity: Math.round((0.18 + 0.82 * c) * 100) / 100,
    width: Math.round((1 + 1.5 * c) * 100) / 100,
  };
}
