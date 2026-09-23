import { forwardRef, type HTMLAttributes } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton, Select, SelectItem } from "@/primitives";

export interface PageRange {
  /** 1-based index of the first visible row, 0 when empty. */
  from: number;
  /** 1-based index of the last visible row, 0 when empty. */
  to: number;
  pageCount: number;
}

/** Visible row range for a page. Clamps to the row count. */
export function pageRange(pageIndex: number, pageSize: number, total: number): PageRange {
  const size = Math.max(1, Math.floor(pageSize));
  const count = Math.max(0, Math.floor(total));
  const pageCount = Math.max(1, Math.ceil(count / size));
  const index = Math.min(Math.max(0, Math.floor(pageIndex)), pageCount - 1);
  if (count === 0) return { from: 0, to: 0, pageCount };
  const from = index * size + 1;
  const to = Math.min(count, from + size - 1);
  return { from, to, pageCount };
}

const int = new Intl.NumberFormat("en-US");

/** "1 to 50 of 1,204" — the mono summary shown in a table footer. */
export function formatPageRange(pageIndex: number, pageSize: number, total: number): string {
  const { from, to } = pageRange(pageIndex, pageSize, total);
  if (total === 0) return "0 of 0";
  return `${int.format(from)} to ${int.format(to)} of ${int.format(total)}`;
}

export interface PaginationProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** 0-based page index. */
  pageIndex: number;
  pageSize: number;
  /** Total row count across all pages. */
  total: number;
  onPageIndexChange: (pageIndex: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  /** Hide the page-size select. */
  showPageSize?: boolean;
  /** Show first/last buttons in addition to prev/next. */
  showEdges?: boolean;
  /** Label for the page-size select, e.g. "Rows". */
  pageSizeLabel?: string;
  disabled?: boolean;
}

const DEFAULT_SIZES = [25, 50, 100, 250];

/**
 * Table pager: page-size select, mono "1 to 50 of 1,204" and prev/next
 * buttons. Works with any source of pages; the DataTable wires it to its
 * pagination state.
 */
export const Pagination = forwardRef<HTMLDivElement, PaginationProps>(function Pagination(
  {
    pageIndex,
    pageSize,
    total,
    onPageIndexChange,
    onPageSizeChange,
    pageSizeOptions = DEFAULT_SIZES,
    showPageSize = true,
    showEdges = false,
    pageSizeLabel = "Rows",
    disabled = false,
    className,
    ...rest
  },
  ref,
) {
  const { pageCount } = pageRange(pageIndex, pageSize, total);
  const current = Math.min(Math.max(0, pageIndex), pageCount - 1);
  const canPrev = current > 0 && !disabled;
  const canNext = current < pageCount - 1 && !disabled;
  const sizes = pageSizeOptions.includes(pageSize)
    ? pageSizeOptions
    : [...pageSizeOptions, pageSize].sort((a, b) => a - b);

  return (
    <div
      ref={ref}
      role="navigation"
      aria-label="Pagination"
      className={cn("flex items-center gap-3 text-xs text-ink-2", className)}
      {...rest}
    >
      {showPageSize && onPageSizeChange ? (
        <label className="flex items-center gap-1.5">
          <span className="text-ink-3">{pageSizeLabel}</span>
          <Select
            size="sm"
            mono
            aria-label="Rows per page"
            value={String(pageSize)}
            disabled={disabled}
            onValueChange={(v) => onPageSizeChange(Number(v))}
            className="w-[68px]"
            contentWidth="auto"
          >
            {sizes.map((s) => (
              <SelectItem key={s} value={String(s)} className="font-mono text-xs">
                {int.format(s)}
              </SelectItem>
            ))}
          </Select>
        </label>
      ) : null}
      <output className="font-mono text-xs tabular text-ink-2" aria-live="polite">
        {formatPageRange(current, pageSize, total)}
      </output>
      <div className="flex items-center gap-0.5">
        {showEdges ? (
          <IconButton
            size="sm"
            label="First page"
            disabled={!canPrev}
            onClick={() => onPageIndexChange(0)}
          >
            <ChevronsLeft strokeWidth={1.75} />
          </IconButton>
        ) : null}
        <IconButton
          size="sm"
          label="Previous page"
          disabled={!canPrev}
          onClick={() => onPageIndexChange(current - 1)}
        >
          <ChevronLeft strokeWidth={1.75} />
        </IconButton>
        <IconButton
          size="sm"
          label="Next page"
          disabled={!canNext}
          onClick={() => onPageIndexChange(current + 1)}
        >
          <ChevronRight strokeWidth={1.75} />
        </IconButton>
        {showEdges ? (
          <IconButton
            size="sm"
            label="Last page"
            disabled={!canNext}
            onClick={() => onPageIndexChange(pageCount - 1)}
          >
            <ChevronsRight strokeWidth={1.75} />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
});
