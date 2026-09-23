import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import type { NodeCategory } from "@/lib/categories";
import type { RunEvent } from "@/types";
import {
  Badge,
  SearchInput,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
  useControllableState,
} from "@/primitives";
import {
  EVENT_FAMILIES,
  EVENT_FAMILY_LABEL,
  eventFamily,
  eventIsFailure,
  eventIsWarning,
  eventNodeId,
  eventPayload,
  summarizeEvent,
  type EventFamily,
} from "./summarizeEvent";
import { formatClock, stringifyCompact } from "./traceFormat";
import { TraceJsonBlock } from "./TraceJsonBlock";

export interface EventLogNodeInfo {
  name: string;
  category: NodeCategory;
}

export interface EventLogProps extends HTMLAttributes<HTMLDivElement> {
  events: RunEvent[];
  /** Node id → name/category, used to tint NODE_* badges by category and to name nodes in summaries. */
  nodes?: Record<string, EventLogNodeInfo>;
  /** Active family filters (controllable); empty means all. */
  families?: EventFamily[];
  defaultFamilies?: EventFamily[];
  onFamiliesChange?: (families: EventFamily[]) => void;
  /** Text search (controllable). */
  query?: string;
  defaultQuery?: string;
  onQueryChange?: (query: string) => void;
  /** Keep the newest event in view as events arrive (controllable). */
  tail?: boolean;
  defaultTail?: boolean;
  onTailChange?: (tail: boolean) => void;
  /** Whether the run is live; shows the tail switch. */
  live?: boolean;
  /** Rows above this count are virtualized. */
  virtualizeThreshold?: number;
  /** Height of the scrolling list. Defaults to filling the parent. */
  height?: number | string;
  noToolbar?: boolean;
}

export interface EventFilter {
  families?: readonly EventFamily[];
  query?: string;
  nodes?: Record<string, EventLogNodeInfo>;
}

/** Stable row key: durable events by `seq`, ephemeral ones (`seq` 0) by position. */
export function eventKey(event: RunEvent, index: number): string {
  return event.seq > 0 ? `seq:${event.seq}` : `ephemeral:${index}`;
}

/** Filter by family chips and a case-insensitive query over type, summary, node and payload. */
export function filterEvents(events: readonly RunEvent[], filter: EventFilter): RunEvent[] {
  const families =
    filter.families && filter.families.length > 0 ? new Set(filter.families) : undefined;
  const q = filter.query?.trim().toLowerCase();
  return events.filter((e) => {
    if (families && !families.has(eventFamily(e.type))) return false;
    if (!q) return true;
    const nodeId = eventNodeId(e);
    const nodeName = nodeId ? filter.nodes?.[nodeId]?.name : undefined;
    const hay = [
      e.type,
      String(e.seq),
      nodeId,
      nodeName,
      summarizeEvent(e, nodeName),
      stringifyCompact(eventPayload(e), 4000).text,
    ]
      .filter((s): s is string => typeof s === "string")
      .join("\n")
      .toLowerCase();
    return hay.includes(q);
  });
}

function EventBadge({ event, category }: { event: RunEvent; category?: NodeCategory }) {
  const family = eventFamily(event.type);
  const label = event.type;
  if (eventIsFailure(event.type)) {
    return (
      <Badge tone="danger" mono size="sm">
        {label}
      </Badge>
    );
  }
  if (eventIsWarning(event.type)) {
    return (
      <Badge tone="warn" mono size="sm">
        {label}
      </Badge>
    );
  }
  const byFamily: Partial<Record<EventFamily, NodeCategory>> = {
    decision: "decision",
    generation: "generation",
    tool: "tool",
    checkpoint: "state",
    human: "human",
    flow: "flow",
    loop: "flow",
    subflow: "flow",
    log: "developer",
  };
  const cat = family === "node" ? category : byFamily[family];
  if (cat) {
    return (
      <Badge category={cat} mono size="sm">
        {label}
      </Badge>
    );
  }
  return (
    <Badge tone={family === "run" ? "neutral" : "outline"} mono size="sm">
      {label}
    </Badge>
  );
}

const ROW_H = 28;

/**
 * The event-sourced view of a run: seq, time, type badge (coloured by family
 * and by node category), one-line summary and an expandable payload. Filter
 * chips by family, text search, virtualized above `virtualizeThreshold`, and
 * a "Tail" switch that follows new events while the run is live.
 */
export const EventLog = forwardRef<HTMLDivElement, EventLogProps>(function EventLog(
  {
    events,
    nodes,
    families,
    defaultFamilies = [],
    onFamiliesChange,
    query,
    defaultQuery = "",
    onQueryChange,
    tail,
    defaultTail = true,
    onTailChange,
    live = false,
    virtualizeThreshold = 200,
    height,
    noToolbar = false,
    className,
    ...rest
  },
  ref,
) {
  const [activeFamilies, setFamilies] = useControllableState(
    families,
    defaultFamilies,
    onFamiliesChange,
  );
  const [text, setText] = useControllableState(query, defaultQuery, onQueryChange);
  const [tailing, setTailing] = useControllableState(tail, defaultTail, onTailChange);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const filtered = useMemo(
    () => filterEvents(events, { families: activeFamilies, query: text, nodes }),
    [events, activeFamilies, text, nodes],
  );
  const counts = useMemo(() => {
    const c = new Map<EventFamily, number>();
    for (const e of events) {
      const f = eventFamily(e.type);
      c.set(f, (c.get(f) ?? 0) + 1);
    }
    return c;
  }, [events]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualize = filtered.length > virtualizeThreshold;
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 10,
    enabled: virtualize,
    getItemKey: (i) => {
      const e = filtered[i];
      return e ? eventKey(e, i) : i;
    },
  });

  const programmatic = useRef(false);
  useLayoutEffect(() => {
    if (!tailing || !live) return;
    const el = scrollRef.current;
    if (!el) return;
    programmatic.current = true;
    el.scrollTop = el.scrollHeight;
  }, [tailing, live, filtered.length]);
  const handleScroll = () => {
    if (programmatic.current) {
      programmatic.current = false;
      return;
    }
    const el = scrollRef.current;
    if (!el || !tailing || !live) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 48) setTailing(false);
  };

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const renderRow = (e: RunEvent, index: number, virtualStyle?: CSSProperties) => {
    const nodeId = eventNodeId(e);
    const info = nodeId ? nodes?.[nodeId] : undefined;
    const id = eventKey(e, index);
    const isOpen = expanded.has(id);
    const payload = eventPayload(e);
    const hasPayload = Object.keys(payload).length > 0;
    const failure = eventIsFailure(e.type);
    const onKey = (ev: KeyboardEvent<HTMLDivElement>) => {
      if (
        ev.key === "Enter" ||
        ev.key === " " ||
        ev.key === "ArrowRight" ||
        ev.key === "ArrowLeft"
      ) {
        if (!hasPayload) return;
        ev.preventDefault();
        if (ev.key === "ArrowRight" && isOpen) return;
        if (ev.key === "ArrowLeft" && !isOpen) return;
        toggle(id);
      }
    };
    return (
      <div
        key={id}
        data-index={index}
        ref={virtualize ? virtualizer.measureElement : undefined}
        style={virtualStyle}
        className={cn("border-t border-border", index === 0 && "border-t-0")}
      >
        <div
          role="row"
          tabIndex={0}
          aria-expanded={hasPayload ? isOpen : undefined}
          data-event-id={id}
          data-type={e.type}
          onClick={() => hasPayload && toggle(id)}
          onKeyDown={onKey}
          className={cn(
            "grid min-h-7 grid-cols-[40px_78px_minmax(0,1fr)] items-center gap-x-2.5 px-3 py-1 text-xs outline-none @[640px]:grid-cols-[40px_78px_max-content_minmax(0,1fr)]",
            "focus-visible:[box-shadow:inset_0_0_0_2px_var(--accent)]",
            hasPayload ? "cursor-pointer hover:bg-surface-2" : "cursor-default",
            failure && "bg-danger-soft/40",
          )}
        >
          <span className="text-right font-mono text-2xs text-ink-3 tabular">{e.seq}</span>
          <span className="font-mono text-2xs text-ink-3 tabular">{formatClock(e.at)}</span>
          <span className="col-start-3 row-start-2 @[640px]:row-start-1">
            <EventBadge event={e} category={info?.category} />
          </span>
          <span className="col-start-3 flex min-w-0 items-center gap-1.5 @[640px]:col-start-4">
            {hasPayload ? (
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-ink-3 transition-transform duration-(--dur-fast) ease-(--ease-out)",
                  isOpen && "rotate-90",
                )}
                strokeWidth={1.75}
                aria-hidden="true"
              />
            ) : (
              <span className="size-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className={cn("truncate", failure ? "text-danger-text" : "text-ink")}>
              {summarizeEvent(e, info?.name)}
            </span>
          </span>
        </div>
        {isOpen && hasPayload ? (
          <div className="px-3 pb-3 pl-[145px]">
            <TraceJsonBlock value={payload} label="payload" maxChars={1600} maxHeight={220} />
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div
      ref={ref}
      className={cn(
        "@container flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface shadow-1",
        className,
      )}
      {...rest}
    >
      {!noToolbar ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <ToggleGroup
            type="multiple"
            size="sm"
            value={activeFamilies}
            onValueChange={(v) =>
              setFamilies(
                v.filter((x): x is EventFamily =>
                  (EVENT_FAMILIES as readonly string[]).includes(x),
                ),
              )
            }
            aria-label="Event families"
            className="h-auto max-w-full flex-wrap [&>button]:h-5"
          >
            {EVENT_FAMILIES.filter((f) => (counts.get(f) ?? 0) > 0).map((f) => (
              <ToggleGroupItem key={f} value={f} aria-label={`${EVENT_FAMILY_LABEL[f]} events`}>
                {EVENT_FAMILY_LABEL[f]}
                <span className="font-mono text-2xs text-ink-3 tabular">{counts.get(f) ?? 0}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="ml-auto flex items-center gap-3">
            <SearchInput
              size="sm"
              value={text}
              onValueChange={setText}
              placeholder="Search events"
              aria-label="Search events"
              hint={
                <span className="font-mono tabular">
                  {filtered.length}/{events.length}
                </span>
              }
              className="w-44"
            />
            {live ? (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-2">
                Tail
                <Switch
                  size="sm"
                  checked={tailing}
                  onCheckedChange={setTailing}
                  aria-label="Tail new events"
                />
              </label>
            ) : null}
          </div>
        </div>
      ) : null}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="grid"
        aria-label="Run events"
        aria-rowcount={filtered.length}
        className="relative min-h-0 flex-1 overflow-auto"
        style={{ height: height ?? undefined }}
      >
        <div
          className="relative"
          style={virtualize ? { height: virtualizer.getTotalSize() } : undefined}
        >
          {virtualize
            ? virtualizer.getVirtualItems().map((v) => {
                const e = filtered[v.index];
                if (!e) return null;
                return renderRow(e, v.index, {
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${v.start}px)`,
                });
              })
            : filtered.map((e, i) => renderRow(e, i))}
        </div>
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-ink-3">
            {events.length === 0 ? "No events yet." : "No events match the current filter."}
          </p>
        ) : null}
      </div>
    </div>
  );
});
