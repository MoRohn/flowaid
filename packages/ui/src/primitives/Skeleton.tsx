import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "rect" | "text" | "circle";
  /** Renders this many text lines, the last one shorter. */
  lines?: number;
  width?: number | string;
  height?: number | string;
}

/**
 * Loading placeholder. Shimmers gently (static under reduced motion) and
 * takes the shape of what it replaces: a block, a line of text or an avatar.
 */
export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(function Skeleton(
  { className, variant = "rect", lines, width, height, style, ...rest },
  ref,
) {
  if (lines !== undefined && lines > 1) {
    return (
      <div
        ref={ref}
        aria-hidden="true"
        className={cn("flex flex-col gap-2", className)}
        style={{ width, ...style }}
        {...rest}
      >
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className="fa-shimmer h-3 rounded-xs bg-surface-3"
            style={{ width: i === lines - 1 ? "62%" : "100%" }}
          />
        ))}
      </div>
    );
  }
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn(
        "fa-shimmer bg-surface-3",
        variant === "circle"
          ? "rounded-full"
          : variant === "text"
            ? "h-3 rounded-xs"
            : "rounded-sm",
        className,
      )}
      style={{ width, height, ...style }}
      {...rest}
    />
  );
});
