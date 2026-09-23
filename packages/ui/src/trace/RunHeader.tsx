import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { ExternalLink, GitFork, Play, Square, UserCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { ORIGIN_LABEL } from "@/lib/categories";
import { formatCost, formatMs, formatTokens } from "@/lib/format";
import type { NodeRunView, RunView } from "@/types";
import { Badge, Button, CopyButton, Hint, StatusChip, Tooltip } from "@/primitives";
import { formatDateTime, formatRelative } from "./traceFormat";
import { useNow } from "./useNow";

export interface RunHeaderProps extends HTMLAttributes<HTMLDivElement> {
  run: RunView;
  /** Clock override in epoch ms (tests, snapshots). */
  now?: number;
  onReplay?: (run: RunView) => void;
  onFork?: (run: RunView) => void;
  onCancel?: (run: RunView) => void;
  onOpenInBuilder?: (run: RunView) => void;
  /** Opens the pending review; shown in the waiting banner. */
  onOpenReview?: (run: RunView) => void;
  /** Extra actions rendered before the built-in ones. */
  actions?: ReactNode;
  /** Pending cancel (spinner on the Cancel button). */
  cancelling?: boolean;
}

function isActive(status: RunView["status"]): boolean {
  return (
    status === "queued" ||
    status === "starting" ||
    status === "running" ||
    status === "retrying" ||
    status === "waiting" ||
    status === "waiting_for_human"
  );
}

function waitingNode(run: RunView): NodeRunView | undefined {
  return (
    run.nodeRuns.find((n) => n.status === "waiting" && n.category === "human") ??
    run.nodeRuns.find((n) => n.status === "waiting")
  );
}

function Stat({
  label,
  detail,
  children,
}: {
  label: string;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-eyebrow">{label}</dt>
      <dd className="m-0 truncate font-mono text-xs text-ink tabular">{children}</dd>
      {detail ? (
        <dd className="m-0 truncate font-mono text-2xs text-ink-3 tabular">{detail}</dd>
      ) : null}
    </div>
  );
}

/**
 * Run identity and vitals: mono id with copy, workflow + version, environment,
 * status, origin, timing, cost and tokens, plus Replay / Fork / Cancel / Open
 * in builder. While a human node is waiting it shows an inline banner with
 * an "Open review" action.
 */
export const RunHeader = forwardRef<HTMLDivElement, RunHeaderProps>(function RunHeader(
  {
    run,
    now,
    onReplay,
    onFork,
    onCancel,
    onOpenInBuilder,
    onOpenReview,
    actions,
    cancelling = false,
    className,
    ...rest
  },
  ref,
) {
  const active = isActive(run.status);
  const nowMs = useNow(active, 1000, now);
  const waiting = run.status === "waiting_for_human" ? waitingNode(run) : undefined;
  const startedIso = run.startedAt ?? run.createdAt;
  const elapsed =
    run.durationMs ?? (run.startedAt ? Math.max(0, nowMs - Date.parse(run.startedAt)) : undefined);
  const tokens = run.usage ? run.usage.inputTokens + run.usage.outputTokens : undefined;

  return (
    <header
      ref={ref}
      data-status={run.status}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-1",
        className,
      )}
      {...rest}
    >
      <div className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate text-md font-semibold tracking-tight text-ink">
              {run.workflowName}
            </h1>
            <Badge tone="outline" mono>
              {run.version === "draft" ? "draft" : `v${run.version}`}
            </Badge>
            {run.environment ? (
              <Badge tone={run.environment.protected ? "accent" : "neutral"}>
                {run.environment.name}
              </Badge>
            ) : null}
            <StatusChip status={run.status} />
          </div>
          <div className="flex min-w-0 items-center gap-1 font-mono text-2xs text-ink-3 tabular">
            <Hint hint={run.id} announce={false} className="truncate">
              {run.id}
            </Hint>
            <CopyButton value={run.id} label="Copy run id" size="xs" />
            <span aria-hidden="true">·</span>
            <span>{ORIGIN_LABEL[run.origin]}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {actions}
          {onOpenInBuilder ? (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<ExternalLink />}
              onClick={() => onOpenInBuilder(run)}
            >
              Open in builder
            </Button>
          ) : null}
          {onFork ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<GitFork />}
              onClick={() => onFork(run)}
            >
              Fork
            </Button>
          ) : null}
          {onReplay ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Play />}
              onClick={() => onReplay(run)}
              disabled={active}
            >
              Replay
            </Button>
          ) : null}
          {onCancel && active ? (
            <Button
              variant="danger"
              size="sm"
              leadingIcon={<Square />}
              loading={cancelling}
              onClick={() => onCancel(run)}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={run.startedAt ? "Started" : "Created"}>
          <Tooltip content={formatDateTime(startedIso)}>
            <button
              type="button"
              className="cursor-default rounded-xs text-left outline-none focus-visible:shadow-(--focus)"
            >
              {formatRelative(startedIso, nowMs)}
            </button>
          </Tooltip>
        </Stat>
        <Stat label={active ? "Elapsed" : "Duration"}>
          {elapsed !== undefined ? formatMs(elapsed) : "—"}
        </Stat>
        <Stat label="Cost">{run.costUsd !== undefined ? formatCost(run.costUsd) : "—"}</Stat>
        <Stat
          label="Tokens"
          detail={
            run.usage
              ? `${formatTokens(run.usage.inputTokens)} in · ${formatTokens(run.usage.outputTokens)} out`
              : undefined
          }
        >
          {tokens !== undefined ? formatTokens(tokens) : "—"}
        </Stat>
        <Stat label="Nodes">
          {run.nodeRuns.filter((n) => n.status === "completed").length}/{run.nodeRuns.length}
        </Stat>
        <Stat label="Ended">
          {run.endedAt
            ? formatRelative(run.endedAt, nowMs)
            : run.startedAt && active
              ? "in progress"
              : "—"}
        </Stat>
      </dl>

      {run.error ? (
        <p className="flex items-start gap-2 rounded-sm border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger-text">
          <Badge tone="danger" size="sm" mono>
            {run.error.code}
          </Badge>
          <span className="min-w-0 break-words">{run.error.message}</span>
        </p>
      ) : null}

      {run.status === "waiting_for_human" ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-sm border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-ink"
        >
          <UserCheck
            className="size-4 shrink-0 text-warn-text"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            Waiting for{" "}
            <span className="font-medium">
              {run.pendingApproval?.nodeName ?? waiting?.nodeName ?? "a person"}
            </span>
            {run.pendingApproval?.reason ? (
              <span className="text-ink-2"> · {run.pendingApproval.reason}</span>
            ) : null}
            {run.pendingApproval?.request.assignees.length ? (
              <span className="font-mono text-2xs text-ink-3">
                {" "}
                · {run.pendingApproval.request.assignees.join(", ")}
              </span>
            ) : null}
          </span>
          {onOpenReview ? (
            <Button variant="primary" size="sm" onClick={() => onOpenReview(run)}>
              Open review
            </Button>
          ) : null}
        </div>
      ) : null}
    </header>
  );
});
