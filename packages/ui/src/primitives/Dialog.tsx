import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type HTMLAttributes,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./IconButton";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export type DialogSize = "sm" | "md" | "lg" | "xl";

const SIZE_PX: Record<DialogSize, number> = { sm: 400, md: 520, lg: 720, xl: 960 };

export type DialogOverlayProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>;

export const DialogOverlay = forwardRef<
  ComponentRef<typeof DialogPrimitive.Overlay>,
  DialogOverlayProps
>(function DialogOverlay({ className, ...rest }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        "fa-overlay fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] dark:bg-canvas/60",
        className,
      )}
      {...rest}
    />
  );
});

export interface DialogContentProps extends ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  size?: DialogSize;
  /** Hide the top-right close button (the footer must then offer a way out). */
  hideClose?: boolean;
  /** Anchor near the top instead of centring (command palettes, pickers). */
  placement?: "center" | "top";
}

/**
 * Modal surface. Combine `DialogHeader` / `DialogBody` / `DialogFooter` for
 * the standard layout: the body scrolls, the header and footer stay put.
 */
export const DialogContent = forwardRef<
  ComponentRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(function DialogContent(
  { className, size = "md", hideClose = false, placement = "center", children, style, ...rest },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        style={{ "--dialog-w": `${SIZE_PX[size]}px`, ...style }}
        className={cn(
          "fa-pop fixed left-1/2 z-50 flex w-[calc(100vw-32px)] max-w-(--dialog-w) -translate-x-1/2 flex-col",
          "rounded-lg border border-border bg-surface text-ink shadow-3 outline-none",
          placement === "center"
            ? "top-1/2 max-h-[calc(100dvh-32px)] -translate-y-1/2"
            : "top-[max(16px,12vh)] max-h-[calc(100dvh-max(16px,12vh)-16px)]",
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

export type DialogHeaderProps = HTMLAttributes<HTMLDivElement>;

export function DialogHeader({ className, ...rest }: DialogHeaderProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-1 border-b border-border px-5 py-4 pr-12",
        className,
      )}
      {...rest}
    />
  );
}

export type DialogBodyProps = HTMLAttributes<HTMLDivElement>;

export function DialogBody({ className, ...rest }: DialogBodyProps) {
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm text-ink-2", className)}
      {...rest}
    />
  );
}

export type DialogFooterProps = HTMLAttributes<HTMLDivElement>;

export function DialogFooter({ className, ...rest }: DialogFooterProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-end gap-2 rounded-b-lg border-t border-border bg-surface-2 px-5 py-3",
        className,
      )}
      {...rest}
    />
  );
}

export type DialogTitleProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Title>;

export const DialogTitle = forwardRef<ComponentRef<typeof DialogPrimitive.Title>, DialogTitleProps>(
  function DialogTitle({ className, ...rest }, ref) {
    return (
      <DialogPrimitive.Title
        ref={ref}
        className={cn("text-base font-semibold leading-tight tracking-tight text-ink", className)}
        {...rest}
      />
    );
  },
);

export type DialogDescriptionProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Description>;

export const DialogDescription = forwardRef<
  ComponentRef<typeof DialogPrimitive.Description>,
  DialogDescriptionProps
>(function DialogDescription({ className, ...rest }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn("text-sm leading-normal text-ink-3", className)}
      {...rest}
    />
  );
});
