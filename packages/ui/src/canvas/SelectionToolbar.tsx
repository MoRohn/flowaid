import { forwardRef, type HTMLAttributes } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  Group,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton, TooltipProvider } from "@/primitives";
import type { AlignKind, DistributeAxis } from "./geometry";

export interface SelectionToolbarProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Number of selected nodes; distribute needs three, align two. */
  count: number;
  onAlign: (kind: AlignKind) => void;
  onDistribute: (axis: DistributeAxis) => void;
  onGroup?: () => void;
  onDelete: () => void;
}

const ICON = { strokeWidth: 1.75, "aria-hidden": true } as const;

const ALIGN: Array<{ kind: AlignKind; label: string; icon: typeof AlignStartVertical }> = [
  { kind: "left", label: "Align left", icon: AlignStartVertical },
  { kind: "center", label: "Align horizontal centres", icon: AlignCenterVertical },
  { kind: "right", label: "Align right", icon: AlignEndVertical },
  { kind: "top", label: "Align top", icon: AlignStartHorizontal },
  { kind: "middle", label: "Align vertical centres", icon: AlignCenterHorizontal },
  { kind: "bottom", label: "Align bottom", icon: AlignEndHorizontal },
];

function Divider() {
  return <span aria-hidden="true" className="mx-0.5 h-4 w-px self-center bg-border" />;
}

/**
 * Floating toolbar shown above a multi-selection: align, distribute, group
 * into a subflow and delete. FlowCanvas positions it over the selection
 * bounds; the toolbar itself is a plain horizontal control strip.
 */
export const SelectionToolbar = forwardRef<HTMLDivElement, SelectionToolbarProps>(
  function SelectionToolbar(
    { count, onAlign, onDistribute, onGroup, onDelete, className, ...rest },
    ref,
  ) {
    const canAlign = count >= 2;
    const canDistribute = count >= 3;
    return (
      <TooltipProvider>
        <div
          ref={ref}
          role="toolbar"
          aria-label={`${count} nodes selected`}
          className={cn(
            "inline-flex h-8 items-center gap-px rounded-md border border-border bg-surface px-1 shadow-2",
            className,
          )}
          {...rest}
        >
          <span className="mr-1 select-none px-1 font-mono text-2xs tabular text-ink-3">
            {count}
          </span>
          <Divider />
          {ALIGN.map(({ kind, label, icon: Icon }) => (
            <IconButton
              key={kind}
              label={label}
              size="sm"
              onClick={() => onAlign(kind)}
              disabled={!canAlign}
            >
              <Icon {...ICON} />
            </IconButton>
          ))}
          <Divider />
          <IconButton
            label="Distribute horizontally"
            size="sm"
            onClick={() => onDistribute("horizontal")}
            disabled={!canDistribute}
          >
            <AlignHorizontalSpaceBetween {...ICON} />
          </IconButton>
          <IconButton
            label="Distribute vertically"
            size="sm"
            onClick={() => onDistribute("vertical")}
            disabled={!canDistribute}
          >
            <AlignVerticalSpaceBetween {...ICON} />
          </IconButton>
          {onGroup ? (
            <>
              <Divider />
              <IconButton label="Group into subflow" shortcut="mod+G" size="sm" onClick={onGroup}>
                <Group {...ICON} />
              </IconButton>
            </>
          ) : null}
          <Divider />
          <IconButton
            label="Delete"
            shortcut="Delete"
            size="sm"
            variant="danger"
            onClick={onDelete}
          >
            <Trash2 {...ICON} />
          </IconButton>
        </div>
      </TooltipProvider>
    );
  },
);
