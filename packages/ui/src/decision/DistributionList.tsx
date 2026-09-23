import { forwardRef, useMemo, useState, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { formatProbability } from "@/lib/format";
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from "@/primitives/Collapsible";
import {
  argmax,
  normalizeDistribution,
  type DistributionInput,
  type NormalizeOptions,
} from "./distribution";

export interface DistributionListProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  distribution: DistributionInput;
  /** Option key highlighted as the winner. Defaults to the most probable option. */
  chosen?: string;
  /** Label lookup for keys (a score legend). Keys are shown when absent. */
  labels?: Record<string, string>;
  /** Rows shown before the "+N more" disclosure. Omit to show every row. */
  maxRows?: number;
  density?: "compact" | "regular";
  /** Show the raw key in mono after the label when a label was substituted. */
  showKeys?: boolean;
  /** Start with the overflow rows expanded. */
  defaultExpanded?: boolean;
}

/**
 * Option rows sorted by probability: label, mono value and a thin bar.
 * The winner is set in ink over a `--p-1` bar; the rest are tertiary over
 * `--p-2`. Rows past `maxRows` fold into a "+N more" disclosure.
 */
export const DistributionList = forwardRef<HTMLDivElement, DistributionListProps>(
  function DistributionList(
    {
      distribution,
      chosen,
      labels,
      maxRows,
      density = "regular",
      showKeys = false,
      defaultExpanded = false,
      className,
      ...rest
    },
    ref,
  ) {
    const entries = useMemo(() => {
      const opts: NormalizeOptions = {};
      if (labels) opts.labels = labels;
      return normalizeDistribution(distribution, opts);
    }, [distribution, labels]);
    const winner = chosen ?? argmax(entries);
    const limit = maxRows !== undefined && maxRows >= 0 ? maxRows : entries.length;
    const visible = entries.slice(0, limit);
    const hidden = entries.slice(limit);
    const [open, setOpen] = useState(defaultExpanded);
    const compact = density === "compact";

    const renderRow = (e: (typeof entries)[number]) => {
      const isWinner = e.key === winner;
      const label = e.label ?? e.key;
      return (
        <li
          key={e.key}
          data-key={e.key}
          data-winner={isWinner || undefined}
          className={cn(
            "grid grid-cols-[1fr_auto] items-center",
            compact ? "gap-x-2 gap-y-[3px]" : "gap-x-3 gap-y-1",
          )}
        >
          <span
            className={cn(
              "flex min-w-0 items-baseline gap-1.5 truncate leading-none",
              compact ? "text-2xs" : "text-xs",
              isWinner ? "font-medium text-ink" : "text-ink-3",
            )}
          >
            <span className="truncate">{label}</span>
            {showKeys && label !== e.key ? (
              <span className="shrink-0 font-mono text-2xs text-ink-3">{e.key}</span>
            ) : null}
          </span>
          <span
            className={cn(
              "font-mono leading-none tabular",
              compact ? "text-2xs" : "text-xs",
              isWinner ? "text-ink" : "text-ink-3",
            )}
          >
            {formatProbability(e.probability)}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              "col-span-2 block w-full overflow-hidden rounded-[2px] bg-surface-3",
              compact ? "h-[3px]" : "h-1",
            )}
          >
            <span
              className="block h-full rounded-[2px] transition-[width] duration-(--dur-base) ease-(--ease-out)"
              style={{
                width: `${(e.probability * 100).toFixed(2)}%`,
                backgroundColor: isWinner ? "var(--p-1)" : "var(--p-2)",
              }}
            />
          </span>
        </li>
      );
    };

    return (
      <div ref={ref} className={cn("min-w-0", className)} {...rest}>
        <ul className={cn("m-0 list-none p-0", compact ? "space-y-1.5" : "space-y-2")}>
          {visible.map(renderRow)}
        </ul>
        {hidden.length > 0 ? (
          <CollapsibleRoot open={open} onOpenChange={setOpen} className="mt-1">
            <CollapsibleContent className="pt-0">
              <ul className={cn("m-0 list-none p-0", compact ? "space-y-1.5" : "space-y-2")}>
                {hidden.map(renderRow)}
              </ul>
            </CollapsibleContent>
            <CollapsibleTrigger
              noChevron
              className="mt-0.5 h-6 px-0 text-2xs font-normal text-ink-3 hover:bg-transparent hover:text-ink"
              meta={formatProbability(hidden.reduce((s, e) => s + e.probability, 0))}
            >
              {open ? "Show fewer" : `+${hidden.length} more`}
            </CollapsibleTrigger>
          </CollapsibleRoot>
        ) : null}
      </div>
    );
  },
);
