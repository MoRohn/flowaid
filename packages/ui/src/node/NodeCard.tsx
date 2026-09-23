import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import {
  Badge,
  CategoryDot,
  Hint,
  statusIsActive,
  statusLabel,
  statusTone,
  Tooltip,
  type StatusTone,
} from "@/primitives";
import type { ControlPortView, NodeRunView, WorkflowNodeView } from "@/types";
import { NodeDiagnosticsMarker } from "./NodeDiagnosticsMarker";
import { TypedHandle } from "./TypedHandle";
import {
  controlOutsFor,
  handleId,
  handleOffset,
  nodeStateAttributes,
  nodeTypeLabel,
} from "./nodeUtils";

export interface NodeMetaItem {
  label: string;
  value: string;
  tone?: "default" | "accent" | "danger";
}

/** Interaction flags every node renderer accepts (the canvas passes them from xyflow). */
export interface NodeCardStateProps {
  selected?: boolean;
  hovered?: boolean;
  dragging?: boolean;
  /** Node is switched off in the workflow; the card fades and shows an "off" badge. */
  disabled?: boolean;
  /** Handle ids (`in:<port>`, `ctl-in`, …) to light up as compatible drop targets while a connection drags. */
  compatibleHandles?: ReadonlyArray<string>;
  /** Why the other handles reject the dragged connection, by handle id (shown in their labels). */
  handleReasons?: Readonly<Record<string, string>>;
}

/** Props shared by every kind-specific card. */
export interface NodeCardBaseProps extends NodeCardStateProps {
  node: WorkflowNodeView;
  run?: NodeRunView;
  className?: string;
}

export interface NodeCardProps
  extends NodeCardBaseProps, Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Mono label at the right of the header. Defaults to the last segment of `node.nodeType`, else the kind. */
  kindLabel?: string;
  /** Overrides `node.description`; `null` hides the line. */
  description?: ReactNode;
  /** Overrides `node.meta`; `null` hides the row. */
  meta?: NodeMetaItem[] | null;
  /** Body content between the description and the meta row. */
  children?: ReactNode;
  bodyClassName?: string;
  /** Replaces the whole footer; `null` hides it. */
  footer?: ReactNode;
  /** Replaces the left part of the default footer (status · provider). */
  footerLeft?: ReactNode;
  /** Replaces the right part of the default footer (duration). */
  footerRight?: ReactNode;
  /**
   * Which handles the card draws itself: `auto` draws the control-in notch, data-ins on the left,
   * control-outs on the right with data-outs below them; `inputs` only the control-in and data-ins
   * (route cards draw their exits in `NodeRouteList`); `none` nothing.
   */
  handles?: "auto" | "inputs" | "none";
  /** Control-outs drawn by `auto` (defaults to `node.routes`, else `done`). */
  controls?: ControlPortView[];
  /** Draw the control-in notch (default true; the workflow input has none). */
  controlIn?: boolean;
  /** Extra header content placed before the kind label. */
  headerExtra?: ReactNode;
  /** Compact pill shape for terminal nodes. */
  pill?: boolean;
  /** Overrides `node.provider` in the footer; `null` hides it. */
  provider?: string | null;
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

/** Short status label that fits a 232px footer ("Retrying" instead of "Retry wait"). */
export function compactStatusLabel(status: NodeRunView["status"]): string {
  return status === "retry_wait" ? "Retrying" : statusLabel(status);
}

/** Status dot + label used in node footers. */
export function NodeStatusText({ run, className }: { run: NodeRunView; className?: string }) {
  const tone = statusTone(run.status);
  // The visible label is the compact form ("Retrying" for retry_wait); the tooltip names
  // the full status for pointer users.
  return (
    <Hint
      hint={statusLabel(run.status)}
      announce={false}
      className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap", className)}
      data-status={run.status}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          DOT_CLASS[tone],
          statusIsActive(run.status) && "fa-pulse",
        )}
      />
      <span>
        {compactStatusLabel(run.status)}
        {run.attempt > 1 ? ` ×${run.attempt}` : ""}
      </span>
    </Hint>
  );
}

/**
 * The base 232px node card: category dot, name and mono kind in the header,
 * a one-line purpose, an optional body, a mono meta row and a footer with the
 * run status and duration. Interaction and run state change the outline only.
 */
export const NodeCard = forwardRef<HTMLDivElement, NodeCardProps>(function NodeCard(
  {
    node,
    run,
    selected = false,
    hovered = false,
    dragging = false,
    disabled = node.disabled ?? false,
    compatibleHandles,
    handleReasons,
    kindLabel,
    description,
    meta,
    children,
    bodyClassName,
    footer,
    footerLeft,
    footerRight,
    handles = "auto",
    controls: controlsProp,
    controlIn = true,
    headerExtra,
    pill = false,
    provider: providerProp,
    className,
    ...rest
  },
  ref,
) {
  const kind = kindLabel ?? nodeTypeLabel(node);
  const desc = description === undefined ? node.description : description;
  const metaItems: NodeMetaItem[] = meta === undefined ? (node.meta ?? []) : (meta ?? []);
  const diagnostics = node.diagnostics ?? [];
  const compatible = compatibleHandles ? new Set(compatibleHandles) : undefined;
  const controls = controlsProp ?? controlOutsFor(node, "default");
  const provider = providerProp === undefined ? node.provider : (providerProp ?? undefined);
  const duration = run?.durationMs;

  const defaultFooter =
    run || provider ? (
      <div className="flex items-center gap-2 border-t border-border px-2.5 py-2 font-mono text-2xs text-ink-3 tabular">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {footerLeft ?? (
            <>
              {run ? <NodeStatusText run={run} /> : null}
              {provider ? (
                <Hint
                  hint={provider}
                  announce={false}
                  className={cn("min-w-0 truncate", run ? "text-ink-3" : "text-ink-3")}
                >
                  {run ? "· " : ""}
                  {provider}
                </Hint>
              ) : null}
            </>
          )}
        </div>
        <div className="shrink-0 text-right">
          {footerRight ?? (duration !== undefined ? formatMs(duration) : null)}
        </div>
      </div>
    ) : null;

  return (
    <div
      ref={ref}
      className={cn("fa-node group/node", className)}
      data-kind={kind}
      {...nodeStateAttributes({ node, run, selected, hovered, dragging, disabled })}
      data-pill={pill ? "true" : undefined}
      {...rest}
    >
      {handles !== "none" && controlIn ? (
        <TypedHandle
          kind="ctl-in"
          category={node.category}
          compatible={compatible ? compatible.has(handleId("ctl-in")) : undefined}
          reason={handleReasons?.[handleId("ctl-in")]}
        />
      ) : null}
      {handles !== "none"
        ? node.inputs.map((port, i) => {
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
          })
        : null}
      {handles === "auto"
        ? controls.map((route, i) => {
            const id = handleId("ctl", route.id);
            return (
              <TypedHandle
                key={id}
                kind="ctl"
                name={route.id}
                label={route.label}
                category={node.category}
                offset={handleOffset(i)}
                connected={run?.routeTaken === route.id}
                compatible={compatible ? compatible.has(id) : undefined}
                reason={handleReasons?.[id]}
              />
            );
          })
        : null}
      {handles === "auto"
        ? node.outputs.map((port, i) => {
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
          })
        : null}

      <div className="flex items-center gap-2 px-2.5 pt-2.5">
        <CategoryDot category={node.category} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-[14px] tracking-[-0.01em] text-ink">
          {node.name}
        </span>
        {headerExtra}
        {diagnostics.length ? <NodeDiagnosticsMarker diagnostics={diagnostics} /> : null}
        {disabled ? (
          <Badge tone="outline" size="sm" mono className="uppercase">
            off
          </Badge>
        ) : null}
        <span className="shrink-0 font-mono text-2xs leading-none tracking-[0.02em] text-ink-3">
          {kind}
        </span>
      </div>

      {desc ? (
        <div className="truncate pl-[26px] pr-2.5 pt-0.5 text-xs text-ink-2">{desc}</div>
      ) : null}

      {children ? (
        <div className={cn("pl-[26px] pr-2.5 pt-2", bodyClassName)}>{children}</div>
      ) : null}

      {metaItems.length ? (
        <div className="flex flex-wrap gap-x-2.5 gap-y-1 pl-[26px] pr-2.5 pt-2 font-mono text-2xs text-ink-3 tabular">
          {metaItems.map((m) => (
            <span
              key={m.label}
              className="inline-flex min-w-0 items-baseline gap-1 whitespace-nowrap"
            >
              <span className="text-ink-3">{m.label}</span>
              <span
                className={cn(
                  "truncate",
                  m.tone === "accent" && "text-accent-text",
                  m.tone === "danger" && "text-danger-text",
                )}
              >
                {m.value}
              </span>
            </span>
          ))}
        </div>
      ) : null}

      {run?.error ? (
        // The message is clamped to two lines; the tooltip shows it whole (the DOM, and so
        // assistive tech, always has the full text).
        <Tooltip content={`${run.error.code}: ${run.error.message}`}>
          <div className="pl-[26px] pr-2.5 pt-2 text-2xs leading-[15px] text-danger-text">
            <p className="line-clamp-2 [overflow-wrap:anywhere]">
              <span className="font-mono">{run.error.code}</span> {run.error.message}
            </p>
          </div>
        </Tooltip>
      ) : null}

      {footer === undefined ? (
        defaultFooter ? (
          <div className="mt-2">{defaultFooter}</div>
        ) : (
          <div className="pb-2.5" />
        )
      ) : footer ? (
        <div className="mt-2">{footer}</div>
      ) : (
        <div className="pb-2.5" />
      )}
    </div>
  );
});
