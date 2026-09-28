"use client";
/** Answered human tasks: what was asked, the outcome, who answered and when. */
import type { ReactNode } from "react";
import { DataTable, RelativeTime, createDataTableColumns } from "@flowaid/ui/data";
import { ApprovalOutcomeBadge, approvalOutcomeFor } from "@flowaid/ui/human";
import type { HumanTask, Member } from "~/api/types";
import { humanizeId, respondedRecord } from "./humanTasks";

interface Row {
  task: HumanTask;
  workflowName: string;
  by: string;
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
    cell: (c) =>
      c.row.original.task.response ? (
        <ApprovalOutcomeBadge outcome={approvalOutcomeFor(c.row.original.task.response)} />
      ) : null,
  }),
  helper.accessor("by", { header: "Answered by" }),
  helper.accessor((r) => r.task.respondedAt ?? r.task.createdAt, {
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
    by: respondedRecord(task, members)?.by ?? "—",
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
