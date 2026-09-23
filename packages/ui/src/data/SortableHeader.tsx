import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/primitives";

export type SortDirection = false | "asc" | "desc";

export interface SortableHeaderProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  children: ReactNode;
  /** Current direction for this column. */
  sorted?: SortDirection;
  /** 0-based position in a multi-sort; shown as a small index when > 0 or when `multiCount` > 1. */
  sortIndex?: number;
  /** Number of columns currently sorted; enables the index badge when > 1. */
  multiCount?: number;
  /** When false, renders a plain label with no button. */
  canSort?: boolean;
  align?: "start" | "center" | "end";
  /** Show the direction icon only on hover/focus until sorted. */
  quiet?: boolean;
  /** Tooltip text for the sort button (defaults to the multi-sort hint). */
  title?: string;
}

/**
 * Column header label with sort affordance. The parent sets `aria-sort` on
 * the `<th>`; this renders the button, the direction arrow and the multi-sort
 * index. Shift+click adds a column to the sort (handled by the table).
 */
export const SortableHeader = forwardRef<HTMLButtonElement, SortableHeaderProps>(
  function SortableHeader(
    {
      children,
      sorted = false,
      sortIndex,
      multiCount = 0,
      canSort = true,
      align = "start",
      quiet = true,
      className,
      title,
      ...rest
    },
    ref,
  ) {
    const alignClass =
      align === "end" ? "justify-end text-right" : align === "center" ? "justify-center" : "";
    if (!canSort) {
      return (
        <span className={cn("flex min-w-0 items-center gap-1 truncate", alignClass, className)}>
          <span className="truncate">{children}</span>
        </span>
      );
    }
    const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ChevronsUpDown;
    // `title` is shown in the Tooltip primitive (on hover and keyboard focus), never as a
    // native title attribute.
    return (
      <Tooltip content={title ?? "Sort. Shift+click to sort by several columns"}>
        <button
          ref={ref}
          type="button"
          data-sorted={sorted || undefined}
          className={cn(
            "group/sort -mx-1 flex h-6 min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-xs px-1 text-left",
            "transition-colors duration-(--dur-fast) hover:bg-surface-3 hover:text-ink",
            sorted ? "text-ink" : "text-ink-2",
            align === "end" && "flex-row-reverse",
            alignClass,
            className,
          )}
          {...rest}
        >
          <span className="truncate">{children}</span>
          <span
            aria-hidden="true"
            className={cn(
              "flex size-3.5 shrink-0 items-center justify-center text-ink-3 transition-opacity duration-(--dur-fast)",
              sorted && "text-accent",
              quiet &&
                !sorted &&
                "opacity-0 group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100",
            )}
          >
            <Icon className="size-3.5" strokeWidth={sorted ? 2.25 : 1.75} />
          </span>
          {sorted && multiCount > 1 && sortIndex !== undefined ? (
            <span
              className="font-mono text-2xs leading-none text-accent tabular"
              aria-hidden="true"
            >
              {sortIndex + 1}
            </span>
          ) : null}
        </button>
      </Tooltip>
    );
  },
);
