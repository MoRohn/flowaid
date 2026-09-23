import { useMemo, type ReactNode } from "react";
import {
  Clock,
  Ellipsis,
  ExternalLink,
  FlaskConical,
  GitFork,
  Layers,
  MousePointerClick,
  Plug,
  RefreshCw,
  RotateCw,
  Square,
  Webhook,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { ORIGIN_LABEL, type RunOrigin } from "@/lib/categories";
import { ConfidenceSparkbar } from "@/decision";
import { formatCost, formatMs, formatProbability, formatTokens } from "@/lib/format";
import { gateOutcome, type ConfidenceThresholds, type DecisionKind, type RunView } from "@/types";
import {
  Badge,
  CopyButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Hint,
  IconButton,
  StatusChip,
  Tooltip,
} from "@/primitives";
import {
  createDataTableColumns,
  DataTable,
  type DataTableColumns,
  type DataTableProps,
} from "./DataTable";
import { RelativeTime } from "./RelativeTime";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface LowestConfidence {
  confidence: number;
  nodeId: string;
  nodeName: string;
  kind: DecisionKind;
  /** Number of decisions in the run. */
  decisions: number;
}

/** The least confident decision in a run, or null when no node decided anything. */
export function lowestConfidence(run: Pick<RunView, "nodeRuns">): LowestConfidence | null {
  let best: LowestConfidence | null = null;
  let decisions = 0;
  for (const n of run.nodeRuns) {
    const d = n.decision;
    if (!d || !Number.isFinite(d.confidence)) continue;
    decisions++;
    if (best === null || d.confidence < best.confidence) {
      best = {
        confidence: d.confidence,
        nodeId: n.nodeId,
        nodeName: n.nodeName,
        kind: d.kind,
        decisions: 0,
      };
    }
  }
  if (best) best.decisions = decisions;
  return best;
}

/** One icon per `RunOrigin` (exhaustive: a new origin in workflow-core fails to compile here). */
export const ORIGIN_ICON: Record<RunOrigin, ReactNode> = {
  api: <Zap className="size-3.5" strokeWidth={1.75} aria-hidden="true" />,
  ui: <MousePointerClick className="size-3.5" strokeWidth={1.75} aria-hidden="true" />,
  webhook: <Webhook className="size-3.5" strokeWidth={1.75} aria-hidden="true" />,
  schedule: <Clock className="size-3.5" strokeWidth={1.75} aria-hidden="true" />,
  mcp: <Plug className="size-3.5" strokeWidth={1.75} aria-hidden="true" />,
  evaluation: <FlaskConical className="size-3.5" strokeWidth={1.75} aria-hidden="true" />,
  subflow: <Layers className="size-3.5" strokeWidth={1.75} aria-hidden="true" />,
  replay: <RotateCw className="size-3.5" strokeWidth={1.75} aria-hidden="true" />,
  restart: <RefreshCw className="size-3.5" strokeWidth={1.75} aria-hidden="true" />,
  fork: <GitFork className="size-3.5" strokeWidth={1.75} aria-hidden="true" />,
};

const ACTIVE_STATUSES = new Set<RunView["status"]>([
  "queued",
  "starting",
  "running",
  "waiting",
  "waiting_for_human",
  "retrying",
]);

/** Whether a run can still be cancelled. */
export function runIsActive(run: Pick<RunView, "status">): boolean {
  return ACTIVE_STATUSES.has(run.status);
}

export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = { review: 0.7, auto: 0.9 };

export interface RunConfidenceCellProps {
  value: LowestConfidence | null;
  thresholds?: ConfidenceThresholds;
  className?: string;
}

/**
 * Lowest confidence of a run as the decision group's `ConfidenceSparkbar`
 * (48px track, gate thresholds as ticks, fill tinted by outcome). The
 * tooltip names the node that produced it; runs without decisions show "—".
 */
export function RunConfidenceCell({
  value,
  thresholds = DEFAULT_CONFIDENCE_THRESHOLDS,
  className,
}: RunConfidenceCellProps) {
  if (!value) return <span className="font-mono text-xs text-ink-3">—</span>;
  const gate = gateOutcome(value.confidence, thresholds);
  const outcome = gate === "pass" ? "pass" : gate === "review" ? "review" : "fail";
  return (
    <Tooltip
      content={
        <span>
          {value.nodeName} · {value.kind} · {outcome}
          {value.decisions > 1 ? ` · lowest of ${value.decisions}` : ""}
        </span>
      }
    >
      <span
        data-gate={gate}
        className={cn("inline-flex items-center", className)}
        aria-label={`Lowest confidence ${formatProbability(value.confidence)} at ${value.nodeName}`}
      >
        <ConfidenceSparkbar
          value={value.confidence}
          thresholds={thresholds}
          aria-hidden="true"
          hint={false}
        />
      </span>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export interface RunsTableProps extends Omit<
  DataTableProps<RunView>,
  "columns" | "data" | "itemLabel"
> {
  runs: readonly RunView[];
  onOpen?: (run: RunView) => void;
  onReplay?: (run: RunView) => void;
  onCancel?: (run: RunView) => void;
  thresholds?: ConfidenceThresholds;
  /** Extra columns appended before the actions menu. */
  extraColumns?: DataTableColumns<RunView>;
}

const helper = createDataTableColumns<RunView>();

/**
 * Preset DataTable for runs: status, copyable id, workflow + version,
 * origin, started (relative), duration, cost, tokens, the lowest decision
 * confidence as a sparkbar, and an actions menu (open, replay, cancel).
 */
export function RunsTable({
  runs,
  onOpen,
  onReplay,
  onCancel,
  thresholds = DEFAULT_CONFIDENCE_THRESHOLDS,
  extraColumns,
  defaultSorting,
  onRowActivate,
  ...rest
}: RunsTableProps) {
  const columns = useMemo<DataTableColumns<RunView>>(() => {
    const base = helper.columns([
      helper.accessor("status", {
        header: "Status",
        size: 150,
        minSize: 120,
        cell: ({ getValue }) => <StatusChip status={getValue()} size="sm" />,
      }),
      helper.accessor("id", {
        header: "Run",
        size: 176,
        minSize: 130,
        meta: { mono: true },
        cell: ({ getValue }) => {
          const id = getValue();
          return (
            <span className="group/id flex min-w-0 items-center gap-1">
              <Hint hint={id} announce={false} className="truncate text-ink-2">
                {id}
              </Hint>
              <span
                role="presentation"
                className="flex shrink-0"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <CopyButton
                  value={id}
                  size="xs"
                  label="Copy run id"
                  className="opacity-0 transition-opacity duration-(--dur-fast) group-hover/id:opacity-100 focus-visible:opacity-100"
                />
              </span>
            </span>
          );
        },
      }),
      helper.accessor("workflowName", {
        header: "Workflow",
        size: 220,
        minSize: 160,
        meta: { grow: true },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium text-ink">{row.original.workflowName}</span>
            <Badge mono tone={row.original.version === "draft" ? "outline" : "neutral"} size="sm">
              {row.original.version === "draft" ? "draft" : `v${row.original.version}`}
            </Badge>
            {row.original.environment && !row.original.environment.protected ? (
              <Badge tone="outline" size="sm">
                {row.original.environment.name}
              </Badge>
            ) : null}
          </span>
        ),
      }),
      helper.accessor("origin", {
        header: "Origin",
        size: 110,
        minSize: 90,
        cell: ({ getValue }) => {
          const o = getValue();
          return (
            <span className="flex items-center gap-1.5 text-ink-2">
              <span className="text-ink-3">{ORIGIN_ICON[o]}</span>
              {ORIGIN_LABEL[o]}
            </span>
          );
        },
      }),
      helper.accessor("createdAt", {
        header: "Started",
        size: 110,
        minSize: 90,
        sortFn: "datetime",
        sortDescFirst: true,
        cell: ({ getValue }) => <RelativeTime date={getValue()} mono className="text-ink-2" />,
      }),
      helper.accessor((r) => r.durationMs, {
        id: "duration",
        header: "Duration",
        size: 96,
        minSize: 92,
        sortFn: "basic",
        sortUndefined: "last",
        meta: { numeric: true },
        cell: ({ getValue }) => {
          const v = getValue();
          return v === undefined ? (
            <span className="text-ink-3">—</span>
          ) : (
            <span className="text-ink-2">{formatMs(v)}</span>
          );
        },
      }),
      helper.accessor((r) => r.costUsd, {
        id: "cost",
        header: "Cost",
        size: 88,
        minSize: 72,
        sortFn: "basic",
        sortUndefined: "last",
        meta: { numeric: true },
        cell: ({ getValue }) => {
          const v = getValue();
          return v === undefined ? (
            <span className="text-ink-3">—</span>
          ) : (
            <span className="text-ink-2">{formatCost(v)}</span>
          );
        },
      }),
      helper.accessor((r) => (r.usage ? r.usage.inputTokens + r.usage.outputTokens : undefined), {
        id: "tokens",
        header: "Tokens",
        size: 88,
        minSize: 72,
        sortFn: "basic",
        sortUndefined: "last",
        meta: { numeric: true },
        cell: ({ getValue, row }) => {
          const v = getValue();
          if (v === undefined) return <span className="text-ink-3">—</span>;
          const t = row.original.usage;
          return (
            <Tooltip
              content={
                <span className="font-mono tabular">
                  {formatTokens(t?.inputTokens ?? 0)} in · {formatTokens(t?.outputTokens ?? 0)} out
                </span>
              }
            >
              <span className="text-ink-2">{formatTokens(v)}</span>
            </Tooltip>
          );
        },
      }),
      helper.accessor((r) => lowestConfidence(r)?.confidence, {
        id: "confidence",
        header: "Decisions",
        size: 120,
        minSize: 100,
        sortFn: "basic",
        sortUndefined: "last",
        meta: { title: "Lowest confidence" },
        cell: ({ row }) => (
          <RunConfidenceCell value={lowestConfidence(row.original)} thresholds={thresholds} />
        ),
      }),
    ]);
    const actions = helper.display({
      id: "actions",
      header: "",
      size: 44,
      minSize: 44,
      maxSize: 44,
      enableSorting: false,
      enableHiding: false,
      enableResizing: false,
      meta: { locked: true, title: "Actions", align: "center", className: "px-1" },
      cell: ({ row }) => {
        const run = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                size="sm"
                label={`Actions for ${run.id}`}
                tooltip={false}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                className="text-ink-3"
              >
                <Ellipsis strokeWidth={1.75} />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem
                icon={<ExternalLink strokeWidth={1.75} />}
                onSelect={() => onOpen?.(run)}
                disabled={!onOpen}
              >
                Open run
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<RotateCw strokeWidth={1.75} />}
                onSelect={() => onReplay?.(run)}
                disabled={!onReplay}
              >
                Replay
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                icon={<Square strokeWidth={1.75} />}
                destructive
                disabled={!onCancel || !runIsActive(run)}
                onSelect={() => onCancel?.(run)}
              >
                Cancel run
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    });
    return [...base, ...(extraColumns ?? []), actions];
  }, [thresholds, onOpen, onReplay, onCancel, extraColumns]);

  return (
    <DataTable<RunView>
      columns={columns}
      data={runs}
      itemLabel={["run", "runs"]}
      defaultSorting={defaultSorting ?? [{ id: "createdAt", desc: true }]}
      onRowActivate={onRowActivate ?? onOpen}
      aria-label="Runs"
      {...rest}
    />
  );
}
