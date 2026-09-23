import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/cn";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export interface PopoverContentProps extends ComponentPropsWithoutRef<
  typeof PopoverPrimitive.Content
> {
  /** Remove the default 12px padding for custom layouts (lists, pickers). */
  bare?: boolean;
  /** Width in px; defaults to 256. Pass "trigger" to match the trigger width. */
  width?: number | "trigger" | "auto";
}

/**
 * Floating surface anchored to its trigger. Focus moves inside; Escape and
 * outside clicks close it. Use for pickers, filters and small editors.
 */
export const PopoverContent = forwardRef<
  ComponentRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(function PopoverContent(
  {
    className,
    align = "start",
    sideOffset = 4,
    collisionPadding = 8,
    bare = false,
    width = 256,
    style,
    ...rest
  },
  ref,
) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        style={typeof width === "number" ? { width, ...style } : style}
        className={cn(
          "fa-pop z-50 rounded-md border border-border bg-surface text-sm text-ink shadow-3 outline-none",
          "origin-(--radix-popover-content-transform-origin) max-h-(--radix-popover-content-available-height) overflow-auto",
          width === "trigger" && "w-(--radix-popover-trigger-width)",
          !bare && "p-3",
          className,
        )}
        {...rest}
      />
    </PopoverPrimitive.Portal>
  );
});
