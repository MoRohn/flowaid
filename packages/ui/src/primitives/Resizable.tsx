import { forwardRef, type ComponentPropsWithoutRef } from "react";
import {
  Group,
  Panel as PanelPrimitive,
  Separator as SeparatorPrimitive,
} from "react-resizable-panels";
import { cn } from "@/lib/cn";

export type ResizablePanelGroupProps = ComponentPropsWithoutRef<typeof Group>;

/** Container for resizable panels. `orientation` is "horizontal" (side by side, default) or "vertical". */
export const ResizablePanelGroup = forwardRef<HTMLDivElement, ResizablePanelGroupProps>(
  function ResizablePanelGroup({ className, orientation = "horizontal", ...rest }, ref) {
    return (
      <Group
        elementRef={ref}
        orientation={orientation}
        className={cn(
          "flex size-full min-h-0 min-w-0",
          orientation === "vertical" ? "flex-col" : "flex-row",
          className,
        )}
        {...rest}
      />
    );
  },
);

export type ResizablePanelProps = ComponentPropsWithoutRef<typeof PanelPrimitive>;

/** One pane. `defaultSize`/`minSize`/`maxSize` take percentages as strings ("30%" or "30") and pixels as numbers. */
export const ResizablePanel = forwardRef<HTMLDivElement, ResizablePanelProps>(
  function ResizablePanel({ className, ...rest }, ref) {
    return (
      <PanelPrimitive elementRef={ref} className={cn("min-h-0 min-w-0", className)} {...rest} />
    );
  },
);

export interface ResizableHandleProps extends ComponentPropsWithoutRef<typeof SeparatorPrimitive> {
  /** Show a small grip pill on hover/focus. */
  withGrip?: boolean;
}

/**
 * 1px divider between panes. The hit area is 9px wide; on hover and while
 * dragging the line turns accent and, with `withGrip`, a grip pill appears.
 */
export const ResizableHandle = forwardRef<HTMLDivElement, ResizableHandleProps>(
  function ResizableHandle({ className, withGrip = true, ...rest }, ref) {
    return (
      <SeparatorPrimitive
        elementRef={ref}
        className={cn(
          "group/handle relative flex shrink-0 items-center justify-center bg-border outline-none",
          "transition-colors duration-(--dur-fast) ease-(--ease-out)",
          "data-[separator=hover]:bg-accent data-[separator=active]:bg-accent data-[separator=focus]:bg-accent",
          "aria-[orientation=vertical]:h-full aria-[orientation=vertical]:w-px aria-[orientation=vertical]:cursor-col-resize",
          "aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:cursor-row-resize",
          "after:absolute after:content-[''] aria-[orientation=vertical]:after:inset-y-0 aria-[orientation=vertical]:after:-left-1 aria-[orientation=vertical]:after:w-[9px]",
          "aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:-top-1 aria-[orientation=horizontal]:after:h-[9px]",
          className,
        )}
        {...rest}
      >
        {withGrip ? (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute z-10 rounded-full border border-border bg-surface shadow-1 opacity-0",
              "transition-opacity duration-(--dur-fast) group-hover/handle:opacity-100 group-data-[separator=active]/handle:opacity-100 group-data-[separator=focus]/handle:opacity-100",
              "group-aria-[orientation=vertical]/handle:h-6 group-aria-[orientation=vertical]/handle:w-1.5",
              "group-aria-[orientation=horizontal]/handle:h-1.5 group-aria-[orientation=horizontal]/handle:w-6",
            )}
          />
        ) : null}
      </SeparatorPrimitive>
    );
  },
);
