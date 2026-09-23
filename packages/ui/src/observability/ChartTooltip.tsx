import {
  forwardRef,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

export type TooltipSwatch = "line" | "rect" | "dot" | "none";

export interface ChartTooltipRow {
  id: string;
  label: ReactNode;
  /** Pre-formatted value; rendered in mono, leading the row. */
  value: ReactNode;
  color?: string;
  swatch?: TooltipSwatch;
  /** De-emphasise (hidden series, zero values). */
  muted?: boolean;
}

export interface ChartTooltipProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Pointer / anchor position in the container's coordinate space. */
  x: number;
  y: number;
  /** Size of the container the tooltip must stay inside. */
  bounds: { width: number; height: number };
  title?: ReactNode;
  rows: ChartTooltipRow[];
  /** Footer line (a total, a hint). */
  footer?: ReactNode;
  /** Distance from the anchor point. */
  offset?: number;
  /** Prefer a side; flips automatically when it would overflow. */
  side?: "right" | "left" | "top" | "bottom";
}

/**
 * Shared hover readout for every chart. Positioned absolutely inside the
 * chart's relative container and kept within its bounds: it prefers the
 * requested side and flips when there is no room. Values lead each row in
 * mono; the series is keyed by a short line/rect swatch in its colour.
 */
export const ChartTooltip = forwardRef<HTMLDivElement, ChartTooltipProps>(function ChartTooltip(
  { x, y, bounds, title, rows, footer, offset = 12, side = "right", className, style, ...rest },
  ref,
) {
  const inner = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
  });

  const pos = placeTooltip({ x, y, bounds, size, offset, side });

  return (
    <div
      ref={(node) => {
        inner.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      role="presentation"
      className={cn(
        "pointer-events-none absolute z-20 min-w-32 max-w-64 rounded-md border border-border bg-surface px-2.5 py-2 text-xs text-ink shadow-2",
        size.width === 0 && "invisible",
        className,
      )}
      style={{ left: pos.left, top: pos.top, ...style }}
      {...rest}
    >
      {title ? (
        <div className="mb-1.5 truncate font-mono text-2xs text-ink-3 tabular">{title}</div>
      ) : null}
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.id} className={cn("flex items-center gap-2", row.muted && "opacity-50")}>
            <Swatch kind={row.swatch ?? "line"} color={row.color} />
            <span className="min-w-0 flex-1 truncate text-ink-2">{row.label}</span>
            <span className="shrink-0 font-mono text-xs font-medium text-ink tabular">
              {row.value}
            </span>
          </li>
        ))}
      </ul>
      {footer ? (
        <div className="mt-1.5 border-t border-border pt-1.5 text-2xs text-ink-3">{footer}</div>
      ) : null}
    </div>
  );
});

function Swatch({ kind, color }: { kind: TooltipSwatch; color?: string }) {
  if (kind === "none") return null;
  const bg = color ?? "var(--ink-3)";
  if (kind === "dot") {
    return (
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: bg }}
      />
    );
  }
  if (kind === "rect") {
    return (
      <span
        aria-hidden="true"
        className="h-2.5 w-2 shrink-0 rounded-[2px]"
        style={{ backgroundColor: bg }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="h-0.5 w-3 shrink-0 rounded-full"
      style={{ backgroundColor: bg }}
    />
  );
}

export interface PlaceTooltipInput {
  x: number;
  y: number;
  bounds: { width: number; height: number };
  size: { width: number; height: number };
  offset: number;
  side: "right" | "left" | "top" | "bottom";
}

/** Pure placement: prefers `side`, flips on overflow, clamps to bounds. */
export function placeTooltip({ x, y, bounds, size, offset, side }: PlaceTooltipInput): {
  left: number;
  top: number;
} {
  let left: number;
  let top: number;
  const fitsRight = x + offset + size.width <= bounds.width;
  const fitsLeft = x - offset - size.width >= 0;
  const fitsBelow = y + offset + size.height <= bounds.height;
  const fitsAbove = y - offset - size.height >= 0;

  if (side === "right" || side === "left") {
    const goRight = side === "right" ? fitsRight || !fitsLeft : !fitsLeft;
    left = goRight ? x + offset : x - offset - size.width;
    top = y - size.height / 2;
  } else {
    const goBelow = side === "bottom" ? fitsBelow || !fitsAbove : !fitsAbove;
    top = goBelow ? y + offset : y - offset - size.height;
    left = x - size.width / 2;
  }
  left = Math.max(0, Math.min(left, Math.max(0, bounds.width - size.width)));
  top = Math.max(0, Math.min(top, Math.max(0, bounds.height - size.height)));
  return { left, top };
}
