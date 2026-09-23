import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { Handle, Position, useNodeId, type HandleProps } from "@xyflow/react";
import { cn } from "@/lib/cn";
import { categoryVar, type NodeCategory } from "@/lib/categories";
import type { PortView } from "@/types";
import { CONTROL_IN, handleId, handleTypeOf, isPortTyped, type HandleKind } from "./nodeUtils";

/** Offset (px from the card's left edge) of the control-in notch. */
export const CONTROL_IN_OFFSET = 14;

interface TypedHandleOwnProps {
  /** The port the handle exposes; drives the label and the typed tint. */
  port?: Pick<PortView, "label" | "type" | "required" | "schema">;
  /** Overrides the port label. */
  label?: string;
  /** Category hue used for the typed tint. */
  category?: NodeCategory;
  /** Force the typed treatment on or off (defaults to `isPortTyped(port)`; control handles are always typed). */
  typed?: boolean;
  /** Highlight as a valid drop target while a connection is being dragged. `false` dims it. */
  compatible?: boolean;
  /** Why the handle rejects the connection being dragged; shown in its label while `compatible` is false. */
  reason?: string;
  /** Filled dot: an edge is attached. */
  connected?: boolean;
  /**
   * Offset along the card edge: px from the card top for left/right handles, px from the card
   * left for the control-in notch. Omit for the middle (the notch defaults to the top-left).
   */
  offset?: number;
  /** When the label shows. */
  labelMode?: "hover" | "always" | "never";
}

type HandleOnlyProps = Pick<
  HandleProps,
  "isConnectable" | "isConnectableStart" | "isConnectableEnd" | "isValidConnection" | "onConnect"
>;

type TypedHandleCommonProps = TypedHandleOwnProps &
  HandleOnlyProps &
  Omit<HTMLAttributes<HTMLDivElement>, "id" | "children">;

/**
 * `kind` picks the handle id, type and side: `in:<name>` (target, left), `out:<name>`
 * (source, right), `ctl:<name>` (control-out, right) and `ctl-in` (the control-in notch on
 * the top edge, near the left corner).
 */
export type TypedHandleProps = TypedHandleCommonProps &
  ({ kind: "ctl-in"; name?: undefined } | { kind: Exclude<HandleKind, "ctl-in">; name: string });

const POSITION: Record<HandleKind, Position> = {
  in: Position.Left,
  out: Position.Right,
  ctl: Position.Right,
  "ctl-in": Position.Top,
};

const DIRECTION: Record<HandleKind, string> = {
  in: "input",
  out: "output",
  ctl: "control output",
  "ctl-in": "control input",
};

/**
 * xyflow `Handle` for a FlowAId port. Data ports are 8px circles on the side
 * borders, tinted by the port's category when typed; control-outs are small
 * squares on the right edge; the control-in is a single notch at the top
 * left. The id is derived from `kind` and `name` (`handleId`), never passed
 * in. A 22px hit area surrounds each handle, the label appears on hover, and
 * `compatible` lights it up (or dims it, with the `reason`) while a
 * connection drags. Keyboard users connect through the canvas connect list (C on a
 * focused node), which offers the same compatible targets.
 *
 * Outside a React Flow node (a gallery or a static preview) the handle
 * renders the same markup without xyflow's connection wiring, so cards can be
 * shown on their own without React Flow warnings.
 */
export const TypedHandle = forwardRef<HTMLDivElement, TypedHandleProps>(
  function TypedHandle(props, ref) {
    const id = props.kind === "ctl-in" ? CONTROL_IN : handleId(props.kind, props.name);
    const {
      kind,
      name: _name,
      port,
      label,
      category,
      typed,
      compatible,
      reason,
      connected = false,
      offset,
      labelMode = "hover",
      isConnectable,
      isConnectableStart,
      isConnectableEnd,
      isValidConnection,
      onConnect,
      className,
      style,
      ...rest
    } = props;
    const nodeId = useNodeId();
    const type = handleTypeOf(kind);
    const position = POSITION[kind];
    const isControl = kind === "ctl" || kind === "ctl-in";
    const isTyped = typed ?? (isControl ? true : port ? isPortTyped(port) : false);
    const text = label ?? port?.label ?? (kind === "ctl-in" ? "control in" : undefined);
    const along = kind === "ctl-in" ? (offset ?? CONTROL_IN_OFFSET) : offset;
    const handleStyle: CSSProperties = {
      ...(along !== undefined ? (kind === "ctl-in" ? { left: along } : { top: along }) : null),
      ...(category ? { "--fa-handle-c": categoryVar(category) } : null),
      ...style,
    };
    const rejected = compatible === false && reason !== undefined;
    const shared = {
      className: cn("fa-handle nodrag", className),
      style: handleStyle,
      "data-handle-kind": kind,
      "data-typed": isTyped ? "true" : "false",
      "data-compatible": compatible === undefined ? undefined : compatible ? "true" : "false",
      "data-reason": rejected ? reason : undefined,
      "data-connected": connected ? "true" : "false",
      "data-label": rejected && labelMode === "never" ? "hover" : labelMode,
      "data-port-type": port?.type,
      // A handle is a pointer affordance (keyboard users connect with C on the node, through
      // the canvas connect list); it is exposed as a named graphic, since a generic <div> may
      // not carry aria-label. The rejection reason joins the name while a drag is refused.
      role: "img",
      "aria-label": text
        ? `${text} (${DIRECTION[kind]})${rejected ? `: ${reason}` : ""}`
        : undefined,
      ...rest,
    };
    const children: ReactNode =
      (text && labelMode !== "never") || rejected ? (
        <span className="fa-handle-label" aria-hidden="true">
          {rejected ? reason : text}
          {!rejected && port && isTyped && !isControl ? <small>{port.type}</small> : null}
        </span>
      ) : null;

    if (nodeId === null) {
      return (
        <div
          ref={ref}
          {...shared}
          className={cn(
            "react-flow__handle",
            `react-flow__handle-${position}`,
            type,
            shared.className,
          )}
          data-handleid={id}
          data-handlepos={position}
        >
          {children}
        </div>
      );
    }
    return (
      <Handle
        ref={ref}
        id={id}
        type={type}
        position={position}
        isConnectable={isConnectable}
        isConnectableStart={isConnectableStart}
        isConnectableEnd={isConnectableEnd}
        isValidConnection={isValidConnection}
        onConnect={onConnect}
        {...shared}
      >
        {children}
      </Handle>
    );
  },
);
