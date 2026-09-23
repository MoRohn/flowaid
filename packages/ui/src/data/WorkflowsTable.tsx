import { forwardRef, useMemo, useState, type HTMLAttributes } from "react";
import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/cn";
import type { EnvironmentView } from "@/types";
import { StatusChip, ToggleGroup, ToggleGroupItem, Tooltip } from "@/primitives";
import {
  createDataTableColumns,
  DataTable,
  type DataTableColumns,
  type DataTableProps,
} from "./DataTable";
import { RelativeTime } from "./RelativeTime";
import { RunsSparkline } from "./RunsSparkline";
import {
  EnvironmentDots,
  VersionStatusBadge,
  WorkflowCard,
  type WorkflowListItemView,
} from "./WorkflowCard";

const helper = createDataTableColumns<WorkflowListItemView>();

export interface WorkflowsTableProps extends Omit<
  DataTableProps<WorkflowListItemView>,
  "columns" | "data" | "itemLabel"
> {
  workflows: readonly WorkflowListItemView[];
  /** The workspace's environments, for the deployment dots. */
  environments: readonly EnvironmentView[];
  onOpen?: (workflow: WorkflowListItemView) => void;
}

/**
 * List view of workflows: name + description, version status, last run,
 * 24h sparkline, deployment dots and updated time.
 */
export function WorkflowsTable({
  workflows,
  environments,
  onOpen,
  onRowActivate,
  defaultSorting,
  ...rest
}: WorkflowsTableProps) {
  const columns = useMemo<DataTableColumns<WorkflowListItemView>>(
    () =>
      helper.columns([
        helper.accessor("name", {
          header: "Workflow",
          size: 260,
          minSize: 180,
          meta: { grow: true },
          cell: ({ row }) => (
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate font-medium text-ink">{row.original.name}</span>
              {row.original.description ? (
                <span className="truncate text-2xs text-ink-3">{row.original.description}</span>
              ) : null}
            </span>
          ),
        }),
        helper.accessor("versionStatus", {
          header: "Version",
          size: 140,
          minSize: 120,
          cell: ({ row }) => (
            <span className="flex items-center gap-1.5">
              <VersionStatusBadge status={row.original.versionStatus} />
              {row.original.version !== undefined ? (
                <span className="font-mono text-2xs text-ink-3 tabular">
                  v{row.original.version}
                </span>
              ) : null}
            </span>
          ),
        }),
        helper.accessor((w) => w.lastRunAt, {
          id: "lastRun",
          header: "Last run",
          size: 190,
          minSize: 150,
          sortFn: "datetime",
          sortUndefined: "last",
          cell: ({ row }) =>
            row.original.lastRunStatus && row.original.lastRunAt ? (
              <span className="flex items-center gap-2">
                <StatusChip status={row.original.lastRunStatus} size="sm" />
                <RelativeTime date={row.original.lastRunAt} mono className="text-ink-3" />
              </span>
            ) : (
              <span className="text-2xs text-ink-3">No runs yet</span>
            ),
        }),
        helper.accessor((w) => w.runs24h.reduce((a, b) => a + b, 0), {
          id: "runs24h",
          header: "Runs · 24h",
          size: 150,
          minSize: 130,
          sortFn: "basic",
          meta: { numeric: true },
          cell: ({ getValue, row }) => (
            <span className="flex items-center justify-end gap-2">
              <span className="text-ink-2">{getValue()}</span>
              <RunsSparkline values={row.original.runs24h} />
            </span>
          ),
        }),
        helper.display({
          id: "deployments",
          header: "Deployed",
          size: 150,
          minSize: 140,
          enableSorting: false,
          cell: ({ row }) => (
            <EnvironmentDots environments={environments} deployments={row.original.deployments} />
          ),
        }),
        helper.accessor("updatedAt", {
          header: "Updated",
          size: 110,
          minSize: 90,
          sortFn: "datetime",
          sortDescFirst: true,
          cell: ({ getValue }) => <RelativeTime date={getValue()} mono className="text-ink-2" />,
        }),
      ]),
    [environments],
  );
  return (
    <DataTable<WorkflowListItemView>
      columns={columns}
      data={workflows}
      itemLabel={["workflow", "workflows"]}
      defaultSorting={defaultSorting ?? [{ id: "updatedAt", desc: true }]}
      onRowActivate={onRowActivate ?? onOpen}
      aria-label="Workflows"
      {...rest}
    />
  );
}

export type WorkflowsView = "list" | "grid";

export interface WorkflowsViewToggleProps {
  value: WorkflowsView;
  onChange: (view: WorkflowsView) => void;
  className?: string;
}

/** Segmented list/grid switch used above the workflows browser. */
export function WorkflowsViewToggle({ value, onChange, className }: WorkflowsViewToggleProps) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      aria-label="View"
      value={value}
      onValueChange={(v) => {
        if (v === "list" || v === "grid") onChange(v);
      }}
      className={className}
    >
      <Tooltip content="List">
        <ToggleGroupItem value="list" aria-label="List view">
          <List strokeWidth={1.75} />
        </ToggleGroupItem>
      </Tooltip>
      <Tooltip content="Grid">
        <ToggleGroupItem value="grid" aria-label="Grid view">
          <LayoutGrid strokeWidth={1.75} />
        </ToggleGroupItem>
      </Tooltip>
    </ToggleGroup>
  );
}

export interface WorkflowsBrowserProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  workflows: readonly WorkflowListItemView[];
  view?: WorkflowsView;
  defaultView?: WorkflowsView;
  onViewChange?: (view: WorkflowsView) => void;
  environments: readonly EnvironmentView[];
  onOpen?: (workflow: WorkflowListItemView) => void;
  selectedId?: string;
  /** Extra toolbar content on the left (a search, filters). */
  toolbar?: React.ReactNode;
  tableProps?: Omit<
    WorkflowsTableProps,
    "workflows" | "environments" | "onOpen" | "toolbar" | "toolbarEnd"
  >;
}

/**
 * Workflows with a list/grid toggle. List renders `WorkflowsTable` with the
 * toggle in its toolbar; grid renders `WorkflowCard`s in a responsive grid.
 */
export const WorkflowsBrowser = forwardRef<HTMLDivElement, WorkflowsBrowserProps>(
  function WorkflowsBrowser(
    {
      workflows,
      environments,
      view,
      defaultView = "list",
      onViewChange,
      onOpen,
      selectedId,
      toolbar,
      tableProps,
      className,
      ...rest
    },
    ref,
  ) {
    const [internal, setInternal] = useState<WorkflowsView>(defaultView);
    const current = view ?? internal;
    const setView = (v: WorkflowsView) => {
      if (view === undefined) setInternal(v);
      onViewChange?.(v);
    };
    const toggle = <WorkflowsViewToggle value={current} onChange={setView} />;
    return (
      <div ref={ref} className={cn("flex min-w-0 flex-col gap-3", className)} {...rest}>
        {current === "list" ? (
          <WorkflowsTable
            workflows={workflows}
            environments={environments}
            onOpen={onOpen}
            toolbar={toolbar}
            toolbarEnd={toggle}
            isRowActive={selectedId ? (w) => w.id === selectedId : undefined}
            {...tableProps}
          />
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">{toolbar}</div>
              {toggle}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {workflows.map((w) => (
                <WorkflowCard
                  key={w.id}
                  workflow={w}
                  environments={environments}
                  onOpen={onOpen}
                  selected={w.id === selectedId}
                />
              ))}
            </div>
          </>
        )}
      </div>
    );
  },
);
