import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatProbability } from "@/lib/format";
import type { ApprovalRequestView } from "@/types";
import { Avatar, Badge, Button, CategoryDot, Hint, Tooltip } from "@/primitives";
import {
  createDataTableColumns,
  DataTable,
  type DataTableColumns,
  type DataTableProps,
} from "./DataTable";
import { formatAbsoluteTime, useNowTick } from "./RelativeTime";

/** An approval request as the queue sees it, with its workflow named. */
export interface PendingApprovalView extends ApprovalRequestView {
  workflowId: string;
  workflowName: string;
  workflowVersion?: number | "draft";
  /** Display name for the first assignee (`request.assignees[0]`), when known. */
  assigneeName?: string;
}

/** Human label for a `HumanRequest.mode.type`. */
export const REVIEW_MODE_LABEL: Record<ApprovalRequestView["request"]["mode"]["type"], string> = {
  approval: "approve / reject",
  review: "review value",
  form: "fill a form",
  choice: "choose an option",
};

export type SlaTone = "ok" | "warn" | "danger" | "none";

export interface SlaStatus {
  tone: SlaTone;
  /** Time left until `expiresAt`; negative when overdue. */
  remainingMs: number | null;
  /** Elapsed share of the window in [0, 1], or null without an expiry. */
  fraction: number | null;
  label: string;
}

/**
 * Time a request has been waiting, in the compact units used by the trace:
 * "42 s", "3 m 12 s", "3 h 02 m", "2 d 5 h".
 */
export function formatWaiting(ms: number): string {
  const abs = Math.max(0, Math.floor(ms));
  const s = Math.floor(abs / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} m ${(s % 60).toString().padStart(2, "0")} s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${(m % 60).toString().padStart(2, "0")} m`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}

/**
 * SLA tone from the remaining window: ok while more than half remains,
 * warn under half, danger under a quarter or once overdue. No expiry → none.
 */
export function slaStatus(
  requestedAt: string,
  expiresAt: string | undefined,
  now: number | Date = Date.now(),
): SlaStatus {
  const n = now instanceof Date ? now.getTime() : now;
  if (!expiresAt) return { tone: "none", remainingMs: null, fraction: null, label: "No SLA" };
  const start = new Date(requestedAt).getTime();
  const end = new Date(expiresAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { tone: "none", remainingMs: null, fraction: null, label: "No SLA" };
  }
  const total = Math.max(1, end - start);
  const remaining = end - n;
  const fraction = Math.min(1, Math.max(0, (n - start) / total));
  if (remaining <= 0) {
    return {
      tone: "danger",
      remainingMs: remaining,
      fraction: 1,
      label: `Overdue ${formatWaiting(-remaining)}`,
    };
  }
  const share = remaining / total;
  const tone: SlaTone = share <= 0.25 ? "danger" : share <= 0.5 ? "warn" : "ok";
  return { tone, remainingMs: remaining, fraction, label: `${formatWaiting(remaining)} left` };
}

const SLA_BAR: Record<SlaTone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  none: "bg-ink-4",
};

/** Remaining-time chip with a thin elapsed bar underneath. */
export function SlaIndicator({ status, className }: { status: SlaStatus; className?: string }) {
  const tone = status.tone === "none" ? "neutral" : status.tone;
  return (
    <span className={cn("flex min-w-0 flex-col gap-1", className)} data-sla={status.tone}>
      <Badge tone={tone} mono dot={status.tone !== "none"} size="sm" className="self-start">
        {status.label}
      </Badge>
      {status.fraction !== null ? (
        <span className="h-0.5 w-20 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
          <span
            className={cn("block h-full rounded-full", SLA_BAR[status.tone])}
            style={{ width: `${status.fraction * 100}%` }}
          />
        </span>
      ) : null}
    </span>
  );
}

export interface ApprovalsTableProps extends Omit<
  DataTableProps<PendingApprovalView>,
  "columns" | "data" | "itemLabel"
> {
  approvals: readonly PendingApprovalView[];
  onReview?: (approval: PendingApprovalView) => void;
  onAssignToMe?: (approval: PendingApprovalView) => void;
  /** Override the clock (tests, stories). */
  now?: number;
}

const helper = createDataTableColumns<PendingApprovalView>();

/**
 * Pending approvals: human node, workflow, reason (with the decision's
 * confidence when present), live waiting time, assignee and an SLA
 * indicator that turns amber under half the window and red under a quarter.
 */
export function ApprovalsTable({
  approvals,
  onReview,
  onAssignToMe,
  now: nowProp,
  onRowActivate,
  defaultSorting,
  ...rest
}: ApprovalsTableProps) {
  const tick = useNowTick(1000);
  const now = nowProp ?? tick;

  const columns = useMemo<DataTableColumns<PendingApprovalView>>(
    () =>
      helper.columns([
        helper.accessor("nodeName", {
          header: "Node",
          size: 200,
          minSize: 150,
          cell: ({ row }) => (
            <span className="flex min-w-0 items-center gap-2">
              <CategoryDot category="human" />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate font-medium text-ink">{row.original.nodeName}</span>
                <span className="truncate font-mono text-2xs text-ink-3">
                  {REVIEW_MODE_LABEL[row.original.request.mode.type]}
                </span>
              </span>
            </span>
          ),
        }),
        helper.accessor("workflowName", {
          header: "Workflow",
          size: 170,
          minSize: 130,
          cell: ({ row }) => (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-ink">{row.original.workflowName}</span>
              {row.original.workflowVersion !== undefined ? (
                <Badge
                  mono
                  size="sm"
                  tone={row.original.workflowVersion === "draft" ? "outline" : "neutral"}
                >
                  {row.original.workflowVersion === "draft"
                    ? "draft"
                    : `v${row.original.workflowVersion}`}
                </Badge>
              ) : null}
            </span>
          ),
        }),
        helper.accessor((a) => a.reason ?? "", {
          id: "reason",
          header: "Reason",
          size: 280,
          minSize: 180,
          meta: { grow: true },
          cell: ({ row }) => {
            const a = row.original;
            return (
              <span className="flex min-w-0 items-center gap-2">
                <Hint
                  hint={a.reason ?? a.request.title}
                  announce={false}
                  className="truncate text-ink-2"
                >
                  {a.reason ?? a.request.title}
                </Hint>
                {a.decision ? (
                  <Tooltip
                    content={
                      <span>
                        {a.decision.kind} · {a.decision.model} ·{" "}
                        {formatProbability(a.decision.confidence)}
                      </span>
                    }
                  >
                    <span className="shrink-0 rounded-xs bg-accent-soft px-1 font-mono text-2xs text-accent-text tabular">
                      {formatProbability(a.decision.confidence)}
                    </span>
                  </Tooltip>
                ) : null}
              </span>
            );
          },
        }),
        helper.accessor("requestedAt", {
          header: "Waiting",
          size: 110,
          minSize: 90,
          sortFn: "datetime",
          meta: { numeric: true },
          cell: ({ getValue }) => {
            const requested = getValue();
            return (
              <Tooltip
                content={
                  <span className="font-mono tabular">since {formatAbsoluteTime(requested)}</span>
                }
              >
                <span className="text-ink-2">
                  {formatWaiting(now - new Date(requested).getTime())}
                </span>
              </Tooltip>
            );
          },
        }),
        helper.accessor((a) => a.assigneeName ?? a.request.assignees[0] ?? "", {
          id: "assignee",
          header: "Assignee",
          size: 160,
          minSize: 120,
          cell: ({ row }) => {
            const a = row.original;
            const name = a.assigneeName ?? a.request.assignees[0];
            if (!name) {
              return onAssignToMe ? (
                <Button
                  variant="link"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAssignToMe(a);
                  }}
                >
                  Assign to me
                </Button>
              ) : (
                <span className="text-2xs text-ink-3">Unassigned</span>
              );
            }
            return (
              <span className="flex min-w-0 items-center gap-1.5">
                <Avatar name={name} size="sm" />
                <span className="truncate text-ink-2">{name}</span>
              </span>
            );
          },
        }),
        helper.accessor(
          (a) => (a.request.expiresAt ? new Date(a.request.expiresAt).getTime() : undefined),
          {
            id: "sla",
            header: "SLA",
            size: 130,
            minSize: 110,
            sortFn: "basic",
            sortUndefined: "last",
            cell: ({ row }) => (
              <SlaIndicator
                status={slaStatus(
                  row.original.requestedAt,
                  row.original.request.expiresAt ?? undefined,
                  now,
                )}
              />
            ),
          },
        ),
        helper.display({
          id: "actions",
          header: "",
          size: 96,
          minSize: 96,
          maxSize: 96,
          enableSorting: false,
          enableHiding: false,
          enableResizing: false,
          meta: { locked: true, title: "Actions", align: "end", className: "px-2" },
          cell: ({ row }) => (
            <Button
              size="sm"
              variant="secondary"
              trailingIcon={<ArrowRight strokeWidth={1.75} />}
              disabled={!onReview}
              onClick={(e) => {
                e.stopPropagation();
                onReview?.(row.original);
              }}
            >
              Review
            </Button>
          ),
        }),
      ]),
    [now, onReview, onAssignToMe],
  );

  return (
    <DataTable<PendingApprovalView>
      columns={columns}
      data={approvals}
      itemLabel={["approval", "approvals"]}
      defaultSorting={defaultSorting ?? [{ id: "sla", desc: false }]}
      onRowActivate={onRowActivate ?? onReview}
      aria-label="Pending approvals"
      {...rest}
    />
  );
}
