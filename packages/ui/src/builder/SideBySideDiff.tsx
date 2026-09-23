import { forwardRef, useMemo, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { diffTextLines, toSplitRows, type SplitRow } from "@/data";

/** One side-by-side row: unchanged lines on both sides, removed only left, added only right. */
export interface DiffRow {
  kind: "same" | "added" | "removed";
  left?: { n: number; text: string };
  right?: { n: number; text: string };
}

function toRows(split: readonly SplitRow[]): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const r of split) {
    if (r.left && r.right && r.left.type === "equal") {
      rows.push({
        kind: "same",
        left: { n: r.left.oldLine ?? 0, text: r.left.text },
        right: { n: r.right.newLine ?? 0, text: r.right.text },
      });
      continue;
    }
    if (r.left) rows.push({ kind: "removed", left: { n: r.left.oldLine ?? 0, text: r.left.text } });
    if (r.right)
      rows.push({ kind: "added", right: { n: r.right.newLine ?? 0, text: r.right.text } });
  }
  return rows;
}

/** Line-level diff (LCS, from `@/data`) producing side-by-side rows. */
export function diffLines(before: string, after: string): DiffRow[] {
  return toRows(toSplitRows(diffTextLines(before, after)));
}

export interface SideBySideDiffProps extends HTMLAttributes<HTMLDivElement> {
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
  /** Collapse runs of unchanged lines longer than this to a fold row. */
  context?: number;
  /** Max height before the body scrolls. */
  maxHeight?: number;
}

interface Segment {
  kind: "rows" | "fold";
  rows: DiffRow[];
}

function fold(rows: DiffRow[], context: number): Segment[] {
  const out: Segment[] = [];
  let run: DiffRow[] = [];
  const flushRun = (isEnd: boolean, isStart: boolean) => {
    if (run.length === 0) return;
    const keepHead = isStart ? 0 : context;
    const keepTail = isEnd ? 0 : context;
    if (run.length > keepHead + keepTail + 1) {
      if (keepHead > 0) out.push({ kind: "rows", rows: run.slice(0, keepHead) });
      out.push({ kind: "fold", rows: run.slice(keepHead, run.length - keepTail) });
      if (keepTail > 0) out.push({ kind: "rows", rows: run.slice(run.length - keepTail) });
    } else {
      out.push({ kind: "rows", rows: run });
    }
    run = [];
  };
  let sawChange = false;
  for (const r of rows) {
    if (r.kind === "same") {
      run.push(r);
    } else {
      flushRun(false, !sawChange);
      sawChange = true;
      out.push({ kind: "rows", rows: [r] });
    }
  }
  flushRun(true, !sawChange);
  return out;
}

/**
 * Two-column line diff in the mono face. Removed lines tint the left column
 * red, added lines tint the right column green; long unchanged stretches
 * fold into a count row.
 */
export const SideBySideDiff = forwardRef<HTMLDivElement, SideBySideDiffProps>(
  function SideBySideDiff(
    {
      before,
      after,
      beforeLabel = "Base",
      afterLabel = "Candidate",
      context = 2,
      maxHeight = 360,
      className,
      ...rest
    },
    ref,
  ) {
    const rows = useMemo(() => diffLines(before, after), [before, after]);
    const segments = useMemo(() => fold(rows, context), [rows, context]);
    const changed = rows.filter((r) => r.kind !== "same").length;

    const cell = (side: "left" | "right", r: DiffRow) => {
      const line = side === "left" ? r.left : r.right;
      const tint = line
        ? r.kind === "removed"
          ? "bg-danger-soft text-danger-text"
          : r.kind === "added"
            ? "bg-ok-soft text-ok-text"
            : ""
        : "bg-surface-2";
      return (
        <div className={cn("grid min-w-0 grid-cols-[32px_1fr]", tint)}>
          <span className="select-none pr-2 text-right text-ink-3">{line?.n ?? ""}</span>
          <pre
            className={cn(
              "m-0 min-w-0 overflow-hidden whitespace-pre-wrap break-all font-mono",
              line ? "text-current" : "",
            )}
          >
            {line ? (
              <>
                <span className="select-none text-ink-3">
                  {r.kind === "same" ? "  " : side === "left" ? "- " : "+ "}
                </span>
                {line.text}
              </>
            ) : null}
          </pre>
        </div>
      );
    };

    return (
      <div
        ref={ref}
        className={cn(
          "contain-inline-size flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface",
          className,
        )}
        {...rest}
      >
        <div className="grid shrink-0 grid-cols-2 divide-x divide-border border-b border-border bg-surface-2 text-2xs">
          <div className="flex items-center gap-2 px-2 py-1.5 font-medium text-ink-2">
            {beforeLabel}
          </div>
          <div className="flex items-center gap-2 px-2 py-1.5 font-medium text-ink-2">
            {afterLabel}
            <span className="ml-auto font-mono font-normal text-ink-3 tabular">
              {changed} changed lines
            </span>
          </div>
        </div>
        <div
          className="min-h-0 overflow-auto font-mono text-2xs leading-[18px] tabular"
          style={{ maxHeight }}
        >
          {segments.map((seg, si) =>
            seg.kind === "fold" ? (
              <div
                key={`fold-${si}`}
                className="flex h-5 items-center justify-center border-y border-border bg-surface-2 text-ink-3"
              >
                {seg.rows.length} unchanged lines
              </div>
            ) : (
              seg.rows.map((r, ri) => (
                <div key={`${si}-${ri}`} className="grid grid-cols-2 divide-x divide-border">
                  {cell("left", r)}
                  {cell("right", r)}
                </div>
              ))
            ),
          )}
        </div>
      </div>
    );
  },
);
