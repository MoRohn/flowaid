import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type HTMLAttributes,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { DialogOverlay } from "./Dialog";
import { IconButton } from "./IconButton";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export interface SheetContentProps extends ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  side?: "right" | "left";
  /** Panel width in px (or any CSS length). Clamped to the viewport minus 32px. */
  width?: number | string;
  hideClose?: boolean;
  /** Skip the dimming overlay so the canvas behind stays readable. */
  noOverlay?: boolean;
}

/**
 * Side panel variant of Dialog. Slides in from the right (default) and takes
 * the full height; use it for run detail, node settings and long forms.
 */
export const SheetContent = forwardRef<
  ComponentRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(function SheetContent(
  {
    className,
    side = "right",
    width = 420,
    hideClose = false,
    noOverlay = false,
    children,
    style,
    ...rest
  },
  ref,
) {
  const w = typeof width === "number" ? `${width}px` : width;
  return (
    <DialogPrimitive.Portal>
      {noOverlay ? null : <DialogOverlay />}
      <DialogPrimitive.Content
        ref={ref}
        style={{ "--sheet-w": w, ...style }}
        className={cn(
          "fixed inset-y-0 z-50 flex w-[min(var(--sheet-w),calc(100vw-32px))] flex-col border-border bg-surface text-ink shadow-3 outline-none",
          side === "right" ? "fa-sheet-right right-0 border-l" : "fa-sheet-left left-0 border-r",
          className,
        )}
        {...rest}
      >
        {children}
        {!hideClose ? (
          <DialogPrimitive.Close asChild>
            <IconButton
              label="Close"
              size="sm"
              tooltip={false}
              className="absolute right-2.5 top-2.5"
            >
              <X strokeWidth={1.75} />
            </IconButton>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export type SheetHeaderProps = HTMLAttributes<HTMLDivElement>;

export function SheetHeader({ className, ...rest }: SheetHeaderProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-1 border-b border-border px-4 py-3 pr-11",
        className,
      )}
      {...rest}
    />
  );
}

export type SheetBodyProps = HTMLAttributes<HTMLDivElement>;

export function SheetBody({ className, ...rest }: SheetBodyProps) {
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-4 text-sm text-ink-2", className)}
      {...rest}
    />
  );
}

export type SheetFooterProps = HTMLAttributes<HTMLDivElement>;

export function SheetFooter({ className, ...rest }: SheetFooterProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-2 px-4 py-3",
        className,
      )}
      {...rest}
    />
  );
}

export type SheetTitleProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Title>;

export const SheetTitle = forwardRef<ComponentRef<typeof DialogPrimitive.Title>, SheetTitleProps>(
  function SheetTitle({ className, ...rest }, ref) {
    return (
      <DialogPrimitive.Title
        ref={ref}
        className={cn("text-sm font-semibold leading-tight tracking-tight text-ink", className)}
        {...rest}
      />
    );
  },
);

export type SheetDescriptionProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Description>;

export const SheetDescription = forwardRef<
  ComponentRef<typeof DialogPrimitive.Description>,
  SheetDescriptionProps
>(function SheetDescription({ className, ...rest }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn("text-xs leading-normal text-ink-3", className)}
      {...rest}
    />
  );
});
