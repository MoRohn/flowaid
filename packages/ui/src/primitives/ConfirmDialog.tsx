import { useRef, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./Dialog";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Extra content between the description and the buttons (a summary, an input). */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger: red filled confirm button with a warning icon in the header. */
  variant?: "default" | "danger";
  /** Return a promise to keep the dialog open with a spinner until it settles. */
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  /** Externally controlled busy state (when the parent tracks the mutation). */
  loading?: boolean;
  /** Disable confirm until a condition holds (typed confirmation). */
  confirmDisabled?: boolean;
  icon?: ReactNode;
  className?: string;
}

/**
 * Small modal that asks before an irreversible action. It never uses the
 * browser `confirm()`; the confirm button is the only filled control and
 * takes initial focus so Enter confirms and Escape cancels.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
  loading,
  confirmDisabled = false,
  icon,
  className,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const busy = loading ?? pending;

  const handleConfirm = async () => {
    const result = onConfirm();
    if (result instanceof Promise) {
      setPending(true);
      try {
        await result;
        onOpenChange(false);
      } finally {
        setPending(false);
      }
    }
  };

  const confirmRef = useRef<HTMLButtonElement>(null);

  const handleOpenChange = (next: boolean) => {
    if (busy) return;
    if (!next) onCancel?.();
    onOpenChange(next);
  };

  const headerIcon =
    icon ?? (variant === "danger" ? <AlertTriangle strokeWidth={1.75} aria-hidden="true" /> : null);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        size="sm"
        hideClose
        className={className}
        onOpenAutoFocus={(e) => {
          // Land on the confirm action rather than the first focusable element.
          e.preventDefault();
          confirmRef.current?.focus();
        }}
      >
        <DialogHeader className="flex-row items-start gap-3 border-b-0 pb-1 pr-5">
          {headerIcon ? (
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-md border [&_svg]:size-4",
                variant === "danger"
                  ? "border-danger/20 bg-danger-soft text-danger-text"
                  : "border-border bg-surface-2 text-ink-2",
              )}
            >
              {headerIcon}
            </span>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1 pt-0.5">
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </div>
        </DialogHeader>
        {children ? <DialogBody className="pt-2">{children}</DialogBody> : null}
        <DialogFooter className={cn(children ? undefined : "border-t-0 bg-transparent pt-3")}>
          <Button variant="secondary" onClick={() => handleOpenChange(false)} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={variant === "danger" ? "danger" : "primary"}
            className={cn(
              variant === "danger" && "border-danger bg-danger text-accent-ink hover:bg-danger/90",
            )}
            loading={busy}
            disabled={confirmDisabled}
            onClick={() => {
              void handleConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
