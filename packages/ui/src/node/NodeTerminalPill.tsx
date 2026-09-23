import { forwardRef, type HTMLAttributes } from "react";
import { Flag, Play } from "lucide-react";
import { cn } from "@/lib/cn";
import { statusIsActive, statusLabel, statusTone, type StatusTone } from "@/primitives";
import { NodeDiagnosticsMarker } from "./NodeDiagnosticsMarker";
import { TypedHandle } from "./TypedHandle";
import type { NodeCardBaseProps } from "./NodeCard";
import { HANDLE_GAP, controlOutsFor, handleId, nodeStateAttributes } from "./nodeUtils";

export interface NodeTerminalPillProps
  extends NodeCardBaseProps, Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  kind: "start" | "end";
}

const DOT_CLASS: Record<StatusTone, string> = {
  queued: "bg-ink-4",
  running: "bg-info",
  waiting: "bg-cat-human",
  ok: "bg-ok",
  reused: "bg-ok",
  failed: "bg-danger",
  neutral: "bg-ink-4",
};

/** Top offset of the first stacked handle on a pill with more than one handle on a side. */
const PILL_HANDLE_TOP = 9;

/** Offsets for `count` handles on one side of a pill: centred when alone, else stacked from the top. */
function pillOffsets(count: number): Array<number | undefined> {
  if (count <= 1) return [undefined];
  return Array.from({ length: count }, (_, i) => PILL_HANDLE_TOP + i * HANDLE_GAP);
}

/**
 * Compact pill for the start and end of a workflow: icon, name and a status
 * dot once it has run. The start (`input` node) exposes its control-out
 * `ctl:done` and one `out:<port>` per workflow input on the right; the end
 * (`output` node) has the control-in notch and its `in:<port>` value on the
 * left. The pill grows when a side stacks more than one handle.
 */
export const NodeTerminalPill = forwardRef<HTMLDivElement, NodeTerminalPillProps>(
  function NodeTerminalPill(
    {
      node,
      run,
      kind,
      selected,
      hovered,
      dragging,
      disabled,
      compatibleHandles,
      className,
      style,
      ...rest
    },
    ref,
  ) {
    const Icon = kind === "start" ? Play : Flag;
    const compatible = compatibleHandles ? new Set(compatibleHandles) : undefined;
    const tone = run ? statusTone(run.status) : undefined;
    const diagnostics = node.diagnostics ?? [];
    const controls = kind === "start" ? controlOutsFor(node, "start") : [];
    const ports = kind === "start" ? node.outputs : node.inputs;
    const sideCount = kind === "start" ? controls.length + ports.length : ports.length;
    const offsets = pillOffsets(sideCount);
    const minHeight =
      sideCount > 2 ? PILL_HANDLE_TOP * 2 + (sideCount - 1) * HANDLE_GAP : undefined;
    return (
      <div
        ref={ref}
        className={cn(
          "fa-node inline-flex h-auto min-h-8 items-center gap-2 pl-2.5 pr-3",
          className,
        )}
        style={{ ...(minHeight !== undefined ? { minHeight } : null), ...style }}
        data-kind={kind}
        data-pill="true"
        {...nodeStateAttributes({ node, run, selected, hovered, dragging, disabled })}
        {...rest}
      >
        {kind === "end" ? (
          <TypedHandle
            kind="ctl-in"
            offset={20}
            category={node.category}
            compatible={compatible ? compatible.has(handleId("ctl-in")) : undefined}
          />
        ) : null}
        {controls.map((route, i) => (
          <TypedHandle
            key={route.id}
            kind="ctl"
            name={route.id}
            label={route.label}
            category={node.category}
            offset={offsets[i]}
            connected={run?.status === "completed"}
            compatible={compatible ? compatible.has(handleId("ctl", route.id)) : undefined}
          />
        ))}
        {ports.map((port, i) => {
          const handleKind = kind === "start" ? "out" : "in";
          return (
            <TypedHandle
              key={port.id}
              kind={handleKind}
              name={port.id}
              port={port}
              category={node.category}
              offset={offsets[kind === "start" ? controls.length + i : i]}
              compatible={compatible ? compatible.has(handleId(handleKind, port.id)) : undefined}
            />
          );
        })}
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            kind === "start" ? "fill-current text-ink" : "text-ink-2",
          )}
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <span className="text-sm font-semibold leading-none tracking-[-0.01em] text-ink">
          {node.name}
        </span>
        {diagnostics.length ? <NodeDiagnosticsMarker diagnostics={diagnostics} /> : null}
        {run && tone ? (
          <span
            aria-label={statusLabel(run.status)}
            role="img"
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              DOT_CLASS[tone],
              statusIsActive(run.status) && "fa-pulse",
            )}
          />
        ) : null}
        {(disabled ?? node.disabled) ? (
          <span className="font-mono text-2xs uppercase leading-none text-ink-3">off</span>
        ) : null}
      </div>
    );
  },
);
