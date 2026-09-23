import {
  forwardRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { NodeResizer, useNodeId } from "@xyflow/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { categoryVar } from "@/lib/categories";
import { Badge, CategoryDot, Hint } from "@/primitives";
import type { ControlPortView, IterationProgress, IterationView } from "@/types";
import { iterationCount, loopBoundsMeta } from "./LoopNodeCard";
import type { NodeCardBaseProps } from "./NodeCard";
import { NodeDiagnosticsMarker } from "./NodeDiagnosticsMarker";
import { TypedHandle } from "./TypedHandle";
import {
  controlOutsFor,
  handleId,
  handleOffset,
  nodeStateAttributes,
  nodeTypeLabel,
} from "./nodeUtils";

/** Height of the frame header; children are laid out below it. */
export const CONTAINER_HEADER_HEIGHT = 40;
/** Inner padding between the frame border and its children. */
export const CONTAINER_PADDING = 24;
export const CONTAINER_MIN_WIDTH = 280;
export const CONTAINER_MIN_HEIGHT = 140;
/** Size of a frame with no stored `layout.nodes[id].w/h` and no children to fit. */
export const CONTAINER_DEFAULT_WIDTH = 480;
export const CONTAINER_DEFAULT_HEIGHT = 240;

/** Class of the frame header; the canvas uses it as the frame's drag handle so the body stays free for its children. */
export const CONTAINER_DRAG_HANDLE_CLASS = "fa-frame-drag";

export interface ContainerFrameProps
  extends NodeCardBaseProps, Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Folded loop / foreach progress; defaults to `run.progress`. */
  progress?: IterationProgress;
  /** Overrides the badge's current iteration (1-based). */
  iteration?: number;
  /** Iteration (0-based index) the stepper shows; uncontrolled (latest iteration) when omitted. */
  selectedIteration?: number;
  /** Called when the stepper moves; the inspector shows that iteration's values. */
  onSelectIteration?: (nodeId: string, iteration: IterationView) => void;
  /** Control-outs on the right edge (defaults to `node.routes`, else `done`). */
  controls?: ControlPortView[];
  /** Frame size outside React Flow (inside, the xyflow node's `width`/`height` size it). */
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  /** Standalone preview content drawn in the frame body (on the canvas, children are separate xyflow nodes). */
  children?: ReactNode;
}

function IterationStepper({
  nodeId,
  iterations,
  selected,
  onSelect,
}: {
  nodeId: string;
  iterations: IterationView[];
  selected: number;
  onSelect: (iteration: IterationView) => void;
}) {
  const position = Math.max(
    0,
    iterations.findIndex((it) => it.index === selected),
  );
  const current = iterations[position];
  const prev = iterations[position - 1];
  const next = iterations[position + 1];
  if (!current) return null;
  return (
    <div
      role="group"
      aria-label="Iteration shown in the inspector"
      className="nodrag nopan inline-flex shrink-0 items-center rounded-sm border border-border bg-surface font-mono text-2xs tabular text-ink-2"
      data-stepper={nodeId}
    >
      <button
        type="button"
        className="inline-flex size-5 items-center justify-center rounded-l-sm text-ink-3 hover:bg-surface-2 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        aria-label="Previous iteration"
        disabled={!prev}
        onClick={() => prev && onSelect(prev)}
      >
        <ChevronLeft className="size-3" strokeWidth={1.75} aria-hidden="true" />
      </button>
      <Hint
        hint={current.scope}
        className="min-w-9 px-1 text-center leading-5"
        aria-live="polite"
        data-iteration-index={current.index}
        data-iteration-status={current.status}
      >
        #{current.index + 1}
      </Hint>
      <button
        type="button"
        className="inline-flex size-5 items-center justify-center rounded-r-sm text-ink-3 hover:bg-surface-2 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        aria-label="Next iteration"
        disabled={!next}
        onClick={() => next && onSelect(next)}
      >
        <ChevronRight className="size-3" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * The group node of a loop or foreach (UI.md §4.2): a frame its body nodes sit in (they carry
 * `parentId` + `extent: 'parent'`), with a header showing the category dot, name, kind, the
 * bounds (`loopBoundsMeta`), the iteration badge during a run (`3/10`, folded from
 * `LOOP_ITERATION_*` / `FOREACH_ITEM_COMPLETED`) and a stepper that picks the iteration the
 * inspector shows. Inside React Flow a `NodeResizer` appears while the frame is selected; its
 * dimension changes flow through `onNodesChange` into `layout.nodes[id].w/h`.
 */
export const ContainerFrame = forwardRef<HTMLDivElement, ContainerFrameProps>(
  function ContainerFrame(
    {
      node,
      run,
      selected = false,
      hovered = false,
      dragging = false,
      disabled = node.disabled ?? false,
      compatibleHandles,
      handleReasons,
      progress: progressProp,
      iteration,
      selectedIteration,
      onSelectIteration,
      controls: controlsProp,
      width,
      height,
      minWidth = CONTAINER_MIN_WIDTH,
      minHeight = CONTAINER_MIN_HEIGHT,
      children,
      className,
      style,
      ...rest
    },
    ref,
  ) {
    const flowNodeId = useNodeId();
    const progress = progressProp ?? run?.progress;
    const count = iterationCount(node, run, iteration, progress);
    const kind = nodeTypeLabel(node);
    const bounds = loopBoundsMeta(node.bounds);
    const diagnostics = node.diagnostics ?? [];
    const compatible = compatibleHandles ? new Set(compatibleHandles) : undefined;
    const controls = controlsProp ?? controlOutsFor(node, "container");
    const iterations = progress?.iterations ?? [];
    const latest = iterations.at(-1)?.index ?? 0;
    const [ownSelection, setOwnSelection] = useState<number | undefined>(undefined);
    const shownIteration = selectedIteration ?? ownSelection ?? latest;
    const selectIteration = (it: IterationView) => {
      setOwnSelection(it.index);
      onSelectIteration?.(node.id, it);
    };
    const exhausted =
      progress?.exitReason === "max_iterations" ||
      (run?.status === "failed" && count?.total !== undefined && count.current >= count.total);

    const frameStyle: CSSProperties = {
      ...(flowNodeId === null
        ? { width: width ?? CONTAINER_DEFAULT_WIDTH, height: height ?? CONTAINER_DEFAULT_HEIGHT }
        : null),
      ...{ "--fa-frame-c": categoryVar(node.category) },
      ...style,
    };

    return (
      <div
        ref={ref}
        className={cn("fa-frame", className)}
        data-kind={kind}
        {...nodeStateAttributes({ node, run, selected, hovered, dragging, disabled })}
        style={frameStyle}
        {...rest}
      >
        {flowNodeId !== null ? (
          <NodeResizer
            isVisible={selected && !disabled}
            minWidth={minWidth}
            minHeight={minHeight}
            lineClassName="fa-frame-resize-line"
            handleClassName="fa-frame-resize-handle"
          />
        ) : null}
        <TypedHandle
          kind="ctl-in"
          category={node.category}
          compatible={compatible ? compatible.has(handleId("ctl-in")) : undefined}
          reason={handleReasons?.[handleId("ctl-in")]}
        />
        {node.inputs.map((port, i) => {
          const id = handleId("in", port.id);
          return (
            <TypedHandle
              key={id}
              kind="in"
              name={port.id}
              port={port}
              category={node.category}
              offset={handleOffset(i)}
              compatible={compatible ? compatible.has(id) : undefined}
              reason={handleReasons?.[id]}
            />
          );
        })}
        {controls.map((route, i) => {
          const id = handleId("ctl", route.id);
          return (
            <TypedHandle
              key={id}
              kind="ctl"
              name={route.id}
              label={route.label}
              category={node.category}
              offset={handleOffset(i)}
              connected={run?.routeTaken === route.id || (route.id === "exhausted" && exhausted)}
              compatible={compatible ? compatible.has(id) : undefined}
              reason={handleReasons?.[id]}
            />
          );
        })}
        {node.outputs.map((port, i) => {
          const id = handleId("out", port.id);
          return (
            <TypedHandle
              key={id}
              kind="out"
              name={port.id}
              port={port}
              category={node.category}
              offset={handleOffset(controls.length + i)}
              compatible={compatible ? compatible.has(id) : undefined}
              reason={handleReasons?.[id]}
            />
          );
        })}

        <div
          className={cn(
            "fa-frame-header flex items-center gap-2 px-2.5",
            CONTAINER_DRAG_HANDLE_CLASS,
          )}
          style={{ height: CONTAINER_HEADER_HEIGHT }}
        >
          <CategoryDot category={node.category} />
          <Hint
            hint={node.name}
            announce={false}
            className="min-w-0 truncate text-sm font-semibold leading-[14px] tracking-[-0.01em] text-ink"
          >
            {node.name}
          </Hint>
          <span className="shrink-0 font-mono text-2xs leading-none tracking-[0.02em] text-ink-3">
            {kind}
          </span>
          {bounds.length ? (
            <span className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden font-mono text-2xs text-ink-3 tabular">
              {bounds.map((m) => (
                <span key={m.label} className="inline-flex items-baseline gap-1 whitespace-nowrap">
                  <span className="text-ink-3">{m.label}</span>
                  <span>{m.value}</span>
                </span>
              ))}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          {diagnostics.length ? <NodeDiagnosticsMarker diagnostics={diagnostics} /> : null}
          {disabled ? (
            <Badge tone="outline" size="sm" mono className="uppercase">
              off
            </Badge>
          ) : null}
          {count ? (
            <Badge
              tone={exhausted ? "danger" : run?.status === "running" ? "accent" : "neutral"}
              size="md"
              mono
              aria-label={count.description}
              data-iteration-badge={count.label}
            >
              {count.label}
            </Badge>
          ) : null}
          {iterations.length > 0 ? (
            <IterationStepper
              nodeId={node.id}
              iterations={iterations}
              selected={shownIteration}
              onSelect={selectIteration}
            />
          ) : null}
        </div>
        <div className="fa-frame-body">{children}</div>
      </div>
    );
  },
);
