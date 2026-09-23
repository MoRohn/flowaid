import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/primitives";
import {
  DEFAULT_SERIES_COLOR,
  deltaInfo,
  formatUnitValue,
  type ChartUnit,
  type DeltaInfo,
} from "./chartMath";
import { Sparkline } from "./Sparkline";
import { useMeasure } from "./useMeasure";

/** Below this content width the sparkline moves under the value and fills the tile. */
const STACK_BELOW = 200;

export type MetricTileSize = "sm" | "md" | "lg";

export interface MetricTileDelta {
  /** Previous-period value the current one is compared against. */
  previous: number;
  /** Name of the comparison period, e.g. "vs previous 7d". */
  periodLabel?: string;
}

export interface MetricTileProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  label: ReactNode;
  /** Current value. Numbers are formatted per `unit`; strings render as-is. */
  value: number | string;
  unit?: ChartUnit;
  /** Override the value formatting (e.g. "98.4%" from a ratio). */
  formatValue?: (value: number) => string;
  delta?: MetricTileDelta;
  /** Latency, cost, error rate: a drop is good. */
  lowerIsBetter?: boolean;
  /** Recent values for the inline sparkline. */
  trend?: readonly number[];
  /** Fixed sparkline domain, e.g. [0, 1] for rates. */
  trendDomain?: [number, number];
  size?: MetricTileSize;
  icon?: ReactNode;
  /** Small mono note under the value (a sample size, a P-level). */
  hint?: ReactNode;
  loading?: boolean;
  /** Accent ring for the selected tile in a drill-down grid. */
  selected?: boolean;
}

const VALUE_CLASS: Record<MetricTileSize, string> = {
  sm: "text-lg",
  md: "text-xl",
  lg: "text-2xl",
};

const SPARK_SIZE: Record<MetricTileSize, { width: number; height: number }> = {
  sm: { width: 72, height: 22 },
  md: { width: 96, height: 28 },
  lg: { width: 128, height: 36 },
};

/**
 * KPI tile: a label, a big mono value, a period-over-period delta and a
 * sparkline. The delta's tone depends on direction and on whether lower is
 * better, so a falling P95 reads green while a falling success rate reads red.
 */
export const MetricTile = forwardRef<HTMLDivElement, MetricTileProps>(function MetricTile(
  {
    label,
    value,
    unit = "count",
    formatValue,
    delta,
    lowerIsBetter = false,
    trend,
    trendDomain,
    size = "md",
    icon,
    hint,
    loading = false,
    selected = false,
    className,
    onClick,
    ...rest
  },
  ref,
) {
  const numeric = typeof value === "number" ? value : Number.NaN;
  const display =
    typeof value === "string"
      ? value
      : (formatValue ?? ((v: number) => formatUnitValue(v, unit)))(value);
  const info: DeltaInfo | null =
    delta && Number.isFinite(numeric)
      ? deltaInfo(numeric, delta.previous, { lowerIsBetter })
      : null;
  const interactive = typeof onClick === "function";
  const [bodyRef, body] = useMeasure<HTMLDivElement>();
  const stacked = body.width > 0 && body.width < STACK_BELOW;
  const spark = stacked ? { width: body.width, height: SPARK_SIZE[size].height } : SPARK_SIZE[size];
  const sparkNode =
    trend && trend.length > 1 ? (
      loading ? (
        <Skeleton width={spark.width} height={spark.height} />
      ) : (
        <Sparkline
          data={trend}
          width={spark.width}
          height={spark.height}
          domain={trendDomain}
          area
          color={info ? toneColor(info.tone) : DEFAULT_SERIES_COLOR}
        />
      )
    ) : null;

  return (
    <div
      ref={ref}
      data-size={size}
      data-layout={stacked ? "stacked" : "inline"}
      data-selected={selected || undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.currentTarget.click();
              }
            }
          : undefined
      }
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-md border border-border bg-surface text-ink shadow-1",
        size === "sm" ? "p-3" : "p-4",
        "transition-[box-shadow,border-color] duration-(--dur-base) ease-(--ease-out)",
        interactive && "cursor-pointer hover:border-border-strong hover:shadow-2",
        selected && "border-accent shadow-[0_0_0_3px_var(--accent-soft),var(--shadow-1)]",
        className,
      )}
      {...rest}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-ink-2">
        {icon ? (
          <span className="flex shrink-0 items-center text-ink-3 [&_svg]:size-3.5">{icon}</span>
        ) : null}
        <span className="truncate">{label}</span>
      </span>
      <div ref={bodyRef} className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          {loading ? (
            <Skeleton width={size === "lg" ? 120 : 88} height={size === "lg" ? 36 : 24} />
          ) : (
            <span
              className={cn(
                "truncate font-mono font-medium leading-none tracking-tight text-ink tabular",
                VALUE_CLASS[size],
              )}
            >
              {display}
            </span>
          )}
          {(info && !loading) || hint || delta?.periodLabel ? (
            <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              {info && !loading ? <DeltaChip info={info} unit={unit} /> : null}
              {hint || delta?.periodLabel ? (
                <span className="font-mono text-2xs text-ink-3 tabular">
                  {hint ?? delta?.periodLabel}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
        {!stacked ? sparkNode : null}
      </div>
      {stacked && sparkNode ? <div className="-mb-1">{sparkNode}</div> : null}
    </div>
  );
});

function toneColor(tone: DeltaInfo["tone"]): string {
  if (tone === "ok") return "var(--ok)";
  if (tone === "danger") return "var(--danger)";
  return DEFAULT_SERIES_COLOR;
}

export function DeltaChip({ info, unit }: { info: DeltaInfo; unit: ChartUnit }) {
  const Icon =
    info.direction === "up" ? ArrowUpRight : info.direction === "down" ? ArrowDownRight : Minus;
  const text = Number.isNaN(info.change)
    ? `${info.diff > 0 ? "+" : ""}${formatUnitValue(info.diff, unit)}`
    : unit === "percent"
      ? `${info.diff > 0 ? "+" : ""}${(info.diff * 100).toFixed(1)} pt`
      : `${info.change > 0 ? "+" : ""}${(info.change * 100).toFixed(1)}%`;
  return (
    <span
      data-tone={info.tone}
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center gap-0.5 rounded-xs px-1 font-mono text-2xs font-medium tabular",
        info.tone === "ok" && "bg-ok-soft text-ok-text",
        info.tone === "danger" && "bg-danger-soft text-danger-text",
        info.tone === "neutral" && "bg-surface-3 text-ink-2",
      )}
    >
      <Icon className="size-3" strokeWidth={2} aria-hidden="true" />
      <span className="sr-only">
        {info.direction === "flat" ? "unchanged" : info.direction === "up" ? "up" : "down"}
      </span>
      {text}
    </span>
  );
}
