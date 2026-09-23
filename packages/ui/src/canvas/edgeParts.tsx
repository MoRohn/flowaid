import type { CSSProperties, ReactNode } from "react";
import { EdgeLabelRenderer, Position } from "@xyflow/react";
import { cn } from "@/lib/cn";
import type { CanvasEdgeState } from "./types";

const ARROW_ROTATION: Record<Position, number> = {
  [Position.Top]: 0,
  [Position.Left]: -90,
  [Position.Right]: 90,
  [Position.Bottom]: 180,
};

/**
 * Filled arrowhead whose tip sits on the target handle, pointing into the
 * node from the side the edge arrives at (`targetPosition`).
 */
export function EdgeArrow({
  x,
  y,
  position,
  color,
  opacity = 1,
}: {
  x: number;
  y: number;
  position: Position;
  color: string;
  opacity?: number;
}) {
  return (
    <path
      className="fa-edge-arrow"
      d="M0 0 L-4 -7 L4 -7 Z"
      transform={`translate(${x} ${y}) rotate(${ARROW_ROTATION[position]})`}
      fill={color}
      opacity={opacity}
      aria-hidden="true"
    />
  );
}

/**
 * Mono label chip centred on an edge (route name, condition or probability). It is a
 * `role="note"` named "route <label>", so assistive tech announces what the chip annotates
 * instead of a bare word floating over the canvas.
 */
export function EdgeLabelChip({
  x,
  y,
  state,
  selected,
  style,
  label,
  children,
}: {
  x: number;
  y: number;
  state: CanvasEdgeState;
  selected?: boolean;
  style?: CSSProperties;
  /** The route the edge carries; the chip's accessible name is "route <label>". */
  label: string;
  /** Visible content; defaults to `label`. */
  children?: ReactNode;
}) {
  return (
    <EdgeLabelRenderer>
      <span
        role="note"
        aria-label={`route ${label}`}
        className={cn(
          "fa-edge-label nodrag nopan pointer-events-auto absolute inline-flex h-[18px] items-center rounded-xs border bg-surface px-1.5 font-mono text-2xs leading-none tabular shadow-1",
          "transition-[color,border-color,opacity] duration-(--dur-base) ease-(--ease-out)",
          state === "idle" && "border-border text-ink-3",
          state === "not-taken" && "border-border text-ink-3 opacity-70",
          state === "active" && "border-accent text-accent-text",
          state === "taken" && "border-border text-ink",
          state === "reused" && "border-ok border-dashed text-ok-text",
          state === "error" && "border-danger text-danger-text",
          selected && "border-accent text-accent-text",
        )}
        style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`, ...style }}
        data-state={state}
      >
        {children ?? label}
      </span>
    </EdgeLabelRenderer>
  );
}
