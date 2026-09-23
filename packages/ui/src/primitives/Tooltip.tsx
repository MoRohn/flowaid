import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type ReactNode,
} from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/cn";
import { Shortcut } from "./Kbd";

export const TooltipProvider = TooltipPrimitive.Provider;

export interface TooltipProps {
  /** The trigger. Must be a single element that accepts a ref and event handlers. */
  children: ReactNode;
  content: ReactNode;
  /** Shortcut string ("mod+k") rendered in mono after the content. */
  shortcut?: string;
  side?: TooltipPrimitive.TooltipContentProps["side"];
  align?: TooltipPrimitive.TooltipContentProps["align"];
  sideOffset?: number;
  /** Delay before showing, in ms. */
  delayDuration?: number;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Renders the trigger without a tooltip (e.g. while a menu is open). */
  disabled?: boolean;
  className?: string;
}

/**
 * Inverted ink tooltip with a 200ms delay. Wraps its own provider so it works
 * anywhere; wrap a subtree in `TooltipProvider` to share the skip-delay window
 * between neighbouring triggers (toolbars).
 */
export const Tooltip = forwardRef<ComponentRef<typeof TooltipPrimitive.Content>, TooltipProps>(
  function Tooltip(
    {
      children,
      content,
      shortcut,
      side = "top",
      align = "center",
      sideOffset = 6,
      delayDuration = 200,
      open,
      defaultOpen,
      onOpenChange,
      disabled,
      className,
    },
    ref,
  ) {
    if (disabled || content === null || content === undefined || content === false)
      return <>{children}</>;
    return (
      <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={300}>
        <TooltipPrimitive.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
          <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
          <TooltipPrimitive.Portal>
            <TooltipContent
              ref={ref}
              side={side}
              align={align}
              sideOffset={sideOffset}
              className={className}
            >
              {content}
              {shortcut ? (
                <Shortcut
                  shortcut={shortcut}
                  size="sm"
                  className="ml-1.5 border-transparent bg-transparent px-0 text-2xs text-surface/70"
                />
              ) : null}
            </TooltipContent>
          </TooltipPrimitive.Portal>
        </TooltipPrimitive.Root>
      </TooltipPrimitive.Provider>
    );
  },
);

export type TooltipContentProps = ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>;

/** Styled Radix tooltip content for custom compositions (`TooltipPrimitive.Root` + `Trigger`). */
export const TooltipContent = forwardRef<
  ComponentRef<typeof TooltipPrimitive.Content>,
  TooltipContentProps
>(function TooltipContent({ className, sideOffset = 6, ...rest }, ref) {
  return (
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={8}
      className={cn(
        "fa-pop z-50 inline-flex max-w-72 items-center rounded-sm bg-ink px-2 py-1 text-xs font-medium leading-tight text-surface shadow-2",
        "origin-(--radix-tooltip-content-transform-origin)",
        className,
      )}
      {...rest}
    />
  );
});
