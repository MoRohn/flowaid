/**
 * Internal axis and grid primitives shared by the SVG charts. Gridlines and
 * axes are recessive: solid 1px hairlines in the border token, tick labels in
 * mono ink-3. Nothing here is exported from the package.
 */
import type { ReactNode } from "react";

export interface PlotMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const AXIS_FONT = "font-mono text-2xs tabular";

/** Left gutter wide enough for the widest tick label (≈6.6px per mono glyph at 11px). */
export function measureGutter(labels: readonly string[], min = 24): number {
  const widest = labels.reduce((m, l) => Math.max(m, l.length), 0);
  return Math.max(min, Math.ceil(widest * 6.6) + 8);
}

export function GridLines({
  ticks,
  scale,
  x0,
  x1,
  hideZero = false,
}: {
  ticks: readonly number[];
  scale: (v: number) => number;
  x0: number;
  x1: number;
  hideZero?: boolean;
}) {
  return (
    <g aria-hidden="true">
      {ticks.map((t) => {
        const y = scale(t);
        return (
          <line
            key={t}
            x1={x0}
            x2={x1}
            y1={y}
            y2={y}
            stroke={t === 0 && !hideZero ? "var(--border-strong)" : "var(--border)"}
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
        );
      })}
    </g>
  );
}

export function YAxis({
  ticks,
  scale,
  x,
  format,
}: {
  ticks: readonly number[];
  scale: (v: number) => number;
  x: number;
  format: (v: number) => string;
}) {
  return (
    <g aria-hidden="true" className={AXIS_FONT} fill="var(--ink-3)">
      {ticks.map((t) => (
        <text key={t} x={x} y={scale(t)} dy="0.32em" textAnchor="end">
          {format(t)}
        </text>
      ))}
    </g>
  );
}

export function XAxis({
  ticks,
  scale,
  y,
  format,
  anchor = "middle",
  baseline,
}: {
  ticks: readonly number[];
  scale: (v: number) => number;
  y: number;
  format: (v: number) => string;
  anchor?: "middle" | "start" | "end";
  /** Draw the baseline rule across [x0, x1]. */
  baseline?: { x0: number; x1: number; y: number };
}) {
  return (
    <g aria-hidden="true" className={AXIS_FONT} fill="var(--ink-3)">
      {baseline ? (
        <line
          x1={baseline.x0}
          x2={baseline.x1}
          y1={baseline.y}
          y2={baseline.y}
          stroke="var(--border-strong)"
          strokeWidth={1}
          shapeRendering="crispEdges"
        />
      ) : null}
      {ticks.map((t, i) => (
        <text key={`${t}-${i}`} x={scale(t)} y={y} textAnchor={anchor}>
          {format(t)}
        </text>
      ))}
    </g>
  );
}

/** Thin outline path for a bar with a 4px rounded data-end and a square base. */
export function roundedBarPath(
  x: number,
  y: number,
  width: number,
  height: number,
  orientation: "vertical" | "horizontal" = "vertical",
  radius = 4,
): string {
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  if (w === 0 || h === 0) return "";
  if (orientation === "vertical") {
    const r = Math.min(radius, w / 2, h);
    return [
      `M${x},${y + h}`,
      `V${y + r}`,
      `Q${x},${y} ${x + r},${y}`,
      `H${x + w - r}`,
      `Q${x + w},${y} ${x + w},${y + r}`,
      `V${y + h}`,
      "Z",
    ].join("");
  }
  const r = Math.min(radius, h / 2, w);
  return [
    `M${x},${y}`,
    `H${x + w - r}`,
    `Q${x + w},${y} ${x + w},${y + r}`,
    `V${y + h - r}`,
    `Q${x + w},${y + h} ${x + w - r},${y + h}`,
    `H${x}`,
    "Z",
  ].join("");
}

/** Visually hidden table so every chart has a text twin for assistive tech. */
export function SrTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: readonly string[];
  rows: ReadonlyArray<ReadonlyArray<ReactNode>>;
}) {
  // The wrapper carries sr-only: a table box ignores a 1px width, so clipping it
  // directly would still widen the page on narrow screens.
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
