import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, Repeat } from "lucide-react";
import { cn } from "@/lib/cn";
import { categoryVar } from "@/lib/categories";
import { formatCost, formatMs, formatTokens } from "@/lib/format";
import type { NodeRunView, RunView } from "@/types";
import { assertNever } from "@/types";
import { Badge, CategoryDot, Hint, StatusChip, Switch, useControllableState } from "@/primitives";
import { buildTraceRows, type TraceGroupRow, type TraceNodeRow, type TraceRow } from "./traceRows";
import {
  nodeRunWindow,
  runTimeScale,
  spanGeometry,
  formatOffset,
  toMs,
  type TimeScale,
} from "./timeScale";
import { TraceTimeRuler } from "./TraceTimeRuler";
import { TraceDecisionDetail } from "./TraceDecisionDetail";
import { TraceJsonBlock } from "./TraceJsonBlock";
import { useNow } from "./useNow";

export interface TraceTimelineProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  run: RunView;
  /** Highlighted node run (accent-soft). */
  selectedNodeRunId?: string;
  /** Fired on click and on Enter. */
  onSelectNode?: (nodeRun: NodeRunView) => void;
  /** Running spans grow to "now" and the ruler shows a live marker. Defaults to the run status. */
  live?: boolean;
  /** Auto-scroll to the newest row while live (controllable). */
  follow?: boolean;
  defaultFollow?: boolean;
  onFollowChange?: (follow: boolean) => void;
  /** Clock override in epoch ms (tests, snapshots). */
  now?: number;
  /** Iteration totals per loop node run id, for "Iteration 3 of 10". */
  loopTotals?: Record<string, number>;
  /** Expanded row ids (controllable). */
  expandedIds?: string[];
  defaultExpandedIds?: string[];
  onExpandedChange?: (ids: string[]) => void;
  /** Rows above this count are virtualized. */
  virtualizeThreshold?: number;
  /** Hide the header toolbar (row count, follow switch). */
  noToolbar?: boolean;
  /** Extra content in the toolbar, right-aligned before the follow switch. */
  toolbar?: ReactNode;
  /** Height of the scrolling area. Defaults to filling the parent. */
  height?: number | string;
}

const GRID =
  "grid items-center gap-x-2.5 px-3 grid-cols-[56px_8px_minmax(0,1fr)_60px_16px] @[640px]:grid-cols-[64px_8px_minmax(160px,280px)_minmax(0,1fr)_72px_16px]";
const ROW_H = 30;

function isRunLive(status: RunView["status"]): boolean {
  return (
    status === "starting" || status === "running" || status === "retrying" || status === "waiting"
  );
}

/** Whether a node row has inline detail to expand. */
export function traceRowIsExpandable(row: TraceRow): boolean {
  if (row.kind === "group") return true;
  const n = row.nodeRun;
  return Boolean(
    n.decision ||
    n.toolCall ||
    n.error ||
    n.routeTaken ||
    row.attempts.length > 1 ||
    n.output !== undefined ||
    (n.logs && n.logs.length > 0),
  );
}

function statusLabelFor(nodeRun: NodeRunView, nowMs: number): string {
  switch (nodeRun.status) {
    case "waiting":
      return "waiting";
    case "retry_wait":
      return "retry";
    case "pending":
      return "pending";
    case "skipped":
      return "skipped";
    case "cancelled":
      return "cancelled";
    case "reused":
      return "reused";
    case "running": {
      const w = nodeRunWindow(nodeRun, nowMs);
      return w ? `${formatMs(w.endMs - w.startMs)}…` : "…";
    }
    case "completed":
    case "failed":
      return nodeRun.durationMs !== undefined ? formatMs(nodeRun.durationMs) : "—";
    default:
      return assertNever(nodeRun.status, "node run status");
  }
}

function Segment({
  attempt,
  scale,
  nowMs,
  isLatest,
  category,
}: {
  attempt: NodeRunView;
  scale: TimeScale;
  nowMs: number;
  isLatest: boolean;
  category: NodeRunView["category"];
}) {
  const w = nodeRunWindow(attempt, nowMs);
  if (!w) return null;
  const g = spanGeometry(w.startMs, w.endMs, scale);
  const color = categoryVar(category);
  const failed = attempt.status === "failed";
  const reused = attempt.status === "reused";
  const waiting = attempt.status === "waiting" || attempt.status === "retry_wait";
  const active = attempt.status === "running";
  const style: CSSProperties = {
    left: `${g.left}%`,
    width: `max(2px, ${g.width}%)`,
    color,
  };
  if (failed) {
    style.backgroundImage = `repeating-linear-gradient(135deg, ${color} 0 2px, transparent 2px 5px)`;
    style.opacity = 0.7;
  } else if (waiting) {
    style.backgroundImage = `repeating-linear-gradient(90deg, ${color} 0 3px, transparent 3px 6px)`;
    style.opacity = 0.75;
  } else if (reused) {
    // A cached result: green dashed outline, no fill (UI.md §4.3).
    style.color = "var(--ok)";
    style.border = "1px dashed var(--ok)";
    style.backgroundColor = "transparent";
    style.opacity = 0.9;
  } else {
    style.backgroundColor = color;
    style.opacity = isLatest ? 0.85 : 0.5;
  }
  return (
    <Hint
      hint={`Attempt ${attempt.attempt} · ${attempt.status} · ${formatMs(w.endMs - w.startMs)}`}
      data-attempt={attempt.attempt}
      data-status={attempt.status}
      className={cn(
        "absolute top-1/2 h-1.5 -translate-y-1/2 rounded-[3px]",
        active && "fa-shimmer",
      )}
      style={style}
    />
  );
}

function NodeDetail({ row, nowMs }: { row: TraceNodeRow; nowMs: number }) {
  const n = row.nodeRun;
  const blocks: ReactNode[] = [];
  if (n.error) {
    blocks.push(
      <p key="error" className="flex min-w-0 items-start gap-2 text-xs text-danger-text">
        <Badge tone="danger" size="sm" mono>
          {n.error.code}
        </Badge>
        <span className="min-w-0 break-words">{n.error.message}</span>
        {n.error.retryable ? (
          <span className="ml-auto shrink-0 font-mono text-2xs text-ink-3">retryable</span>
        ) : null}
      </p>,
    );
  }
  if (n.routeTaken) {
    blocks.push(
      <p key="route" className="font-mono text-xs text-ink-2">
        <span className="text-ink-3">route </span>→ {n.routeTaken}
      </p>,
    );
  }
  if (n.decision) blocks.push(<TraceDecisionDetail key="decision" decision={n.decision} />);
  if (n.toolCall) {
    const tc = n.toolCall;
    const code = tc.statusCode;
    const tone =
      code === undefined ? "neutral" : code < 300 ? "ok" : code < 500 ? "warn" : "danger";
    blocks.push(
      <div key="tool" className="flex min-w-0 flex-col gap-2">
        <p className="flex flex-wrap items-center gap-2 font-mono text-xs tabular">
          <span className="text-ink">{tc.name}</span>
          {code !== undefined ? (
            <Badge tone={tone} size="sm" mono>
              {code}
            </Badge>
          ) : null}
          {tc.durationMs !== undefined ? (
            <span className="text-ink-3">{formatMs(tc.durationMs)}</span>
          ) : null}
        </p>
        <div className="grid min-w-0 gap-2 @[720px]:grid-cols-2">
          <TraceJsonBlock label="args" value={tc.args} maxChars={800} maxHeight={160} />
          {tc.result !== undefined ? (
            <TraceJsonBlock label="result" value={tc.result} maxChars={800} maxHeight={160} />
          ) : null}
        </div>
      </div>,
    );
  }
  if (row.attempts.length > 1) {
    blocks.push(
      <ul key="attempts" className="flex flex-col gap-0.5 font-mono text-2xs text-ink-3 tabular">
        {row.attempts.map((a, i) => {
          const prev = row.attempts[i - 1];
          const gap =
            prev && prev.endedAt && a.startedAt
              ? (toMs(a.startedAt) ?? 0) - (toMs(prev.endedAt) ?? 0)
              : undefined;
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-x-2">
              <span className="text-ink-2">attempt {a.attempt}</span>
              <span className={a.status === "failed" ? "text-danger-text" : undefined}>
                {a.status}
              </span>
              <span>{statusLabelFor(a, nowMs)}</span>
              {gap !== undefined && gap > 0 ? <span>after {formatMs(gap)} back-off</span> : null}
              {a.error ? (
                <span className="truncate text-danger-text">{a.error.message}</span>
              ) : null}
            </li>
          );
        })}
      </ul>,
    );
  }
  if (!n.decision && !n.toolCall && n.output !== undefined) {
    blocks.push(
      <TraceJsonBlock
        key="output"
        label="output"
        value={n.output}
        maxChars={600}
        maxHeight={160}
      />,
    );
  }
  if (n.usage || n.costUsd !== undefined) {
    blocks.push(
      <p key="usage" className="flex flex-wrap gap-x-3 font-mono text-2xs text-ink-3 tabular">
        {n.usage ? <span>{formatTokens(n.usage.inputTokens)} in</span> : null}
        {n.usage ? <span>{formatTokens(n.usage.outputTokens)} out</span> : null}
        {n.costUsd !== undefined ? <span>{formatCost(n.costUsd)}</span> : null}
      </p>,
    );
  }
  if (blocks.length === 0) return null;
  return (
    <div
      data-testid="trace-row-detail"
      className={cn(GRID, "items-start border-t border-transparent pb-3 pt-1")}
    >
      <div
        className="col-start-3 -col-end-1 flex min-w-0 flex-col gap-2.5"
        style={{ paddingLeft: row.depth * 12 }}
      >
        {blocks}
      </div>
    </div>
  );
}

function GroupSpan({ row, scale, nowMs }: { row: TraceGroupRow; scale: TimeScale; nowMs: number }) {
  const start = toMs(row.startedAt);
  if (start === undefined) return null;
  const end = toMs(row.endedAt) ?? nowMs;
  const g = spanGeometry(start, end, scale);
  return (
    <span
      className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-[3px] border border-border-strong bg-surface-3/60"
      style={{ left: `${g.left}%`, width: `max(2px, ${g.width}%)` }}
    />
  );
}

/**
 * Distributed-trace waterfall of a run's node runs. Rows are scaled to the
 * run's duration under a sticky ruler; retries stack as segments (failed
 * attempts hatched), loop iterations nest as collapsible groups, and decision
 * / tool / failed rows expand inline. Keyboard: ↑↓ move, →← expand/collapse,
 * Enter selects. Virtualized above `virtualizeThreshold` rows; "Follow"
 * keeps the newest row in view while the run is live.
 */
export const TraceTimeline = forwardRef<HTMLDivElement, TraceTimelineProps>(function TraceTimeline(
  {
    run,
    selectedNodeRunId,
    onSelectNode,
    live,
    follow,
    defaultFollow = true,
    onFollowChange,
    now,
    loopTotals,
    expandedIds,
    defaultExpandedIds = [],
    onExpandedChange,
    virtualizeThreshold = 200,
    noToolbar = false,
    toolbar,
    height,
    className,
    style,
    onKeyDown,
    ...rest
  },
  ref,
) {
  const isLive = live ?? isRunLive(run.status);
  const nowMs = useNow(isLive, 250, now);
  const [following, setFollowing] = useControllableState(follow, defaultFollow, onFollowChange);
  const [expandedList, setExpandedList] = useControllableState(
    expandedIds,
    defaultExpandedIds,
    onExpandedChange,
  );
  const expanded = useMemo(() => new Set(expandedList), [expandedList]);
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set());

  const scale = useMemo(() => runTimeScale(run, nowMs), [run, nowMs]);
  const rows = useMemo(
    () => buildTraceRows(run.nodeRuns, { collapsed: collapsedGroups, loopTotals }),
    [run.nodeRuns, collapsedGroups, loopTotals],
  );
  const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r.id, i] as const)), [rows]);

  const [activeId, setActiveId] = useState<string | undefined>(selectedNodeRunId);
  const resolvedActive = activeId && rowIndex.has(activeId) ? activeId : (rows[0]?.id ?? undefined);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualize = rows.length > virtualizeThreshold;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
    enabled: virtualize,
    getItemKey: (i) => rows[i]?.id ?? i,
  });

  const setExpanded = useCallback(
    (id: string, open: boolean) => {
      const next = new Set(expandedList);
      if (open) next.add(id);
      else next.delete(id);
      setExpandedList([...next]);
    },
    [expandedList, setExpandedList],
  );
  const toggleGroup = useCallback((id: string, collapse: boolean) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (collapse) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // Move focus to the active row once it exists in the DOM.
  const pendingFocus = useRef(false);
  useEffect(() => {
    if (!pendingFocus.current || !resolvedActive) return;
    const idx = rowIndex.get(resolvedActive);
    if (virtualize && idx !== undefined) virtualizer.scrollToIndex(idx, { align: "auto" });
    const raf = requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector<HTMLElement>(
        `[data-row-id="${CSS.escape(resolvedActive)}"]`,
      );
      el?.focus({ preventScroll: virtualize });
      if (!virtualize) el?.scrollIntoView({ block: "nearest" });
      pendingFocus.current = false;
    });
    return () => cancelAnimationFrame(raf);
  }, [resolvedActive, rowIndex, virtualize, virtualizer]);

  // Follow: keep the bottom in view while live.
  const programmatic = useRef(false);
  useLayoutEffect(() => {
    if (!isLive || !following) return;
    const el = scrollRef.current;
    if (!el) return;
    programmatic.current = true;
    el.scrollTop = el.scrollHeight;
  }, [isLive, following, rows.length, nowMs]);
  const handleScroll = () => {
    if (programmatic.current) {
      programmatic.current = false;
      return;
    }
    const el = scrollRef.current;
    if (!el || !isLive || !following) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance > 48) setFollowing(false);
  };

  const activate = (row: TraceRow) => {
    if (row.kind === "node") onSelectNode?.(row.nodeRun);
  };
  const toggle = (row: TraceRow) => {
    if (row.kind === "group") toggleGroup(row.id, !row.collapsed);
    else if (traceRowIsExpandable(row)) setExpanded(row.id, !expanded.has(row.id));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || !resolvedActive) return;
    const idx = rowIndex.get(resolvedActive) ?? 0;
    const row = rows[idx];
    if (!row) return;
    const move = (to: number) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (!target) return;
      pendingFocus.current = true;
      setActiveId(target.id);
    };
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(idx + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(idx - 1);
        break;
      case "Home":
        e.preventDefault();
        move(0);
        break;
      case "End":
        e.preventDefault();
        move(rows.length - 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (row.kind === "group") {
          if (row.collapsed) toggleGroup(row.id, false);
          else move(idx + 1);
        } else if (traceRowIsExpandable(row) && !expanded.has(row.id)) setExpanded(row.id, true);
        else if (row.hasChildren) move(idx + 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (row.kind === "group" && !row.collapsed) toggleGroup(row.id, true);
        else if (row.kind === "node" && expanded.has(row.id)) setExpanded(row.id, false);
        else {
          // climb to the parent row
          for (let i = idx - 1; i >= 0; i -= 1) {
            const cand = rows[i];
            if (cand && cand.depth < row.depth) {
              move(i);
              break;
            }
          }
        }
        break;
      case "Enter":
        e.preventDefault();
        activate(row);
        break;
      case " ":
        e.preventDefault();
        toggle(row);
        break;
      default:
        return;
    }
    if (following && ["ArrowUp", "Home"].includes(e.key)) setFollowing(false);
  };

  const handleClick = (row: TraceRow) => (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button, a, input, [data-no-row-click]")) return;
    setActiveId(row.id);
    toggle(row);
    activate(row);
  };

  const renderRow = (row: TraceRow, index: number, virtualStyle?: CSSProperties) => {
    const isActive = row.id === resolvedActive;
    const isSelected = row.kind === "node" && row.nodeRun.id === selectedNodeRunId;
    const isOpen = row.kind === "group" ? !row.collapsed : expanded.has(row.id);
    const expandable = traceRowIsExpandable(row);
    const indent = row.depth * 12;
    const common = {
      role: "treeitem" as const,
      "aria-level": row.depth + 1,
      "aria-selected": isSelected || undefined,
      "aria-expanded": expandable ? isOpen : undefined,
      tabIndex: isActive ? 0 : -1,
      "data-row-id": row.id,
      "data-active": isActive || undefined,
      onClick: handleClick(row),
      onFocus: () => setActiveId(row.id),
      className: cn(
        GRID,
        "group/row relative h-[30px] cursor-default select-none border-t border-border text-xs outline-none",
        "focus-visible:[box-shadow:inset_0_0_0_2px_var(--accent)]",
        isSelected ? "bg-accent-soft" : "hover:bg-surface-2",
        index === 0 && "border-t-0",
      ),
    };

    if (row.kind === "group") {
      return (
        <div
          key={row.id}
          data-index={index}
          ref={virtualize ? virtualizer.measureElement : undefined}
          style={virtualStyle}
        >
          <div {...common} data-group-id={row.id}>
            <span className="text-right font-mono text-2xs text-ink-3 tabular">
              {row.startedAt
                ? formatOffset((toMs(row.startedAt) ?? scale.originMs) - scale.originMs)
                : ""}
            </span>
            <span className="flex justify-center text-ink-3">
              <Repeat className="size-3" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <span className="flex min-w-0 items-center gap-1" style={{ paddingLeft: indent }}>
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-ink-3 transition-transform duration-(--dur-fast) ease-(--ease-out)",
                  isOpen && "rotate-90",
                )}
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span className="truncate font-medium text-ink-2">{row.label}</span>
              <span className="shrink-0 font-mono text-2xs text-ink-3 tabular">
                {row.childCount} nodes
              </span>
            </span>
            <span className="relative hidden h-full @[640px]:block">
              <GroupSpan row={row} scale={scale} nowMs={nowMs} />
            </span>
            <span className="text-right font-mono text-2xs text-ink-3 tabular">
              {row.durationMs !== undefined ? formatMs(row.durationMs) : "…"}
            </span>
            <StatusChip status={row.status} compact />
          </div>
        </div>
      );
    }

    const n = row.nodeRun;
    const attemptStarts = row.attempts
      .map((a) => toMs(a.startedAt))
      .filter((t): t is number => t !== undefined);
    const startOffset = attemptStarts.length ? Math.min(...attemptStarts) : undefined;
    return (
      <div
        key={row.id}
        data-index={index}
        ref={virtualize ? virtualizer.measureElement : undefined}
        style={virtualStyle}
      >
        <div {...common} data-node-run-id={n.id} data-status={n.status}>
          <span className="text-right font-mono text-2xs text-ink-3 tabular">
            {startOffset !== undefined ? formatOffset(startOffset - scale.originMs) : "—"}
          </span>
          <CategoryDot category={n.category} className="justify-self-center" />
          <span className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: indent }}>
            {expandable ? (
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
            <span className="truncate font-medium text-ink">{n.nodeName}</span>
            <span className="hidden truncate font-mono text-2xs text-ink-3 @[480px]:inline">
              {n.nodeType}
            </span>
            {row.attempts.length > 1 ? (
              <Badge tone="warn" size="sm" mono>
                ×{row.attempts.length}
              </Badge>
            ) : null}
            {n.routeTaken ? (
              <span className="hidden truncate font-mono text-2xs text-ink-3 @[640px]:inline">
                → {n.routeTaken}
              </span>
            ) : null}
          </span>
          <span className="relative hidden h-full @[640px]:block" data-testid="trace-track">
            {row.attempts.map((a) => (
              <Segment
                key={a.id}
                attempt={a}
                scale={scale}
                nowMs={nowMs}
                isLatest={a.id === n.id}
                category={n.category}
              />
            ))}
          </span>
          <span
            className={cn(
              "text-right font-mono text-2xs tabular",
              n.status === "failed"
                ? "text-danger-text"
                : n.status === "waiting" || n.status === "retry_wait"
                  ? "text-warn-text"
                  : "text-ink-3",
            )}
          >
            {statusLabelFor(n, nowMs)}
          </span>
          <StatusChip status={n.status} compact />
        </div>
        {isOpen ? <NodeDetail row={row} nowMs={nowMs} /> : null}
      </div>
    );
  };

  const activeCount = run.nodeRuns.filter(
    (n) => n.status === "running" || n.status === "retry_wait",
  ).length;

  return (
    <div
      ref={ref}
      className={cn(
        "@container flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface shadow-1",
        className,
      )}
      style={style}
      {...rest}
    >
      {!noToolbar ? (
        <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border px-3">
          <span className="text-xs font-medium text-ink">Timeline</span>
          <span className="font-mono text-2xs text-ink-3 tabular">
            {rows.filter((r) => r.kind === "node").length} spans
            {activeCount > 0 ? ` · ${activeCount} active` : ""}
            {` · ${formatMs(scale.totalMs)}`}
          </span>
          <div className="ml-auto flex items-center gap-3">
            {toolbar}
            {isLive ? (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-2">
                Follow
                <Switch
                  size="sm"
                  checked={following}
                  onCheckedChange={setFollowing}
                  aria-label="Follow live run"
                />
              </label>
            ) : null}
          </div>
        </div>
      ) : null}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative min-h-0 flex-1 overflow-auto"
        style={{ height: height ?? undefined }}
      >
        <div className={cn(GRID, "sticky top-0 z-10 h-6 border-b border-border bg-surface")}>
          <span className="text-right font-mono text-2xs uppercase tracking-[0.06em] text-ink-3">
            t
          </span>
          <span />
          <span className="font-mono text-2xs uppercase tracking-[0.06em] text-ink-3">node</span>
          <span className="hidden h-full @[640px]:block">
            <TraceTimeRuler totalMs={scale.totalMs} live={isLive} />
          </span>
          <span className="text-right font-mono text-2xs uppercase tracking-[0.06em] text-ink-3">
            dur
          </span>
          <span />
        </div>
        <div
          role="tree"
          tabIndex={-1}
          aria-label={`Trace of ${run.workflowName}`}
          aria-multiselectable={false}
          onKeyDown={handleKeyDown}
          className="relative outline-none"
          style={virtualize ? { height: virtualizer.getTotalSize() } : undefined}
        >
          {virtualize
            ? virtualizer.getVirtualItems().map((v) => {
                const row = rows[v.index];
                if (!row) return null;
                return renderRow(row, v.index, {
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${v.start}px)`,
                });
              })
            : rows.map((row, i) => renderRow(row, i))}
        </div>
        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-ink-3">No node runs yet.</p>
        ) : null}
      </div>
    </div>
  );
});
