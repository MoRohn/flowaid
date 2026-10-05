"use client";
/**
 * Closed human tasks: what was asked, the outcome (answered, expired, or cancelled with its run),
 * who answered and when it closed.
 */
import type { ReactNode } from "react";
import { DataTable, RelativeTime, createDataTableColumns } from "@flowaid/ui/data";
import { ApprovalOutcomeBadge, approvalOutcomeFor, type ApprovalOutcome } from "@flowaid/ui/human";
import type { HumanTask, Member } from "~/api/types";
import { humanizeId, respondedRecord } from "./humanTasks";

interface Row {
  task: HumanTask;
  workflowName: string;
  by: string;
}

/** A closed task's outcome: its answer, or that nobody answered. */
export function taskOutcome(task: HumanTask): ApprovalOutcome | null {
  if (task.response) return approvalOutcomeFor(task.response);
  if (task.status === "expired") return "expired";
  if (task.status === "cancelled") return "cancelled";
  return null;
}

/** When a closed task closed: answered, expired, or (cancelled) when it was asked. */
export function taskClosedAt(task: HumanTask): string {
  if (task.respondedAt) return task.respondedAt;
  if (task.status === "expired" && task.expiresAt) return task.expiresAt;
  return task.createdAt;
}

const helper = createDataTableColumns<Row>();
const columns = helper.columns([
  helper.accessor((r) => r.task.request.title, {
    id: "title",
    header: "Task",
    cell: (c) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-ink">{c.getValue()}</span>
        <span className="truncate font-mono text-2xs text-ink-3">
          {c.row.original.task.nodeName ?? humanizeId(c.row.original.task.nodeId)}
        </span>
      </div>
    ),
  }),
  helper.accessor("workflowName", { header: "Workflow" }),
  helper.display({
    id: "outcome",
    header: "Outcome",
    cell: (c) => {
      const outcome = taskOutcome(c.row.original.task);
      return outcome ? <ApprovalOutcomeBadge outcome={outcome} /> : null;
    },
  }),
  helper.accessor("by", { header: "Answered by" }),
  helper.accessor((r) => taskClosedAt(r.task), {
    id: "at",
    header: "When",
    cell: (c) => <RelativeTime date={c.getValue()} />,
  }),
]);

export function ResolvedTasksTable({
  tasks,
  workflowNames,
  members,
  loading,
  onOpen,
  emptyState,
}: {
  tasks: readonly HumanTask[];
  workflowNames: ReadonlyMap<string, string>;
  members: readonly Member[];
  loading?: boolean;
  onOpen: (id: string) => void;
  emptyState?: ReactNode;
}) {
  const rows: Row[] = tasks.map((task) => ({
    task,
    workflowName: workflowNames.get(task.workflowId) ?? "Workflow",
    by: respondedRecord(task, members)?.by ?? (task.response ? "—" : "Nobody"),
  }));
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.task.id}
      loading={loading ?? false}
      onRowActivate={(r) => onOpen(r.task.id)}
      emptyState={emptyState}
      itemLabel={["task", "tasks"]}
      aria-label="Resolved human tasks"
    />
  );
}
