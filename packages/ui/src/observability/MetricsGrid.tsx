import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface MetricsGridProps extends HTMLAttributes<HTMLDivElement> {
  /** Minimum tile width; columns are filled automatically. */
  minWidth?: number;
  /** Hard cap on the column count for wide screens. */
  maxColumns?: number;
  gap?: 2 | 3 | 4;
}

/**
 * Responsive auto-fill grid for tiles and cards. Uses `minmax(min, 1fr)` so
 * tiles reflow from one column at 400px up to `maxColumns` on wide screens.
 */
export const MetricsGrid = forwardRef<HTMLDivElement, MetricsGridProps>(function MetricsGrid(
  { minWidth = 200, maxColumns, gap = 3, className, style, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "grid min-w-0",
        gap === 2 && "gap-2",
        gap === 3 && "gap-3",
        gap === 4 && "gap-4",
        className,
      )}
      style={{
        gridTemplateColumns: maxColumns
          ? `repeat(auto-fill, minmax(max(${minWidth}px, calc((100% - ${(maxColumns - 1) * gap * 4}px) / ${maxColumns})), 1fr))`
          : `repeat(auto-fill, minmax(min(100%, ${minWidth}px), 1fr))`,
        ...style,
      }}
      {...rest}
    />
  );
});
