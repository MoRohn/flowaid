import { forwardRef, useMemo, useState, type HTMLAttributes, type ReactNode } from "react";
import { Columns2, Rows3, UnfoldVertical } from "lucide-react";
import { cn } from "@/lib/cn";
import { ToggleGroup, ToggleGroupItem, useControllableState } from "@/primitives";
import {
  chunkDiff,
  diffTextLines,
  diffStats,
  diffTokens,
  toSplitRows,
  type DiffChunk,
  type DiffOp,
  type TokenSpan,
} from "./textDiff";

export type DiffMode = "split" | "inline";

/** Serialises a value for diffing: strings as-is, everything else as pretty JSON. */
export function toDiffText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return Object.prototype.toString.call(value);
  }
}

const OP_ROW: Record<DiffOp["type"], string> = {
  equal: "",
  add: "bg-ok-soft",
  remove: "bg-danger-soft",
};
const OP_GUTTER: Record<DiffOp["type"], string> = {
  equal: "text-ink-3",
  add: "text-ok-text",
  remove: "text-danger-text",
};
const OP_SIGN: Record<DiffOp["type"], string> = { equal: " ", add: "+", remove: "−" };

function Spans({ spans, type }: { spans: TokenSpan[]; type: DiffOp["type"] }) {
  return (
    <>
      {spans.map((s, i) =>
        s.changed ? (
          <span
            key={i}
            className={cn("rounded-[2px]", type === "add" ? "bg-ok/25" : "bg-danger/25")}
          >
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

function Gutter({
  n,
  type,
  className,
}: {
  n: number | undefined;
  type: DiffOp["type"];
  className?: string;
}) {
  return (
    <span
      className={cn(
        "sticky left-0 w-10 shrink-0 select-none bg-inherit pr-2 text-right text-2xs tabular",
        OP_GUTTER[type],
        className,
      )}
      aria-hidden="true"
    >
      {n ?? ""}
    </span>
  );
}

function Sign({ type }: { type: DiffOp["type"] }) {
  return (
    <span
      className={cn("w-4 shrink-0 select-none text-center", OP_GUTTER[type])}
      aria-hidden="true"
    >
      {OP_SIGN[type]}
    </span>
  );
}

function CollapsedRow({ count, onExpand }: { count: number; onExpand: () => void }) {
  return (
    <div
      className="flex h-6 items-center gap-2 border-y border-border bg-surface-3/60 px-2 text-2xs text-ink-3"
      role="row"
      data-collapsed={count}
    >
      <button
        type="button"
        onClick={onExpand}
        className="inline-flex h-5 cursor-pointer items-center gap-1 rounded-xs px-1 font-sans font-medium text-accent-text hover:bg-accent-soft"
      >
        <UnfoldVertical className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
        Expand {count} {count === 1 ? "line" : "lines"}
      </button>
      <span className="font-mono">unchanged</span>
    </div>
  );
}

export interface DiffViewProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Old version: a string, or any JSON value (pretty-printed). */
  oldValue: unknown;
  /** New version. */
  newValue: unknown;
  oldLabel?: ReactNode;
  newLabel?: ReactNode;
  mode?: DiffMode;
  defaultMode?: DiffMode;
  onModeChange?: (mode: DiffMode) => void;
  /** Unchanged lines kept around each change. Default 3. */
  context?: number;
  /** Show the "+12 −4" summary bar. Default true. */
  summary?: boolean;
  /** Show the split/inline switch in the summary bar. Default true. */
  modeToggle?: boolean;
  /** Highlight the changed tokens inside modified line pairs. Default true. */
  emphasis?: boolean;
  /** Max height before the body scrolls. Default 480. */
  maxHeight?: number | string;
  /** Wrap long lines. Default true. */
  wrap?: boolean;
}

/**
 * Line diff of two strings or JSON values, side by side or inline. Added
 * lines are tinted ok-soft, removed lines danger-soft, and the tokens that
 * changed inside a modified pair are emphasised. Unchanged regions collapse
 * to an "Expand N lines" row. The summary bar carries the +/− counts and
 * the version labels.
 */
export const DiffView = forwardRef<HTMLDivElement, DiffViewProps>(function DiffView(
  {
    oldValue,
    newValue,
    oldLabel = "Before",
    newLabel = "After",
    mode,
    defaultMode = "split",
    onModeChange,
    context = 3,
    summary = true,
    modeToggle = true,
    emphasis = true,
    maxHeight = 480,
    wrap = true,
    className,
    style,
    ...rest
  },
  ref,
) {
  const [currentMode, setMode] = useControllableState<DiffMode>(mode, defaultMode, onModeChange);
  const oldText = useMemo(() => toDiffText(oldValue), [oldValue]);
  const newText = useMemo(() => toDiffText(newValue), [newValue]);
  const ops = useMemo(() => diffTextLines(oldText, newText), [oldText, newText]);
  const stats = useMemo(() => diffStats(ops), [ops]);
  const chunks = useMemo(() => chunkDiff(ops, context), [ops, context]);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const expand = (i: number) => setExpanded((prev) => new Set(prev).add(i));

  const lineClass = cn(
    "min-w-0 flex-1 px-2",
    wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre",
  );
  const maxH = typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight;
  const unchanged = stats.added === 0 && stats.removed === 0;

  const renderOps = (chunk: DiffChunk, ci: number): ReactNode => {
    if (chunk.kind === "collapsed" && !expanded.has(ci)) {
      return <CollapsedRow key={ci} count={chunk.ops.length} onExpand={() => expand(ci)} />;
    }
    if (currentMode === "inline") {
      return chunk.ops.map((op, i) => (
        <div
          key={`${ci}-${i}`}
          role="row"
          data-op={op.type}
          className={cn("flex min-h-[20px] items-start leading-5", OP_ROW[op.type])}
        >
          <Gutter n={op.oldLine} type={op.type} />
          <Gutter n={op.newLine} type={op.type} className="static" />
          <Sign type={op.type} />
          <span className={lineClass}>{op.text}</span>
        </div>
      ));
    }
    const rows = toSplitRows(chunk.ops);
    return rows.map((row, i) => {
      const spans =
        emphasis && row.paired && row.left && row.right
          ? diffTokens(row.left.text, row.right.text)
          : null;
      const cell = (op: DiffOp | null, side: "old" | "new") => {
        if (!op) {
          return <div className="min-h-[20px] min-w-0 bg-surface-3/40" aria-hidden="true" />;
        }
        const n = side === "old" ? op.oldLine : op.newLine;
        const tokenSpans = spans ? (side === "old" ? spans.old : spans.new) : null;
        return (
          <div
            data-op={op.type}
            className={cn("flex min-h-[20px] min-w-0 items-start leading-5", OP_ROW[op.type])}
          >
            <Gutter n={n} type={op.type} />
            <Sign type={op.type} />
            <span className={lineClass}>
              {tokenSpans ? <Spans spans={tokenSpans} type={op.type} /> : op.text}
            </span>
          </div>
        );
      };
      return (
        <div
          key={`${ci}-${i}`}
          role="row"
          data-paired={row.paired || undefined}
          className="grid grid-cols-2 [&>div:nth-child(2)]:border-l [&>div:nth-child(2)]:border-border"
        >
          {cell(row.left, "old")}
          {cell(row.right, "new")}
        </div>
      );
    });
  };

  return (
    <div
      ref={ref}
      data-mode={currentMode}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-sm border border-border bg-surface-2",
        className,
      )}
      style={style}
      {...rest}
    >
      {summary ? (
        <div className="flex h-8 shrink-0 items-center gap-3 border-b border-border bg-surface px-2.5">
          <span className="flex items-center gap-1.5 font-mono text-xs tabular" aria-live="polite">
            {unchanged ? (
              <span className="text-ink-3">No differences</span>
            ) : (
              <>
                <span className="text-ok-text">+{stats.added}</span>
                <span className="text-danger-text">−{stats.removed}</span>
              </>
            )}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-ink-3">
            <span className="truncate text-ink-2">{oldLabel}</span>
            <span aria-hidden="true">→</span>
            <span className="truncate text-ink-2">{newLabel}</span>
          </span>
          {modeToggle ? (
            <ToggleGroup
              type="single"
              size="sm"
              value={currentMode}
              onValueChange={(v) => {
                if (v === "split" || v === "inline") setMode(v);
              }}
              aria-label="Diff layout"
              className="ml-auto"
            >
              <ToggleGroupItem value="split" aria-label="Side by side">
                <Columns2 strokeWidth={1.75} />
              </ToggleGroupItem>
              <ToggleGroupItem value="inline" aria-label="Inline">
                <Rows3 strokeWidth={1.75} />
              </ToggleGroupItem>
            </ToggleGroup>
          ) : null}
        </div>
      ) : null}
      {currentMode === "split" ? (
        <div className="flex h-6 shrink-0 items-center border-b border-border bg-surface-2 font-mono text-2xs text-ink-3">
          <span className="flex-1 truncate px-2">{oldLabel}</span>
          <span className="flex-1 truncate border-l border-border px-2">{newLabel}</span>
        </div>
      ) : null}
      <div
        role="table"
        aria-label="Differences"
        className="flex min-w-0 flex-col overflow-auto py-1 font-mono text-xs"
        style={{ maxHeight: maxH }}
      >
        {chunks.map(renderOps)}
      </div>
    </div>
  );
});
