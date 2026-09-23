import { forwardRef, type HTMLAttributes } from "react";
import { Copy, PanelRight, Play, Power, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton, Separator, TooltipProvider } from "@/primitives";

/** Callbacks a canvas wires to the node toolbar; each receives the node id. */
export interface NodeActionHandlers {
  onRunFromHere?: (nodeId: string) => void;
  onDuplicate?: (nodeId: string) => void;
  onToggleDisabled?: (nodeId: string) => void;
  onDelete?: (nodeId: string) => void;
  onOpenInspector?: (nodeId: string) => void;
}

export interface NodeActionBarProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children">, NodeActionHandlers {
  nodeId: string;
  /** Whether the node is currently disabled (flips the enable/disable action). */
  disabled?: boolean;
  /** Greys out "Run from here" (no run context, or the node cannot be a start). */
  canRun?: boolean;
}

/**
 * The floating action bar shown above a selected node: run from here,
 * duplicate, enable/disable, open inspector, delete. Pure and presentational;
 * `NodeToolbar` positions it with xyflow.
 */
export const NodeActionBar = forwardRef<HTMLDivElement, NodeActionBarProps>(function NodeActionBar(
  {
    nodeId,
    disabled = false,
    canRun = true,
    onRunFromHere,
    onDuplicate,
    onToggleDisabled,
    onDelete,
    onOpenInspector,
    className,
    ...rest
  },
  ref,
) {
  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={ref}
        role="toolbar"
        aria-label="Node actions"
        className={cn(
          "nodrag nopan inline-flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5 shadow-2",
          className,
        )}
        {...rest}
      >
        {onRunFromHere ? (
          <IconButton
            label="Run from here"
            size="sm"
            disabled={!canRun}
            onClick={() => onRunFromHere(nodeId)}
          >
            <Play strokeWidth={1.75} />
          </IconButton>
        ) : null}
        {onDuplicate ? (
          <IconButton
            label="Duplicate"
            size="sm"
            shortcut="mod+d"
            onClick={() => onDuplicate(nodeId)}
          >
            <Copy strokeWidth={1.75} />
          </IconButton>
        ) : null}
        {onToggleDisabled ? (
          <IconButton
            label={disabled ? "Enable" : "Disable"}
            size="sm"
            aria-pressed={disabled}
            className={cn(disabled && "text-warn-text hover:text-warn-text")}
            onClick={() => onToggleDisabled(nodeId)}
          >
            <Power strokeWidth={1.75} />
          </IconButton>
        ) : null}
        {onOpenInspector ? (
          <IconButton
            label="Open inspector"
            size="sm"
            shortcut="i"
            onClick={() => onOpenInspector(nodeId)}
          >
            <PanelRight strokeWidth={1.75} />
          </IconButton>
        ) : null}
        {onDelete ? (
          <>
            <Separator orientation="vertical" className="mx-0.5 h-4" />
            <IconButton
              label="Delete"
              size="sm"
              variant="danger"
              shortcut="backspace"
              onClick={() => onDelete(nodeId)}
            >
              <Trash2 strokeWidth={1.75} />
            </IconButton>
          </>
        ) : null}
      </div>
    </TooltipProvider>
  );
});
