import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef, type Ref } from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { cn } from "@/lib/cn";

export interface ScrollAreaProps extends ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> {
  orientation?: "vertical" | "horizontal" | "both";
  viewportClassName?: string;
  viewportRef?: Ref<HTMLDivElement>;
}

/**
 * Scroll container with thin overlay scrollbars that appear on hover. The
 * viewport is the element that scrolls; pass `viewportRef` to control it.
 */
export const ScrollArea = forwardRef<
  ComponentRef<typeof ScrollAreaPrimitive.Root>,
  ScrollAreaProps
>(function ScrollArea(
  {
    className,
    children,
    orientation = "vertical",
    viewportClassName,
    viewportRef,
    type = "hover",
    scrollHideDelay = 400,
    ...rest
  },
  ref,
) {
  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      type={type}
      scrollHideDelay={scrollHideDelay}
      className={cn("relative min-h-0 overflow-hidden", className)}
      {...rest}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        className={cn("size-full rounded-[inherit] [&>div]:!block", viewportClassName)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {orientation !== "horizontal" ? <ScrollBar orientation="vertical" /> : null}
      {orientation !== "vertical" ? <ScrollBar orientation="horizontal" /> : null}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
});

export type ScrollBarProps = ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Scrollbar>;

export const ScrollBar = forwardRef<
  ComponentRef<typeof ScrollAreaPrimitive.Scrollbar>,
  ScrollBarProps
>(function ScrollBar({ className, orientation = "vertical", ...rest }, ref) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      ref={ref}
      orientation={orientation}
      className={cn(
        "z-10 flex touch-none select-none p-px transition-opacity duration-(--dur-base) data-[state=hidden]:opacity-0",
        orientation === "vertical"
          ? "h-full w-2 border-l border-l-transparent"
          : "h-2 flex-col border-t border-t-transparent",
        className,
      )}
      {...rest}
    >
      <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border-strong transition-colors hover:bg-ink-4" />
    </ScrollAreaPrimitive.Scrollbar>
  );
});
