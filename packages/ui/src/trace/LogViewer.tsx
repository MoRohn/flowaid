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
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { WrapText } from "lucide-react";
import { cn } from "@/lib/cn";
import type { LogLevel, LogLineView } from "@/types";
import {
  CopyButton,
  SearchInput,
  Select,
  SelectItem,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  useControllableState,
} from "@/primitives";
import { formatClock, stringifyCompact } from "./traceFormat";

export const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

export interface LogViewerProps extends HTMLAttributes<HTMLDivElement> {
  lines: LogLineView[];
  /** Node id → display name for the node column and filter. */
  nodeNames?: Record<string, string>;
  /** Visible levels (controllable); empty means all. */
  levels?: LogLevel[];
  defaultLevels?: LogLevel[];
  onLevelsChange?: (levels: LogLevel[]) => void;
  query?: string;
  defaultQuery?: string;
  onQueryChange?: (query: string) => void;
  /** Node filter (controllable); undefined means all nodes. */
  nodeId?: string;
  defaultNodeId?: string;
  onNodeIdChange?: (nodeId: string | undefined) => void;
  wrap?: boolean;
  defaultWrap?: boolean;
  onWrapChange?: (wrap: boolean) => void;
  /**
   * Keep the newest line in view as lines arrive (controllable). Scrolling up by more than a
   * couple of rows turns it off; only applies while `live`.
   */
  tail?: boolean;
  defaultTail?: boolean;
  onTailChange?: (tail: boolean) => void;
  /** Whether the run is live; shows the tail switch. */
  live?: boolean;
  /** Lines above this count are virtualized (the same default as `EventLog`). */
  virtualizeThreshold?: number;
  height?: number | string;
  noToolbar?: boolean;
  /** Extra toolbar content. */
  toolbar?: ReactNode;
}

export interface LogSegment {
  text: string;
  match: boolean;
}

/** Split `text` into segments, marking case-insensitive matches of `query`. */
export function highlightMatches(text: string, query: string): LogSegment[] {
  const q = query.trim();
  if (!q) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: LogSegment[] = [];
  let i = 0;
  for (;;) {
    const at = lower.indexOf(needle, i);
    if (at === -1) break;
    if (at > i) out.push({ text: text.slice(i, at), match: false });
    out.push({ text: text.slice(at, at + needle.length), match: true });
    i = at + needle.length;
  }
  if (i < text.length) out.push({ text: text.slice(i), match: false });
  return out.length ? out : [{ text, match: false }];
}

export interface LogFilter {
  levels?: readonly LogLevel[];
  query?: string;
  nodeId?: string;
}

/** Filter by level set, node and a case-insensitive query over the message and data. */
export function filterLogLines(lines: readonly LogLineView[], filter: LogFilter): LogLineView[] {
  const levels = filter.levels && filter.levels.length > 0 ? new Set(filter.levels) : undefined;
  const q = filter.query?.trim().toLowerCase();
  return lines.filter((l) => {
    if (levels && !levels.has(l.level)) return false;
    if (filter.nodeId && l.nodeId !== filter.nodeId) return false;
    if (!q) return true;
    const hay =
      `${l.message}\n${l.data !== undefined ? stringifyCompact(l.data, 4000).text : ""}`.toLowerCase();
    return hay.includes(q);
  });
}

/** Plain-text rendering of log lines, for copying. */
export function logLinesToText(
  lines: readonly LogLineView[],
  nodeNames?: Record<string, string>,
): string {
  return lines
    .map((l) => {
      const node = l.nodeId ? (nodeNames?.[l.nodeId] ?? l.nodeId) : "";
      const data =
        l.data !== undefined
          ? ` ${stringifyCompact(l.data, Number.POSITIVE_INFINITY).text.replace(/\s*\n\s*/g, " ")}`
          : "";
      return `${formatClock(l.at)} ${l.level.toUpperCase().padEnd(5)} ${node ? `[${node}] ` : ""}${l.message}${data}`;
    })
    .join("\n");
}

const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: "text-ink-3",
  info: "text-ink",
  warn: "text-warn-text",
  error: "text-danger-text",
};

const ALL_NODES = "__all__";
/** Estimated height of one unwrapped line (11px mono at 1.6 leading); rows are measured. */
const ROW_H = 18;
/** Distance from the bottom (px) beyond which a user scroll turns tailing off. */
const TAIL_SLACK = 48;

/**
 * Mono log lines with level colours (debug ink-3, info ink, warn, error),
 * a level filter with counts, node filter, text search with highlighted
 * matches, wrap toggle and "copy all" (copies the filtered lines). Long logs are
 * virtualized above `virtualizeThreshold` lines (rows measured, so wrapped and expanded
 * lines keep their height); while `live`, tail keeps the newest line in view.
 */
export const LogViewer = forwardRef<HTMLDivElement, LogViewerProps>(function LogViewer(
  {
    lines,
    nodeNames,
    levels,
    defaultLevels = [],
    onLevelsChange,
    query,
    defaultQuery = "",
    onQueryChange,
    nodeId,
    defaultNodeId,
    onNodeIdChange,
    wrap,
    defaultWrap = true,
    onWrapChange,
    tail,
    defaultTail = true,
    onTailChange,
    live = false,
    virtualizeThreshold = 200,
    height,
    noToolbar = false,
    toolbar,
    className,
    ...rest
  },
  ref,
) {
  const [activeLevels, setLevels] = useControllableState(levels, defaultLevels, onLevelsChange);
  const [text, setText] = useControllableState(query, defaultQuery, onQueryChange);
  const [node, setNode] = useControllableState<string | undefined>(
    nodeId,
    defaultNodeId,
    onNodeIdChange,
  );
  const [wrapping, setWrapping] = useControllableState(wrap, defaultWrap, onWrapChange);
  const [tailing, setTailing] = useControllableState(tail, defaultTail, onTailChange);
  const [openData, setOpenData] = useState<ReadonlySet<number>>(() => new Set());

  const filtered = useMemo(
    () => filterLogLines(lines, { levels: activeLevels, query: text, nodeId: node }),
    [lines, activeLevels, text, node],
  );
  const counts = useMemo(() => {
    const c: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
    for (const l of lines) c[l.level] += 1;
    return c;
  }, [lines]);
  // Position of each line in `lines`: the stable key for its expanded-data state.
  const lineIndex = useMemo(() => new Map(lines.map((l, i) => [l, i] as const)), [lines]);
  const nodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const l of lines) if (l.nodeId) ids.add(l.nodeId);
    return [...ids];
  }, [lines]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualize = filtered.length > virtualizeThreshold;
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
    enabled: virtualize,
    getItemKey: (i) => {
      const l = filtered[i];
      return l ? (lineIndex.get(l) ?? i) : i;
    },
  });

  // Tail: keep the last line in view while live. A virtualized list scrolls to its last item
  // (its rows are measured lazily, so scrollHeight alone can undershoot).
  const programmatic = useRef(false);
  useLayoutEffect(() => {
    if (!tailing || !live || filtered.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    programmatic.current = true;
    if (virtualize) virtualizer.scrollToIndex(filtered.length - 1, { align: "end" });
    else el.scrollTop = el.scrollHeight;
  }, [tailing, live, filtered.length, virtualize, virtualizer]);
  const handleScroll = () => {
    if (programmatic.current) {
      programmatic.current = false;
      return;
    }
    const el = scrollRef.current;
    if (!el || !tailing || !live) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > TAIL_SLACK) setTailing(false);
  };

  const toggleData = useCallback((key: number) => {
    setOpenData((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const renderLine = (l: LogLineView, index: number, virtualStyle?: CSSProperties) => {
    const key = lineIndex.get(l) ?? index;
    const hasData = l.data !== undefined;
    const open = openData.has(key);
    const nodeLabel = l.nodeId ? (nodeNames?.[l.nodeId] ?? l.nodeId) : undefined;
    // A line with structured data toggles its payload; it is a keyboard-reachable
    // button (Enter/Space) with aria-expanded, not a mouse-only div.
    const onToggleKey = (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleData(key);
      }
    };
    return (
      <div
        key={key}
        data-index={index}
        ref={virtualize ? virtualizer.measureElement : undefined}
        style={virtualStyle}
        data-level={l.level}
        className={cn(
          "grid grid-cols-[86px_44px_minmax(0,1fr)] gap-x-2 px-3 hover:bg-surface-3/60",
          hasData &&
            "cursor-pointer focus-visible:bg-surface-3/60 focus-visible:outline-none focus-visible:shadow-(--focus)",
        )}
        role={hasData ? "button" : undefined}
        tabIndex={hasData ? 0 : undefined}
        aria-expanded={hasData ? open : undefined}
        onClick={hasData ? () => toggleData(key) : undefined}
        onKeyDown={hasData ? onToggleKey : undefined}
      >
        <span className="text-ink-3">{formatClock(l.at)}</span>
        <span
          className={cn("uppercase", LEVEL_CLASS[l.level], l.level === "debug" && "text-ink-3")}
        >
          {l.level}
        </span>
        <span
          className={cn(
            "min-w-0",
            LEVEL_CLASS[l.level],
            wrapping ? "whitespace-pre-wrap break-words" : "whitespace-pre",
          )}
        >
          {nodeLabel ? <span className="text-ink-3">[{nodeLabel}] </span> : null}
          {highlightMatches(l.message, text).map((seg, j) =>
            seg.match ? (
              <mark
                key={j}
                className="rounded-[2px] bg-warn-soft text-warn-text ring-1 ring-warn/40"
              >
                {seg.text}
              </mark>
            ) : (
              <span key={j}>{seg.text}</span>
            ),
          )}
          {hasData ? <span className="ml-1.5 text-ink-3">{open ? "" : "{…}"}</span> : null}
          {hasData && open ? (
            <span className="block whitespace-pre-wrap break-words text-ink-3">
              {stringifyCompact(l.data, 1200).text}
            </span>
          ) : null}
        </span>
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
            value={activeLevels}
            onValueChange={(v) =>
              setLevels(
                v.filter((x): x is LogLevel => (LOG_LEVELS as readonly string[]).includes(x)),
              )
            }
            aria-label="Log levels"
          >
            {LOG_LEVELS.map((lvl) => (
              <ToggleGroupItem
                key={lvl}
                value={lvl}
                aria-label={`${lvl} lines`}
                className="font-mono"
              >
                <span
                  className={cn(
                    lvl === "warn" && "text-warn-text",
                    lvl === "error" && "text-danger-text",
                  )}
                >
                  {lvl}
                </span>
                <span className="text-2xs text-ink-3 tabular">{counts[lvl]}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {nodeIds.length > 0 ? (
            <Select
              size="sm"
              mono
              value={node ?? ALL_NODES}
              onValueChange={(v) => setNode(v === ALL_NODES ? undefined : v)}
              aria-label="Filter by node"
              className="w-40"
              contentWidth="auto"
            >
              <SelectItem value={ALL_NODES}>All nodes</SelectItem>
              {nodeIds.map((id) => (
                <SelectItem key={id} value={id}>
                  {nodeNames?.[id] ?? id}
                </SelectItem>
              ))}
            </Select>
          ) : null}
          <div className="ml-auto flex items-center gap-1.5">
            {toolbar}
            <SearchInput
              size="sm"
              value={text}
              onValueChange={setText}
              placeholder="Search logs"
              aria-label="Search logs"
              hint={
                <span className="font-mono tabular">
                  {filtered.length}/{lines.length}
                </span>
              }
              className="w-44"
            />
            <ToggleGroup
              type="single"
              size="sm"
              value={wrapping ? "wrap" : ""}
              onValueChange={(v) => setWrapping(v === "wrap")}
              aria-label="Wrap lines"
            >
              <Tooltip content="Wrap long lines">
                <ToggleGroupItem value="wrap" aria-label="Wrap long lines">
                  <WrapText strokeWidth={1.75} aria-hidden="true" />
                </ToggleGroupItem>
              </Tooltip>
            </ToggleGroup>
            <CopyButton
              value={() => logLinesToText(filtered, nodeNames)}
              label="Copy all"
              size="sm"
            />
            {live ? (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-2">
                Tail
                <Switch
                  size="sm"
                  checked={tailing}
                  onCheckedChange={setTailing}
                  aria-label="Tail new lines"
                />
              </label>
            ) : null}
          </div>
        </div>
      ) : null}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-label="Run logs"
        className={cn(
          "min-h-0 flex-1 overflow-auto bg-surface-2 py-1 font-mono text-2xs leading-[1.6] tabular",
          !wrapping && "overflow-x-auto",
        )}
        style={{ height: height ?? undefined }}
      >
        <div
          className="relative"
          style={virtualize ? { height: virtualizer.getTotalSize() } : undefined}
        >
          {virtualize
            ? virtualizer.getVirtualItems().map((v) => {
                const l = filtered[v.index];
                if (!l) return null;
                return renderLine(l, v.index, {
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${v.start}px)`,
                });
              })
            : filtered.map((l, i) => renderLine(l, i))}
        </div>
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center font-sans text-xs text-ink-3">
            {lines.length === 0 ? "No log lines." : "No lines match the current filter."}
          </p>
        ) : null}
      </div>
    </div>
  );
});
