import { forwardRef, useMemo, useState, type HTMLAttributes, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { SrTable } from "./axes";
import { ChartTooltip } from "./ChartTooltip";
import { formatUnitValue, heatRamp, heatRampColor, type ChartUnit } from "./chartMath";

export interface HeatmapProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Row labels (weekdays). */
  rows: readonly string[];
  /** Column labels (hours). */
  columns: readonly string[];
  /** `values[row][column]`. */
  values: ReadonlyArray<readonly number[]>;
  width: number;
  /** Cell height in px; width follows the container. */
  cellHeight?: number;
  unit?: ChartUnit;
  /** Ramp steps; more steps means a smoother ramp and a longer legend. */
  steps?: number;
  /** Show every n-th column label. */
  columnLabelEvery?: number;
  /** Small ramp legend under the grid. */
  showScale?: boolean;
  /** Describe a cell for the tooltip title, e.g. (row, col) => "Tue 14:00". */
  formatCell?: (row: string, column: string) => string;
  label?: string;
}

/**
 * Magnitude grid (runs by hour and weekday). Ink-alpha sequential ramp (a light
 * graphite wash up to near-solid ink), quantised into steps so neighbouring cells read as
 * bands; empty cells sit on surface-3. The grid is one focusable widget:
 * arrow keys move the active cell and the tooltip follows.
 */
export const Heatmap = forwardRef<HTMLDivElement, HeatmapProps>(function Heatmap(
  {
    rows,
    columns,
    values,
    width,
    cellHeight = 18,
    unit = "count",
    steps = 6,
    columnLabelEvery = 3,
    showScale = true,
    formatCell,
    label,
    className,
    ...rest
  },
  ref,
) {
  const [active, setActive] = useState<[number, number] | null>(null);
  const rowGutter = 32;
  const gap = 2;
  const nCols = Math.max(1, columns.length);
  const nRows = Math.max(1, rows.length);
  const gridW = Math.max(0, width - rowGutter);
  const cellW = Math.max(4, (gridW - gap * (nCols - 1)) / nCols);
  const headerH = 16;
  const height = headerH + nRows * (cellHeight + gap) - gap;
  const max = useMemo(
    () => values.reduce((m, r) => Math.max(m, ...r.map((v) => (Number.isFinite(v) ? v : 0))), 0),
    [values],
  );

  const cellX = (c: number) => rowGutter + c * (cellW + gap);
  const cellY = (r: number) => headerH + r * (cellHeight + gap);
  const describe = formatCell ?? ((r: string, c: string) => `${r} ${c}`);

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const [r, c] = active ?? [0, 0];
    let next: [number, number] | null = [r, c];
    if (e.key === "ArrowLeft") next = [r, Math.max(0, c - 1)];
    else if (e.key === "ArrowRight") next = [r, Math.min(nCols - 1, c + 1)];
    else if (e.key === "ArrowUp") next = [Math.max(0, r - 1), c];
    else if (e.key === "ArrowDown") next = [Math.min(nRows - 1, r + 1), c];
    else if (e.key === "Home") next = [r, 0];
    else if (e.key === "End") next = [r, nCols - 1];
    else if (e.key === "Escape") next = null;
    else return;
    e.preventDefault();
    setActive(next);
  };

  const activeValue = active ? (values[active[0]]?.[active[1]] ?? 0) : 0;

  return (
    <div
      ref={ref}
      className={cn("relative flex flex-col gap-2", className)}
      style={{ width }}
      {...rest}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label ?? `${rows.length} by ${columns.length} heatmap`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((a) => a ?? [0, 0])}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        className="block overflow-visible rounded-sm outline-none focus-visible:shadow-(--focus)"
      >
        <g aria-hidden="true" className="font-mono text-2xs tabular" fill="var(--ink-3)">
          {columns.map((c, i) =>
            i % columnLabelEvery === 0 ? (
              <text key={c} x={cellX(i)} y={10} textAnchor="start">
                {c}
              </text>
            ) : null,
          )}
          {rows.map((r, i) => (
            <text
              key={r}
              x={rowGutter - 8}
              y={cellY(i) + cellHeight / 2}
              dy="0.32em"
              textAnchor="end"
            >
              {r}
            </text>
          ))}
        </g>
        {rows.map((r, ri) =>
          columns.map((c, ci) => {
            const v = values[ri]?.[ci] ?? 0;
            const stop = heatRamp(v, max, steps);
            const isActive = active?.[0] === ri && active?.[1] === ci;
            return (
              <rect
                key={`${r}-${c}`}
                x={cellX(ci)}
                y={cellY(ri)}
                width={cellW}
                height={cellHeight}
                rx={2}
                fill={stop.color}
                stroke={isActive ? "var(--ink)" : "none"}
                strokeWidth={1.5}
                onPointerEnter={() => setActive([ri, ci])}
                className="transition-[fill] duration-(--dur-fast)"
              />
            );
          }),
        )}
      </svg>
      {showScale ? (
        <div
          className="flex items-center gap-2 self-end font-mono text-2xs text-ink-3 tabular"
          aria-hidden="true"
        >
          <span>0</span>
          <span className="flex gap-0.5">
            <span
              className="h-2.5 w-3 rounded-[2px]"
              style={{ backgroundColor: "var(--surface-3)" }}
            />
            {Array.from({ length: steps }, (_, i) => (
              <span
                key={i}
                className="h-2.5 w-3 rounded-[2px]"
                style={{ backgroundColor: heatRampColor((i + 1) / steps) }}
              />
            ))}
          </span>
          <span>{formatUnitValue(max, unit)}</span>
        </div>
      ) : null}
      {active ? (
        <ChartTooltip
          x={cellX(active[1]) + cellW / 2}
          y={cellY(active[0]) + cellHeight / 2}
          bounds={{ width, height }}
          side="top"
          title={describe(rows[active[0]] ?? "", columns[active[1]] ?? "")}
          rows={[
            {
              id: "v",
              label: unit === "count" ? "Runs" : "Value",
              value: formatUnitValue(activeValue, unit),
              color: heatRamp(activeValue, max, steps).color,
              swatch: "rect",
            },
          ]}
        />
      ) : null}
      <SrTable
        caption={label ?? "Heatmap values"}
        head={["Row", ...columns]}
        rows={rows.map((r, ri) => [
          r,
          ...columns.map((_, ci) => formatUnitValue(values[ri]?.[ci] ?? 0, unit)),
        ])}
      />
    </div>
  );
});
