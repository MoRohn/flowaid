import {
  forwardRef,
  isValidElement,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type ReactNode,
} from "react";
import { Slot } from "@radix-ui/react-slot";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/cn";
import { Shortcut } from "./Kbd";

export const TooltipProvider = TooltipPrimitive.Provider;

export interface TooltipProps extends Omit<
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>,
  "children" | "content" | "className" | "disabled" | "asChild"
> {
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
  /** Classes for the tooltip bubble (not the trigger). */
  className?: string;
}

/**
 * Inverted ink tooltip with a 200ms delay. Wraps its own provider so it works
 * anywhere; wrap a subtree in `TooltipProvider` to share the skip-delay window
 * between neighbouring triggers (toolbars). Any other props and the ref go to the
 * trigger, so a Tooltip can sit inside another `asChild` trigger (a menu's) and the
 * menu's handlers, ARIA state and ref still reach the button.
 */
export const Tooltip = forwardRef<ComponentRef<typeof TooltipPrimitive.Trigger>, TooltipProps>(
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
      ...triggerProps
    },
    ref,
  ) {
    if (disabled || content === null || content === undefined || content === false)
      return isValidElement(children) ? (
        <Slot {...triggerProps} ref={ref}>
          {children}
        </Slot>
      ) : (
        <>{children}</>
      );
    return (
      <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={300}>
        <TooltipPrimitive.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
          <TooltipPrimitive.Trigger asChild {...triggerProps} ref={ref}>
            {children}
          </TooltipPrimitive.Trigger>
          <TooltipPrimitive.Portal>
            <TooltipContent side={side} align={align} sideOffset={sideOffset} className={className}>
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
