import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** A <Button variant="primary">; the next action the person should take. */
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  size?: "sm" | "md";
}

/**
 * Centred placeholder for an empty list, panel or search. Empty states always
 * offer the next action, so `primaryAction` is expected in most uses.
 */
export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { icon, title, description, primaryAction, secondaryAction, size = "md", className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "flex w-full flex-col items-center justify-center text-center",
        size === "sm" ? "gap-2 px-4 py-6" : "gap-3 px-6 py-10",
        className,
      )}
      {...rest}
    >
      {icon ? (
        <span
          className={cn(
            "flex items-center justify-center rounded-md border border-border bg-surface-2 text-ink-3 shadow-1",
            size === "sm" ? "size-8 [&_svg]:size-4" : "size-10 [&_svg]:size-5",
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="flex max-w-xs flex-col gap-1">
        <p
          className={cn(
            "font-medium text-ink",
            size === "sm" ? "text-sm" : "text-base tracking-tight",
          )}
        >
          {title}
        </p>
        {description ? (
          <p className={cn("text-ink-3", size === "sm" ? "text-xs" : "text-sm")}>{description}</p>
        ) : null}
      </div>
      {primaryAction || secondaryAction ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {primaryAction}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
});
