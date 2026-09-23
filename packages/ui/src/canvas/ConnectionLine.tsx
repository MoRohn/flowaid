import { getBezierPath, Position, type ConnectionLineComponentProps } from "@xyflow/react";
import { cn } from "@/lib/cn";

export type ConnectionLineStatus = "valid" | "invalid" | null;

export interface ConnectionLinePathProps {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  fromPosition?: Position;
  toPosition?: Position;
  status: ConnectionLineStatus;
  className?: string;
}

function statusColor(status: ConnectionLineStatus): string {
  if (status === "valid") return "var(--ok)";
  if (status === "invalid") return "var(--danger)";
  return "var(--accent)";
}

/**
 * The drawn part of the connection line, usable outside React Flow (previews,
 * tests). Dashed bezier with a dot at the pointer that turns green when the
 * hovered port is compatible and red when it is not.
 */
export function ConnectionLinePath({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition = Position.Right,
  toPosition = Position.Left,
  status,
  className,
}: ConnectionLinePathProps) {
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    targetX: toX,
    targetY: toY,
    sourcePosition: fromPosition,
    targetPosition: toPosition,
    curvature: 0.3,
  });
  const color = statusColor(status);
  return (
    <g className={cn("fa-connection-line", className)} data-status={status ?? "pending"}>
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray={status === "invalid" ? "2 3" : "6 4"}
        strokeLinecap="round"
        style={{ transition: "stroke var(--dur-fast) var(--ease-out)" }}
      />
      <circle cx={toX} cy={toY} r={4} fill="var(--surface)" stroke={color} strokeWidth={1.5} />
      {status === "invalid" ? (
        <g stroke={color} strokeWidth={1.25} strokeLinecap="round">
          <line x1={toX - 1.8} y1={toY - 1.8} x2={toX + 1.8} y2={toY + 1.8} />
          <line x1={toX + 1.8} y1={toY - 1.8} x2={toX - 1.8} y2={toY + 1.8} />
        </g>
      ) : null}
    </g>
  );
}

/** React Flow `connectionLineComponent`: colours by `isValidConnection`. */
export function ConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  connectionStatus,
}: ConnectionLineComponentProps) {
  return (
    <ConnectionLinePath
      fromX={fromX}
      fromY={fromY}
      toX={toX}
      toY={toY}
      fromPosition={fromPosition}
      toPosition={toPosition}
      status={connectionStatus}
    />
  );
}
