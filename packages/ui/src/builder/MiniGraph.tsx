import { forwardRef, useId, useMemo, type SVGAttributes } from "react";
import { cn } from "@/lib/cn";
import { CATEGORY_LABEL, categoryVar, type NodeCategory } from "@/lib/categories";

/** Minimal node shape the MiniGraph needs; a WorkflowNodeView satisfies it. */
export interface MiniGraphNode {
  id: string;
  category: NodeCategory;
  name?: string;
}

/** Minimal edge shape; a WorkflowEdgeView satisfies it. */
export interface MiniGraphEdge {
  source: string;
  target: string;
}

export interface MiniGraphLayoutOptions {
  width?: number;
  height?: number;
  /** Inset from the box edge to the node centres. */
  padding?: number;
}

export interface MiniGraphPosition {
  id: string;
  x: number;
  y: number;
  /** Zero-based column (topological rank). */
  column: number;
  /** Zero-based row within the column. */
  row: number;
}

export interface MiniGraphLayout {
  width: number;
  height: number;
  positions: MiniGraphPosition[];
  columns: number;
  rows: number;
}

/**
 * Deterministic left-to-right layered layout for tiny previews. Nodes are
 * ranked by longest path from a source (cycles are broken in input order),
 * spread evenly across the box, and rows are centred within each column.
 * Every node in `nodes` receives a position, including ones no edge touches.
 */
export function layoutMiniGraph(
  nodes: readonly MiniGraphNode[],
  edges: readonly MiniGraphEdge[],
  { width = 200, height = 80, padding = 10 }: MiniGraphLayoutOptions = {},
): MiniGraphLayout {
  const ids = nodes.map((n) => n.id);
  const known = new Set(ids);
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const id of ids) {
    incoming.set(id, []);
    outgoing.set(id, []);
  }
  for (const e of edges) {
    if (!known.has(e.source) || !known.has(e.target) || e.source === e.target) continue;
    outgoing.get(e.source)?.push(e.target);
    incoming.get(e.target)?.push(e.source);
  }

  // Longest-path ranking over a DFS topological order; back edges are ignored
  // so a cycle cannot spin forever or inflate ranks.
  const order: string[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    if (state.has(id)) return;
    state.set(id, 1);
    for (const next of outgoing.get(id) ?? []) visit(next);
    state.set(id, 2);
    order.push(id);
  };
  for (const id of ids) visit(id);
  order.reverse();
  const index = new Map(order.map((id, i) => [id, i]));
  const rank = new Map<string, number>();
  for (const id of order) {
    const r = rank.get(id) ?? 0;
    rank.set(id, r);
    for (const next of outgoing.get(id) ?? []) {
      if ((index.get(next) ?? 0) <= (index.get(id) ?? 0)) continue;
      rank.set(next, Math.max(rank.get(next) ?? 0, r + 1));
    }
  }

  const byColumn = new Map<number, string[]>();
  for (const id of ids) {
    const c = rank.get(id) ?? 0;
    const list = byColumn.get(c) ?? [];
    list.push(id);
    byColumn.set(c, list);
  }
  const columns = byColumn.size === 0 ? 0 : Math.max(...byColumn.keys()) + 1;
  const rows =
    byColumn.size === 0 ? 0 : Math.max(...Array.from(byColumn.values(), (l) => l.length));

  const innerW = Math.max(0, width - padding * 2);
  const innerH = Math.max(0, height - padding * 2);
  const positions: MiniGraphPosition[] = [];
  for (const [column, list] of byColumn) {
    const x = columns <= 1 ? width / 2 : padding + (innerW * column) / (columns - 1);
    list.forEach((id, row) => {
      const y = list.length <= 1 ? height / 2 : padding + (innerH * row) / (list.length - 1);
      positions.push({ id, x, y, column, row });
    });
  }
  positions.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  return { width, height, positions, columns, rows };
}

export interface MiniGraphProps extends Omit<SVGAttributes<SVGSVGElement>, "width" | "height"> {
  nodes: readonly MiniGraphNode[];
  edges: readonly MiniGraphEdge[];
  width?: number;
  height?: number;
  /** Node radius in px. */
  nodeRadius?: number;
  /** Accessible description; defaults to a node count. */
  label?: string;
  /** Highlighted node ids (drawn with a ring). */
  highlight?: readonly string[];
}

/**
 * Tiny SVG workflow preview: nodes as category-coloured dots, edges as soft
 * curves. Auto-laid out with `layoutMiniGraph` into a 200 by 80 box by
 * default, so it fits a table cell or a template card.
 */
export const MiniGraph = forwardRef<SVGSVGElement, MiniGraphProps>(function MiniGraph(
  { nodes, edges, width = 200, height = 80, nodeRadius = 4, label, highlight, className, ...rest },
  ref,
) {
  const titleId = useId();
  const layout = useMemo(
    () => layoutMiniGraph(nodes, edges, { width, height, padding: nodeRadius + 6 }),
    [nodes, edges, width, height, nodeRadius],
  );
  const pos = new Map(layout.positions.map((p) => [p.id, p]));
  const cat = new Map(nodes.map((n) => [n.id, n.category]));
  const ring = new Set(highlight ?? []);

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-labelledby={titleId}
      className={cn("block max-w-full shrink-0 overflow-visible", className)}
      {...rest}
    >
      <title id={titleId}>
        {label ?? `Workflow preview: ${nodes.length} nodes, ${edges.length} edges`}
      </title>
      <g fill="none" stroke="var(--border-strong)" strokeWidth={1} strokeLinecap="round">
        {edges.map((e, i) => {
          const a = pos.get(e.source);
          const b = pos.get(e.target);
          if (!a || !b) return null;
          const dx = Math.max(12, Math.abs(b.x - a.x) * 0.5);
          const d = `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
          return <path key={`${e.source}-${e.target}-${i}`} d={d} />;
        })}
      </g>
      <g>
        {layout.positions.map((p) => {
          const category = cat.get(p.id) ?? "flow";
          const node = nodes.find((n) => n.id === p.id);
          return (
            <g key={p.id} data-node-id={p.id}>
              {ring.has(p.id) ? (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={nodeRadius + 3}
                  fill="none"
                  stroke={categoryVar(category)}
                  strokeOpacity={0.35}
                  strokeWidth={1.5}
                />
              ) : null}
              <circle
                cx={p.x}
                cy={p.y}
                r={nodeRadius}
                fill={categoryVar(category)}
                stroke="var(--surface)"
                strokeWidth={1.5}
              >
                <title>
                  {node?.name
                    ? `${node.name} · ${CATEGORY_LABEL[category]}`
                    : CATEGORY_LABEL[category]}
                </title>
              </circle>
            </g>
          );
        })}
      </g>
    </svg>
  );
});
