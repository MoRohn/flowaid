import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { TooltipSwatch } from "./ChartTooltip";

export interface LegendItem {
  id: string;
  label: ReactNode;
  color: string;
  /** Mirror the mark: line for lines, rect for bars/areas, dot for points. */
  shape?: TooltipSwatch;
  /** Mono value shown after the label (a total, a share). */
  value?: ReactNode;
}

export interface LegendProps extends HTMLAttributes<HTMLDivElement> {
  items: LegendItem[];
  /** Ids currently hidden. Only meaningful with `onToggle`. */
  hiddenIds?: readonly string[];
  /** Makes each item a toggle button. */
  onToggleItem?: (id: string) => void;
  size?: "sm" | "md";
}

/**
 * Series legend. Always rendered for two or more series so identity never
 * relies on colour alone; a single series needs none (the title names it).
 * With `onToggleItem` each entry becomes a pressable toggle that hides a series.
 */
export const Legend = forwardRef<HTMLDivElement, LegendProps>(function Legend(
  { items, hiddenIds = [], onToggleItem, size = "sm", className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      role={onToggleItem ? "group" : "list"}
      aria-label={rest["aria-label"] ?? "Legend"}
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}
      {...rest}
    >
      {items.map((item) => {
        const isHidden = hiddenIds.includes(item.id);
        const content = (
          <>
            <LegendSwatch shape={item.shape ?? "line"} color={item.color} />
            <span className="truncate">{item.label}</span>
            {item.value !== undefined ? (
              <span className="font-mono text-2xs text-ink-3 tabular">{item.value}</span>
            ) : null}
          </>
        );
        const cls = cn(
          "inline-flex min-w-0 items-center gap-1.5 text-ink-2",
          size === "sm" ? "text-2xs" : "text-xs",
          isHidden && "opacity-40",
        );
        if (onToggleItem) {
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={!isHidden}
              onClick={() => onToggleItem(item.id)}
              className={cn(
                cls,
                "-mx-1 cursor-pointer rounded-xs px-1 transition-[opacity,color] duration-(--dur-fast) hover:text-ink",
                isHidden && "line-through decoration-ink-4",
              )}
            >
              {content}
            </button>
          );
        }
        return (
          <span key={item.id} role="listitem" className={cls}>
            {content}
          </span>
        );
      })}
    </div>
  );
});

export function LegendSwatch({ shape, color }: { shape: TooltipSwatch; color: string }) {
  if (shape === "none") return null;
  if (shape === "dot") {
    return (
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
    );
  }
  if (shape === "rect") {
    return (
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
        style={{ backgroundColor: color }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="h-0.5 w-3.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}
