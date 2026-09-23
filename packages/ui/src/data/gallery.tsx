import { useMemo, useState, type ReactNode } from "react";
import { Archive, Download, Play, RotateCw, Square } from "lucide-react";
import { Button, toast, Toaster } from "@/primitives";
import type { RunView } from "@/types";
import {
  ApprovalsTable,
  applyRunFilters,
  createDataTableColumns,
  CredentialsTable,
  DataTable,
  DateRangePanel,
  DateRangePicker,
  FilterBar,
  Pagination,
  RelativeTime,
  RunConfidenceCell,
  RunsSparkline,
  RunsTable,
  serializeFilters,
  SortableHeader,
  WorkflowCard,
  WorkflowsBrowser,
  lowestConfidence,
  type DataTableColumns,
  type DataTableDensity,
  type DateRangeValue,
  type RunFilters,
  type WorkflowsView,
} from "./index";
import {
  makeSampleApprovals,
  makeSampleCredentials,
  makeSampleRuns,
  makeSampleWorkflows,
  SAMPLE_ENVIRONMENTS,
  SAMPLE_FILTER_OPTIONS,
} from "./sample";

// ---------------------------------------------------------------------------
// Scaffolding
// ---------------------------------------------------------------------------

function Section({
  id,
  title,
  caption,
  children,
}: {
  id: string;
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="flex flex-col gap-4 border-t border-border pt-6 first:border-t-0 first:pt-0"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-eyebrow">{title}</h2>
        {caption ? <p className="max-w-2xl text-xs text-ink-3">{caption}</p> : null}
      </header>
      {children}
    </section>
  );
}

const NOW = Date.now();
const RUNS = makeSampleRuns(60, NOW);
const WORKFLOWS = makeSampleWorkflows(NOW);
const CREDENTIALS = makeSampleCredentials(NOW);
const APPROVALS = makeSampleApprovals(NOW);
const MANY_RUNS = makeSampleRuns(1200, NOW, 23);

const PROVIDER_GLYPH: Record<string, string> = {
  openai: "OA",
  jev: "Jv",
  zendesk: "Zd",
  internal: "In",
  slack: "Sl",
  postgres: "Pg",
  stripe: "St",
};

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function RunsSection() {
  const [filters, setFilters] = useState<RunFilters>({ status: ["failed", "waiting_for_human"] });
  const [density, setDensity] = useState<DataTableDensity>("regular");
  const [activeId, setActiveId] = useState<string | null>(null);
  const runs = useMemo(() => applyRunFilters(RUNS, filters, new Date(NOW)), [filters]);
  const query = serializeFilters(filters);

  return (
    <Section
      id="runs"
      title="Runs table"
      caption="60 sample runs from the support-triage workflow. The FilterBar filters client-side; the chips emit a typed RunFilters object and the query string below is serializeFilters(value). Shift+click a header for multi-sort, drag a header edge to resize, arrows/Enter/Space on a focused row, shift+click checkboxes for ranges."
    >
      <RunsTable
        runs={runs}
        density={density}
        onDensityChange={setDensity}
        selectable
        stickyFirstColumn
        maxHeight={520}
        isRowActive={(r) => r.id === activeId}
        onRowClick={(r) => setActiveId(r.id)}
        onOpen={(r) => toast.info(`Open ${r.id}`)}
        onReplay={(r) => toast.success(`Replay queued for ${r.id}`)}
        onCancel={(r) => toast.warning(`Cancelling ${r.id}`)}
        toolbar={
          <FilterBar
            value={filters}
            onChange={setFilters}
            options={SAMPLE_FILTER_OPTIONS}
            environments={SAMPLE_ENVIRONMENTS}
            now={new Date(NOW)}
          />
        }
        selectionToolbar={({ rows, clear }) => (
          <>
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<RotateCw strokeWidth={1.75} />}
              onClick={() => {
                toast.success(`Replaying ${rows.length} runs`);
                clear();
              }}
            >
              Replay
            </Button>
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Download strokeWidth={1.75} />}
              onClick={() => toast.info(`Exporting ${rows.length} runs`)}
            >
              Export
            </Button>
            <Button
              size="sm"
              variant="danger"
              leadingIcon={<Square strokeWidth={1.75} />}
              onClick={() => {
                toast.warning(`Cancelled ${rows.length} runs`);
                clear();
              }}
            >
              Cancel
            </Button>
          </>
        )}
      />
      <p className="font-mono text-2xs text-ink-3">
        ?{query || <span className="text-ink-3">(no filters)</span>}
      </p>
    </Section>
  );
}

function StatesSection() {
  const [retries, setRetries] = useState(0);
  return (
    <Section
      id="states"
      title="Loading, empty, error"
      caption="Skeleton rows while the first page loads, a thin refresh bar when data is already present, the empty slot, and an error panel with a retry action."
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <RunsTable
          runs={[]}
          loading
          hideFooter
          showColumnMenu={false}
          showDensityToggle={false}
          toolbar={<span className="text-xs text-ink-3">Loading first page</span>}
        />
        <RunsTable
          runs={RUNS.slice(0, 4)}
          loading
          maxHeight={200}
          showColumnMenu={false}
          showDensityToggle={false}
          toolbar={<span className="text-xs text-ink-3">Refreshing with data present</span>}
        />
        <RunsTable
          runs={[]}
          showColumnMenu={false}
          showDensityToggle={false}
          toolbar={<span className="text-xs text-ink-3">Empty</span>}
          emptyState={undefined}
        />
        <RunsTable
          runs={[]}
          showColumnMenu={false}
          showDensityToggle={false}
          toolbar={
            <span className="text-xs text-ink-3">
              Error{retries > 0 ? ` · retried ${retries}×` : ""}
            </span>
          }
          error={{
            title: "Couldn't load runs",
            message: "runs-api returned 502 Bad Gateway from eu-west-1.",
            onRetry: () => setRetries((n) => n + 1),
          }}
        />
      </div>
    </Section>
  );
}

interface Metric {
  id: string;
  node: string;
  kind: string;
  calls: number;
  p50Ms: number;
  costUsd: number;
  minConfidence: number;
}

const metricsHelper = createDataTableColumns<Metric>();
const METRIC_COLUMNS: DataTableColumns<Metric> = metricsHelper.columns([
  metricsHelper.accessor("node", {
    header: "Node",
    size: 200,
    meta: { grow: true },
    cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
  }),
  metricsHelper.accessor("kind", {
    header: "Kind",
    size: 150,
    meta: { mono: true },
    cell: ({ getValue }) => <span className="text-ink-3">{getValue()}</span>,
  }),
  metricsHelper.accessor("calls", {
    header: "Calls",
    size: 90,
    meta: { numeric: true },
    sortFn: "basic",
  }),
  metricsHelper.accessor("p50Ms", {
    header: "p50",
    size: 90,
    meta: { numeric: true },
    sortFn: "basic",
    cell: ({ getValue }) => `${getValue()} ms`,
  }),
  metricsHelper.accessor("costUsd", {
    header: "Cost",
    size: 100,
    meta: { numeric: true },
    sortFn: "basic",
    cell: ({ getValue }) => `$${getValue().toFixed(4)}`,
  }),
  metricsHelper.accessor("minConfidence", {
    header: "Min confidence",
    size: 130,
    sortFn: "basic",
    cell: ({ getValue, row }) => (
      <RunConfidenceCell
        value={{
          confidence: getValue(),
          nodeId: row.original.id,
          nodeName: row.original.node,
          kind: "choice",
          decisions: 1,
        }}
      />
    ),
  }),
]);
const METRICS: Metric[] = [
  {
    id: "intent",
    node: "Intent",
    kind: "decision.choice",
    calls: 1204,
    p50Ms: 612,
    costUsd: 0.0014,
    minConfidence: 0.52,
  },
  {
    id: "urgency",
    node: "Urgency",
    kind: "decision.score",
    calls: 1204,
    p50Ms: 540,
    costUsd: 0.0011,
    minConfidence: 0.61,
  },
  {
    id: "escalation",
    node: "Escalation",
    kind: "decision.boolean",
    calls: 1198,
    p50Ms: 405,
    costUsd: 0.0009,
    minConfidence: 0.48,
  },
  {
    id: "lookup",
    node: "Lookup account",
    kind: "tool.http",
    calls: 1198,
    p50Ms: 212,
    costUsd: 0,
    minConfidence: 1,
  },
  {
    id: "reply",
    node: "Draft reply",
    kind: "generation.text",
    calls: 1141,
    p50Ms: 2890,
    costUsd: 0.0041,
    minConfidence: 1,
  },
  {
    id: "safety",
    node: "Safety check",
    kind: "safety.guard",
    calls: 1141,
    p50Ms: 380,
    costUsd: 0.0006,
    minConfidence: 0.9,
  },
];

function GenericSection() {
  return (
    <Section
      id="generic"
      title="DataTable with typed columns"
      caption="createDataTableColumns<T>() gives a typed helper; meta.numeric right-aligns in mono, meta.grow absorbs spare width. Compact density, no selection, pagination with a 5-row page."
    >
      <DataTable<Metric>
        columns={METRIC_COLUMNS}
        data={METRICS}
        defaultDensity="compact"
        defaultSorting={[{ id: "minConfidence", desc: false }]}
        pagination={{ pageSize: 5, pageSizeOptions: [5, 10, 25] }}
        itemLabel={["node", "nodes"]}
        toolbar={<span className="text-xs text-ink-2">Node metrics · last 24 h</span>}
        aria-label="Node metrics"
      />
    </Section>
  );
}

function VirtualSection() {
  const [count, setCount] = useState(0);
  return (
    <Section
      id="virtual"
      title="Virtualised body"
      caption="1,200 rows. Past 100 rows the body is virtualised with @tanstack/react-virtual; keyboard focus scrolls unmounted rows into view. Sticky header and sticky first column stay put."
    >
      <RunsTable
        runs={MANY_RUNS}
        maxHeight={360}
        selectable
        stickyFirstColumn
        defaultDensity="compact"
        onRowSelectionChange={(s) => setCount(Object.keys(s).length)}
        toolbar={<span className="font-mono text-2xs text-ink-3">selected: {count}</span>}
        showDensityToggle={false}
      />
    </Section>
  );
}

function WorkflowsSection() {
  const [view, setView] = useState<WorkflowsView>("list");
  const [selected, setSelected] = useState<string | undefined>("wf_support_triage");
  return (
    <Section
      id="workflows"
      title="Workflows"
      caption="List/grid toggle. The list is a preset DataTable; the grid renders WorkflowCard. Deployment dots show which environments have a version; the sparkline is 24 hourly buckets."
    >
      <WorkflowsBrowser
        workflows={WORKFLOWS}
        environments={SAMPLE_ENVIRONMENTS}
        view={view}
        onViewChange={setView}
        selectedId={selected}
        onOpen={(w) => setSelected(w.id)}
        toolbar={<span className="text-xs text-ink-2">{WORKFLOWS.length} workflows</span>}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {WORKFLOWS.slice(0, 3).map((w) => (
          <WorkflowCard
            key={w.id}
            workflow={w}
            environments={SAMPLE_ENVIRONMENTS}
            onOpen={(x) => setSelected(x.id)}
            selected={selected === w.id}
          />
        ))}
      </div>
    </Section>
  );
}

function CredentialsSection() {
  return (
    <Section
      id="credentials"
      title="Credentials"
      caption="Provider icon slot (a glyph here), environment badge, scopes as chips with +n overflow, last used, rotate with a promise-aware spinner, delete behind ConfirmDialog."
    >
      <CredentialsTable
        credentials={CREDENTIALS}
        renderProviderIcon={(c) => (
          <span className="font-mono text-2xs font-semibold text-ink-2">
            {PROVIDER_GLYPH[c.provider ?? ""] ?? "?"}
          </span>
        )}
        onRotate={(c) =>
          new Promise<void>((resolve) =>
            setTimeout(() => {
              toast.success(`Rotated ${c.name}`);
              resolve();
            }, 900),
          )
        }
        onDelete={(c) => {
          toast.warning(`Deleted ${c.name}`);
        }}
        onOpen={(c) => toast.info(`Open ${c.name}`)}
        showDensityToggle={false}
      />
    </Section>
  );
}

function ApprovalsSection() {
  const [approvals, setApprovals] = useState(APPROVALS);
  return (
    <Section
      id="approvals"
      title="Approvals queue"
      caption="Waiting time is live. SLA is green above half the window, amber under half, red under a quarter or overdue; the thin bar is elapsed share. Sorted by nearest deadline."
    >
      <ApprovalsTable
        approvals={approvals}
        onReview={(a) => toast.info(`Review ${a.id}`)}
        onAssignToMe={(a) =>
          setApprovals((list) =>
            list.map((x) => (x.id === a.id ? { ...x, assignee: "me", assigneeName: "You" } : x)),
          )
        }
        showColumnMenu={false}
      />
    </Section>
  );
}

function PickerSection() {
  const [value, setValue] = useState<DateRangeValue | null>({ preset: "7d" });
  const [custom, setCustom] = useState<DateRangeValue | null>({
    preset: "custom",
    from: new Date(NOW - 12 * 24 * 60 * 60 * 1000).toISOString(),
    to: new Date(NOW).toISOString(),
  });
  return (
    <Section
      id="daterange"
      title="Date range picker"
      caption="Presets plus a two-month calendar (no deps beyond date-fns). Arrow keys move by day and week, PageUp/PageDown by month, Enter selects start then end. Below: the panel rendered inline, as it appears open."
    >
      <div className="flex flex-wrap items-center gap-3">
        <DateRangePicker value={value} onChange={setValue} label="Created" now={new Date(NOW)} />
        <DateRangePicker value={custom} onChange={setCustom} now={new Date(NOW)} />
        <DateRangePicker value={null} onChange={setValue} size="sm" now={new Date(NOW)} />
        <span className="font-mono text-2xs text-ink-3">
          {value ? JSON.stringify(value) : "null"}
        </span>
      </div>
      <div className="w-fit max-w-full overflow-hidden rounded-md border border-border bg-surface shadow-3">
        <DateRangePanel value={custom} onChange={setCustom} now={new Date(NOW)} />
      </div>
    </Section>
  );
}

function AtomsSection() {
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(50);
  const [sorted, setSorted] = useState<false | "asc" | "desc">("desc");
  const sample = RUNS[3];
  const low = sample ? lowestConfidence(sample) : null;
  const spark = WORKFLOWS[0]?.runs24h ?? [];
  return (
    <Section
      id="atoms"
      title="Pieces"
      caption="Pagination, SortableHeader, RelativeTime, the confidence cell at each gate outcome, and the sparkline on its own."
    >
      <div className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4 shadow-1">
        <div className="flex flex-wrap items-center gap-6">
          <Pagination
            pageIndex={page}
            pageSize={size}
            total={1204}
            onPageIndexChange={setPage}
            onPageSizeChange={(s) => {
              setSize(s);
              setPage(0);
            }}
            showEdges
          />
          <Pagination
            pageIndex={0}
            pageSize={25}
            total={0}
            onPageIndexChange={setPage}
            showPageSize={false}
          />
        </div>
        <div className="flex flex-wrap items-center gap-6 text-2xs font-medium text-ink-2">
          <SortableHeader
            sorted={sorted}
            onClick={() => setSorted((s) => (s === "desc" ? "asc" : s === "asc" ? false : "desc"))}
          >
            Started
          </SortableHeader>
          <SortableHeader sorted="asc" sortIndex={1} multiCount={2}>
            Cost
          </SortableHeader>
          <SortableHeader sorted={false} quiet={false}>
            Duration
          </SortableHeader>
          <SortableHeader canSort={false}>Actions</SortableHeader>
        </div>
        <div className="flex flex-wrap items-center gap-6 text-xs text-ink-2">
          <RelativeTime date={new Date(NOW - 12_000)} mono />
          <RelativeTime date={new Date(NOW - 3 * 60_000)} mono />
          <RelativeTime date={new Date(NOW - 26 * 3_600_000)} mono />
          <RelativeTime date={new Date(NOW - 40 * 86_400_000)} style="long" />
          <RelativeTime date={new Date(NOW + 2 * 3_600_000)} mono />
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <RunConfidenceCell
            value={{
              confidence: 0.96,
              nodeId: "intent",
              nodeName: "Intent",
              kind: "choice",
              decisions: 3,
            }}
          />
          <RunConfidenceCell
            value={{
              confidence: 0.78,
              nodeId: "urgency",
              nodeName: "Urgency",
              kind: "score",
              decisions: 3,
            }}
          />
          <RunConfidenceCell
            value={{
              confidence: 0.54,
              nodeId: "escalation",
              nodeName: "Escalation",
              kind: "boolean",
              decisions: 3,
            }}
          />
          <RunConfidenceCell value={low} />
          <RunConfidenceCell value={null} />
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <RunsSparkline values={spark} />
          <RunsSparkline values={spark} tone="accent" width={120} height={28} />
          <RunsSparkline values={Array.from({ length: 24 }, () => 0)} />
          <RunsSparkline values={[]} />
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DataGallery() {
  const [runsToPlay] = useState<RunView[]>(RUNS);
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-10 p-6 sm:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Data</h1>
        <p className="max-w-2xl text-sm text-ink-2">
          Lists and tables: a typed DataTable on TanStack Table v9, filter chips with URL
          serialisation, a date range picker, and preset tables for runs, workflows, credentials and
          approvals.
        </p>
        <p className="flex items-center gap-2 text-xs text-ink-3">
          <Play className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
          {runsToPlay.length} runs in the sample set
          <Archive className="ml-2 size-3.5" strokeWidth={1.75} aria-hidden="true" />
          {WORKFLOWS.length} workflows
        </p>
      </header>
      <RunsSection />
      <StatesSection />
      <GenericSection />
      <VirtualSection />
      <WorkflowsSection />
      <CredentialsSection />
      <ApprovalsSection />
      <PickerSection />
      <AtomsSection />
      <Toaster />
    </div>
  );
}
