import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { Toaster as SonnerToaster, type ToasterProps as SonnerToasterProps } from "sonner";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

export type ToasterProps = SonnerToasterProps;

/**
 * Toast outlet themed to the tokens. Mount once near the app root. Toasts are
 * compact (13px, 12px padding), bottom-right, with lucide icons in status
 * colours; the surface follows the active theme through the tokens.
 */
export function Toaster({
  className,
  toastOptions,
  position = "bottom-right",
  offset = 16,
  gap = 8,
  visibleToasts = 4,
  duration = 4000,
  ...rest
}: ToasterProps) {
  return (
    <SonnerToaster
      position={position}
      offset={offset}
      gap={gap}
      visibleToasts={visibleToasts}
      duration={duration}
      className={cn("[--width:340px] font-sans!", className)}
      icons={{
        success: (
          <CheckCircle2 className="size-4 text-ok-text" strokeWidth={1.75} aria-hidden="true" />
        ),
        error: (
          <XCircle className="size-4 text-danger-text" strokeWidth={1.75} aria-hidden="true" />
        ),
        warning: (
          <AlertTriangle className="size-4 text-warn-text" strokeWidth={1.75} aria-hidden="true" />
        ),
        info: <Info className="size-4 text-accent" strokeWidth={1.75} aria-hidden="true" />,
        loading: <Spinner size="sm" className="text-ink-3" />,
      }}
      toastOptions={{
        ...toastOptions,
        classNames: {
          toast: cn(
            "items-start! gap-2.5! rounded-md! border! border-border! bg-surface! p-3! text-sm! text-ink! shadow-3! font-sans!",
            toastOptions?.classNames?.toast,
          ),
          title: cn(
            "text-sm! font-medium! leading-tight! text-ink!",
            toastOptions?.classNames?.title,
          ),
          description: cn(
            "mt-0.5! text-xs! leading-normal! text-ink-3!",
            toastOptions?.classNames?.description,
          ),
          icon: cn("mt-px! shrink-0!", toastOptions?.classNames?.icon),
          content: cn("min-w-0! flex-1!", toastOptions?.classNames?.content),
          actionButton: cn(
            "h-6! shrink-0! rounded-sm! border! border-accent! bg-accent! px-2! text-2xs! font-medium! text-accent-ink! hover:bg-accent-hover!",
            toastOptions?.classNames?.actionButton,
          ),
          cancelButton: cn(
            "h-6! shrink-0! rounded-sm! border! border-border! bg-surface! px-2! text-2xs! font-medium! text-ink-2! hover:bg-surface-3!",
            toastOptions?.classNames?.cancelButton,
          ),
          closeButton: cn(
            "border-border! bg-surface! text-ink-3! hover:bg-surface-3! hover:text-ink!",
            toastOptions?.classNames?.closeButton,
          ),
        },
      }}
      {...rest}
    />
  );
}

/**
 * Toast helpers. `toast.promise` shows loading → success/error from a promise;
 * every helper returns the toast id for `toast.dismiss(id)`.
 */
export { toast } from "sonner";
