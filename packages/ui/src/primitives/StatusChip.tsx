import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import {
  NODE_RUN_STATUS_LABEL,
  STATUS_LABEL,
  isRunStatus,
  type NodeRunStatus,
  type RunStatus,
} from "@/lib/categories";
import { assertNever } from "@/types";
import { Tooltip } from "./Tooltip";

export type ChipStatus = RunStatus | NodeRunStatus;
export type StatusTone = "queued" | "running" | "waiting" | "ok" | "reused" | "failed" | "neutral";

/** Human label for any run or node-run status. */
export function statusLabel(status: ChipStatus): string {
  return isRunStatus(status) ? STATUS_LABEL[status] : NODE_RUN_STATUS_LABEL[status];
}

/**
 * Colour family for a status: running is blue, waiting (a timer, a retry
 * back-off, a person) amber, completed green, reused green dashed, failed
 * red, skipped and cancelled grey. The set is exactly `RunStatusSchema` ∪
 * `NodeRunStatusSchema`.
 */
export function statusTone(status: ChipStatus): StatusTone {
  switch (status) {
    case "queued":
    case "pending":
      return "queued";
    case "starting":
    case "running":
    case "retrying":
      return "running";
    case "waiting":
    case "waiting_for_human":
    case "retry_wait":
      return "waiting";
    case "completed":
      return "ok";
    case "reused":
      return "reused";
    case "failed":
    case "timed_out":
      return "failed";
    case "cancelled":
    case "skipped":
      return "neutral";
    default:
      return assertNever(status, "status");
  }
}

/** Whether the status represents ongoing activity (drives the pulsing dot). */
export function statusIsActive(status: ChipStatus): boolean {
  return status === "starting" || status === "running" || status === "retrying";
}

const TONE_CLASS: Record<StatusTone, string> = {
  queued: "bg-surface-3 text-ink-3",
  running: "bg-info-soft text-info-text",
  waiting: "bg-warn-soft text-warn-text",
  ok: "bg-ok-soft text-ok-text",
  reused: "border border-dashed border-ok bg-ok-soft/40 text-ok-text",
  failed: "bg-danger-soft text-danger-text",
  neutral: "bg-surface-3 text-ink-2",
};

export interface StatusChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  status: ChipStatus;
  /** Override the label (e.g. "3 retries"). */
  label?: string;
  size?: "sm" | "md";
  /** Dot only, label in a title attribute. */
  compact?: boolean;
  /** Mono suffix at the end (a duration, an attempt count). */
  meta?: string;
}

/**
 * 22px pill with a leading dot, soft background of the status colour. The
 * dot pulses while the run is active; the pulse is a box-shadow ring so it
 * stays crisp and stops under reduced motion. A reused node run (a cached
 * result) reads as a dashed green pill.
 */
export const StatusChip = forwardRef<HTMLSpanElement, StatusChipProps>(function StatusChip(
  { status, label, size = "md", compact = false, meta, className, ...rest },
  ref,
) {
  const tone = statusTone(status);
  const text = label ?? statusLabel(status);
  const active = statusIsActive(status);
  const chip = (
    <span
      ref={ref}
      data-status={status}
      data-tone={tone}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-medium leading-none",
        TONE_CLASS[tone],
        compact
          ? "size-4 justify-center p-0"
          : size === "sm"
            ? "h-[18px] px-1.5 text-2xs"
            : "h-[22px] px-2 text-xs",
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full bg-current", active && "fa-pulse")}
      />
      {compact ? <span className="sr-only">{text}</span> : text}
      {!compact && meta ? (
        <span className="font-mono text-2xs font-normal tabular opacity-80">{meta}</span>
      ) : null}
    </span>
  );
  // Compact chips are a bare dot: the label is sr-only text, and a tooltip on hover.
  return compact ? <Tooltip content={text}>{chip}</Tooltip> : chip;
});
