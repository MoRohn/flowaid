import { forwardRef, useMemo, useState, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { CopyButton } from "@/primitives";
import { stringifyCompact } from "./traceFormat";

export interface TraceJsonBlockProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Any value; objects are pretty-printed, strings shown raw. */
  value: unknown;
  /** Eyebrow label above the block (e.g. "args", "result"). */
  label?: string;
  /** Characters shown before the block is truncated. */
  maxChars?: number;
  /** Max height in px before the block scrolls. */
  maxHeight?: number;
  /** Hide the copy button. */
  noCopy?: boolean;
}

/**
 * Compact mono `<pre>` for payloads inside the trace. Long values are cut at
 * `maxChars` with a "Show all" toggle; the copy button always copies the full
 * text. Deliberately self-contained so the trace group has no dependency on
 * the inspector's JSON tree.
 */
export const TraceJsonBlock = forwardRef<HTMLDivElement, TraceJsonBlockProps>(
  function TraceJsonBlock(
    { value, label, maxChars = 1600, maxHeight = 240, noCopy = false, className, ...rest },
    ref,
  ) {
    const [expanded, setExpanded] = useState(false);
    const full = useMemo(() => stringifyCompact(value, Number.POSITIVE_INFINITY), [value]);
    const shown = useMemo(
      () => (expanded ? full : stringifyCompact(value, maxChars)),
      [expanded, full, value, maxChars],
    );
    return (
      <div ref={ref} className={cn("group/json relative min-w-0", className)} {...rest}>
        {label !== undefined ? (
          <div className="mb-1 flex h-5 items-center gap-2">
            <span className="text-eyebrow">{label}</span>
            {!noCopy ? (
              <CopyButton
                value={full.text}
                label={`Copy ${label}`}
                size="xs"
                className="ml-auto opacity-0 transition-opacity duration-(--dur-fast) group-hover/json:opacity-100 focus-visible:opacity-100"
              />
            ) : null}
          </div>
        ) : !noCopy ? (
          <CopyButton
            value={full.text}
            label="Copy"
            size="xs"
            className="absolute right-1 top-1 z-10 bg-surface-2 opacity-0 transition-opacity duration-(--dur-fast) group-hover/json:opacity-100 focus-visible:opacity-100"
          />
        ) : null}
        <pre
          className="overflow-auto rounded-sm border border-border bg-surface-2 px-2.5 py-2 font-mono text-2xs leading-[1.5] whitespace-pre-wrap break-words text-ink-2 tabular"
          style={{ maxHeight: expanded ? undefined : maxHeight }}
        >
          {shown.text}
          {shown.truncated ? <span className="text-ink-3">…</span> : null}
        </pre>
        {full.truncated || shown.truncated || expanded ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 rounded-xs font-mono text-2xs text-ink-3 hover:text-ink"
          >
            {expanded ? "Show less" : `Show all (${full.totalChars.toLocaleString("en")} chars)`}
          </button>
        ) : null}
      </div>
    );
  },
);
