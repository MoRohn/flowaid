import { forwardRef, useMemo, useState, type HTMLAttributes } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatMs, formatProbability } from "@/lib/format";
import { Badge } from "@/primitives/Badge";
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from "@/primitives/Collapsible";
import { BlockTitle } from "./badges";
import { menuFreshness, menuFunnel, menuHeadroom, splitMenu } from "./menu";
import type { JevOptionEntry, JevOptionSet } from "./types";
import { JEV_LIMITS, shortHash } from "./vocabulary";

export interface LiveMenuPreviewProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "onSelect"
> {
  optionSet: JevOptionSet;
  /** The contract's `maxAgeMs`; the set is stale when older at `now`. */
  maxAgeMs?: number;
  /** Reference time (ms since epoch) for the age; the set is shown without an age when omitted. */
  now?: number;
  /** Live options shown before the overflow disclosure. Escapes are always shown. */
  visibleLimit?: number;
  /** Distribution of a decision over this set, keyed by option key. */
  distribution?: Record<string, number>;
  /** Highlighted option key (the selected outcome). */
  selectedKey?: string | null;
  defaultExpanded?: boolean;
}

/**
 * A live option menu as built immediately before evaluation
 * (JEV_ENGINEERING.md §10, §VIII): the candidate funnel (original → kept →
 * eligible → shortlisted → sent) so a failure can be assigned to filtering,
 * shortlisting or the choice; model-facing keys with their source ids and
 * distinguishing descriptions; options past the visible limit fold into an
 * overflow; escape hatches are pinned and always present; age against the
 * contract's staleness limit and headroom under the 255-option limit.
 */
export const LiveMenuPreview = forwardRef<HTMLDivElement, LiveMenuPreviewProps>(
  function LiveMenuPreview(
    {
      optionSet,
      maxAgeMs = 60_000,
      now,
      visibleLimit = 6,
      distribution,
      selectedKey = null,
      defaultExpanded = false,
      className,
      ...rest
    },
    ref,
  ) {
    const [open, setOpen] = useState(defaultExpanded);
    const split = useMemo(
      () => splitMenu(optionSet.entries, visibleLimit),
      [optionSet.entries, visibleLimit],
    );
    const funnel = useMemo(() => menuFunnel(optionSet.counts), [optionSet.counts]);
    const fresh = now !== undefined ? menuFreshness(optionSet.builtAt, now, maxAgeMs) : null;
    const size = optionSet.entries.length;
    const funnelMax = Math.max(1, ...funnel.map((f) => f.value));

    const row = (e: JevOptionEntry) => {
      const p = distribution?.[e.key];
      const selected = selectedKey === e.key;
      return (
        <li
          key={e.key}
          data-key={e.key}
          data-selected={selected || undefined}
          className={cn(
            "grid grid-cols-[40px_1fr_auto] items-start gap-x-2 gap-y-0.5 px-3 py-2",
            selected && "bg-accent-soft",
          )}
        >
          <span
            className={cn("pt-px font-mono text-xs", e.escape ? "text-ink-3" : "text-accent-text")}
          >
            {e.key}
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-xs font-medium text-ink">{e.label ?? e.sourceId}</span>
              {e.escape ? (
                <Badge size="sm" tone="outline">
                  escape {e.escape}
                </Badge>
              ) : (
                <span className="truncate font-mono text-2xs text-ink-4">{e.sourceId}</span>
              )}
            </div>
            <p className="m-0 text-xs text-ink-2">{e.description}</p>
          </div>
          <div className="flex min-w-14 flex-col items-end gap-1">
            {p !== undefined ? (
              <>
                <span
                  className={cn("font-mono text-xs tabular", selected ? "text-ink" : "text-ink-3")}
                >
                  {formatProbability(p)}
                </span>
                <span
                  aria-hidden="true"
                  className="block h-1 w-14 overflow-hidden rounded-[2px] bg-surface-3"
                >
                  <span
                    className="block h-full"
                    style={{
                      width: `${Math.min(100, p * 100)}%`,
                      backgroundColor: selected ? "var(--p-1)" : "var(--p-2)",
                    }}
                  />
                </span>
              </>
            ) : null}
          </div>
        </li>
      );
    };

    return (
      <div ref={ref} className={cn("flex min-w-0 flex-col gap-4", className)} {...rest}>
        <header className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">Live menu</Badge>
          <span className="font-mono text-2xs text-ink-3">
            set #{shortHash(optionSet.version)} · built at seq {optionSet.builtAtSeq}
          </span>
          <span className="ml-auto flex items-center gap-2">
            {fresh && fresh.ageMs !== null ? (
              <Badge tone={fresh.stale ? "warn" : "neutral"} icon={<Clock />} mono>
                {formatMs(fresh.ageMs)} old{fresh.stale ? " · stale, rebuild" : ""}
              </Badge>
            ) : null}
            <span className="font-mono text-2xs text-ink-3 tabular">
              {size} / {JEV_LIMITS.maxChoiceOptions} options · {menuHeadroom(size)} headroom
            </span>
          </span>
        </header>

        <section className="flex flex-col gap-1.5" aria-label="Candidate funnel">
          <BlockTitle meta="code filters; Jev resolves the rest">Candidates</BlockTitle>
          <ol className="m-0 flex list-none flex-col gap-1 p-0">
            {funnel.map((f) => (
              <li
                key={f.key}
                className="grid grid-cols-[88px_1fr_88px] items-center gap-2 text-xs"
                data-step={f.key}
              >
                <span className="text-ink-2">{f.label}</span>
                <span
                  className="relative block h-2 overflow-hidden rounded-[2px] bg-surface-3"
                  aria-hidden="true"
                >
                  <span
                    className="absolute inset-y-0 left-0 rounded-[2px]"
                    style={{
                      width: `${(f.value / funnelMax) * 100}%`,
                      backgroundColor: f.key === "final" ? "var(--p-1)" : "var(--p-2)",
                    }}
                  />
                </span>
                <span className="text-right font-mono text-ink tabular">
                  {f.value.toLocaleString("en")}
                  {f.removed > 0 ? (
                    <span className="text-ink-4"> −{f.removed.toLocaleString("en")}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="flex flex-col gap-1.5" aria-label="Options">
          <BlockTitle
            meta={`${split.visible.length + split.overflow.length} live · ${split.escapes.length} escape${split.escapes.length === 1 ? "" : "s"}`}
          >
            Options
          </BlockTitle>
          <div className="overflow-hidden rounded-sm border border-border">
            <ul className="m-0 list-none divide-y divide-border p-0" aria-label="Live options">
              {split.visible.map(row)}
            </ul>
            {split.overflow.length > 0 ? (
              <CollapsibleRoot
                open={open}
                onOpenChange={setOpen}
                className="border-t border-border"
              >
                <CollapsibleContent className="pt-0">
                  <ul
                    className="m-0 list-none divide-y divide-border p-0"
                    aria-label="More options"
                  >
                    {split.overflow.map(row)}
                  </ul>
                </CollapsibleContent>
                <CollapsibleTrigger
                  noChevron
                  className="h-7 w-full justify-start px-3 text-2xs font-normal text-ink-3 hover:text-ink"
                  meta={
                    distribution
                      ? formatProbability(
                          split.overflow.reduce((s, e) => s + (distribution[e.key] ?? 0), 0),
                        )
                      : undefined
                  }
                >
                  {open ? "Show fewer" : `+${split.overflow.length} more options`}
                </CollapsibleTrigger>
              </CollapsibleRoot>
            ) : null}
            {split.escapes.length > 0 ? (
              <ul
                className="m-0 list-none divide-y divide-border border-t border-dashed border-border-strong bg-surface-2 p-0"
                aria-label="Escape outcomes"
              >
                {split.escapes.map(row)}
              </ul>
            ) : (
              <p
                role="alert"
                className="m-0 border-t border-border bg-danger-soft px-3 py-2 text-xs text-danger"
              >
                No escape outcome: a dynamic menu needs stop or review
                (E_JEV_DYNAMIC_MENU_NO_ESCAPE).
              </p>
            )}
          </div>
        </section>
      </div>
    );
  },
);
