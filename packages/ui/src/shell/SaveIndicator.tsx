import { forwardRef, type HTMLAttributes } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { Spinner, Tooltip } from "@/primitives";

export type SaveState = "saved" | "saving" | "unsaved" | "error";

export interface SaveIndicatorProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  state: SaveState;
  /** ISO timestamp of the last successful save; shown in the tooltip. */
  savedAt?: string;
  /** Error detail for the tooltip when `state` is "error". */
  error?: string;
  /** Dot only. */
  compact?: boolean;
}

const LABEL: Record<SaveState, string> = {
  saved: "Saved",
  saving: "Saving",
  unsaved: "Unsaved changes",
  error: "Save failed",
};

const DOT_CLASS: Record<SaveState, string> = {
  saved: "bg-ok",
  saving: "bg-info",
  unsaved: "bg-warn",
  error: "bg-danger",
};

function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString();
}

/**
 * Autosave status for the top bar: a coloured dot and a short label that
 * cross-fades between states. The label is live-announced so screen readers
 * hear "Saved" without the dot.
 */
export const SaveIndicator = forwardRef<HTMLSpanElement, SaveIndicatorProps>(function SaveIndicator(
  { state, savedAt, error, compact = false, className, ...rest },
  ref,
) {
  const reduced = useReducedMotion();
  const label = LABEL[state];
  const detail =
    state === "error" && error
      ? error
      : state === "saved" && savedAt
        ? `Saved ${relativeTime(savedAt)}`
        : label;
  const node = (
    <span
      ref={ref}
      role="status"
      aria-live="polite"
      data-state={state}
      className={cn(
        "inline-flex h-7 shrink-0 select-none items-center gap-1.5 rounded-sm px-1.5 text-xs",
        state === "error" ? "text-danger-text" : "text-ink-3",
        className,
      )}
      {...rest}
    >
      {state === "saving" ? (
        <Spinner size="xs" className="text-info-text" label="Saving" />
      ) : (
        <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT_CLASS[state])} />
      )}
      {compact ? (
        <span className="sr-only">{label}</span>
      ) : (
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={state}
            initial={reduced ? false : { opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -2 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
            className="whitespace-nowrap"
          >
            {label}
          </motion.span>
        </AnimatePresence>
      )}
    </span>
  );
  if (detail === label && !compact) return node;
  return <Tooltip content={detail}>{node}</Tooltip>;
});
