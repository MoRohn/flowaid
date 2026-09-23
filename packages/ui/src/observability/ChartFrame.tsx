import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { BarChart3 } from "lucide-react";
import { cn } from "@/lib/cn";
import { EmptyState, Skeleton, Spinner } from "@/primitives";
import { Legend, type LegendItem } from "./Legend";
import { useMeasure, type MeasuredSize } from "./useMeasure";

export interface ChartFrameProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "title" | "children"
> {
  title?: ReactNode;
  /** Mono uppercase line above the title. */
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  /** Unit label after the title in mono, e.g. "ms", "USD", "runs / h". */
  unit?: ReactNode;
  /** Right-side header slot for controls (toggles, a range select). */
  controls?: ReactNode;
  legend?: LegendItem[];
  legendPosition?: "top" | "bottom";
  hiddenSeries?: readonly string[];
  onToggleSeries?: (id: string) => void;
  /** Fixed plot height in px. Ignored when `aspect` is set. */
  height?: number;
  /** Width / height ratio for the plot area, e.g. 16 / 6. */
  aspect?: number;
  /**
   * First load shows a skeleton; a refetch (loading with data already shown)
   * keeps the previous render at reduced opacity so nothing jumps.
   */
  loading?: boolean;
  empty?: boolean;
  emptyTitle?: ReactNode;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
  /** Borderless: for frames that live inside another card. */
  flush?: boolean;
  /** Plot padding inside the frame body. */
  bodyClassName?: string;
  children?: ReactNode | ((size: MeasuredSize) => ReactNode);
}

/**
 * Card chrome for a chart: title row with unit and controls, a legend, and a
 * measured body the chart renders into. The body is a render-prop so charts
 * size themselves to the frame without a second ResizeObserver.
 */
export const ChartFrame = forwardRef<HTMLDivElement, ChartFrameProps>(function ChartFrame(
  {
    title,
    eyebrow,
    subtitle,
    unit,
    controls,
    legend,
    legendPosition = "top",
    hiddenSeries,
    onToggleSeries,
    height = 200,
    aspect,
    loading = false,
    empty = false,
    emptyTitle = "No data for this range",
    emptyDescription = "Widen the time range or pick another workflow.",
    emptyAction,
    flush = false,
    bodyClassName,
    className,
    children,
    ...rest
  },
  ref,
) {
  const [bodyRef, size] = useMeasure<HTMLDivElement>();
  const plotHeight = aspect ? Math.round(size.width / aspect) : height;
  const measured: MeasuredSize = { width: size.width, height: plotHeight };
  const hasHeader = title !== undefined || eyebrow !== undefined || controls !== undefined;
  const showLegend = legend !== undefined && legend.length > 1;
  const initialLoading = loading && empty;

  const legendNode = showLegend ? (
    <Legend
      items={legend}
      hiddenIds={hiddenSeries}
      onToggleItem={onToggleSeries}
      className={cn("px-4", legendPosition === "top" ? "pt-3" : "pb-3")}
    />
  ) : null;

  return (
    <section
      ref={ref}
      aria-busy={loading || undefined}
      className={cn(
        "flex min-w-0 flex-col text-ink",
        !flush && "rounded-md border border-border bg-surface shadow-1",
        className,
      )}
      {...rest}
    >
      {hasHeader ? (
        <header className="flex items-start justify-between gap-3 px-4 pt-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {eyebrow ? <span className="text-eyebrow">{eyebrow}</span> : null}
            {title !== undefined ? (
              <h3 className="flex min-w-0 items-baseline gap-2 text-sm font-semibold leading-tight tracking-tight text-ink">
                <span className="truncate">{title}</span>
                {unit ? (
                  <span className="shrink-0 font-mono text-2xs font-normal text-ink-3 tabular">
                    {unit}
                  </span>
                ) : null}
              </h3>
            ) : null}
            {subtitle ? <p className="text-xs text-ink-3">{subtitle}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {loading && !initialLoading ? <Spinner size="xs" label="Refreshing" /> : null}
            {controls}
          </div>
        </header>
      ) : null}
      {legendPosition === "top" ? legendNode : null}
      <div
        ref={bodyRef}
        className={cn("relative min-w-0 px-4 py-3", bodyClassName)}
        style={{ minHeight: plotHeight + 24 }}
      >
        {initialLoading ? (
          <div className="flex flex-col gap-2" style={{ height: plotHeight }}>
            <Skeleton className="flex-1" />
            <div className="flex justify-between">
              <Skeleton variant="text" width={40} />
              <Skeleton variant="text" width={40} />
              <Skeleton variant="text" width={40} />
            </div>
          </div>
        ) : empty ? (
          <div
            className="flex items-center justify-center rounded-sm bg-surface-2"
            style={{ height: plotHeight }}
          >
            <EmptyState
              size="sm"
              icon={<BarChart3 strokeWidth={1.75} />}
              title={emptyTitle}
              description={emptyDescription}
              primaryAction={emptyAction}
            />
          </div>
        ) : (
          <div
            className={cn(
              "transition-opacity duration-(--dur-base) ease-(--ease-out)",
              loading && "opacity-50",
            )}
          >
            {typeof children === "function"
              ? size.width > 0
                ? children(measured)
                : null
              : children}
          </div>
        )}
      </div>
      {legendPosition === "bottom" ? legendNode : null}
    </section>
  );
});
