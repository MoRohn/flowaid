import { forwardRef, useMemo, type HTMLAttributes } from "react";
import { ArrowRight, ExternalLink, History, Rocket } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge, Button, IconButton, Panel } from "@/primitives";
import {
  workflowDiffCounts,
  workflowNodeChanges,
  type WorkflowNodeChange,
  type WorkflowNodeChangeKind,
} from "@/lib/workflowDiff";
import type { EvaluationMetricView, WorkflowDiff, WorkflowVersionView } from "@/types";
import { MetricsDeltaStrip } from "./MetricsDeltaStrip";
import { SideBySideDiff } from "./SideBySideDiff";

export interface VersionCompareProps extends HTMLAttributes<HTMLDivElement> {
  base: WorkflowVersionView;
  candidate: WorkflowVersionView;
  /** The compiler's `diff(base, candidate)` (`GET /v1/workflow-versions/:id/diff/:other`). */
  diff: WorkflowDiff;
  /** Display name for a node id in the change list; defaults to the id. */
  nodeName?: (nodeId: string) => string | undefined;
  /** Serialised definitions for the text diff; the section is omitted without them. */
  baseSource?: string;
  candidateSource?: string;
  metrics?: EvaluationMetricView[];
  onRollback?: (version: WorkflowVersionView) => void;
  onPromote?: (version: WorkflowVersionView) => void;
  onOpen?: (version: WorkflowVersionView) => void;
  onFocusNode?: (nodeId: string) => void;
  flush?: boolean;
}

const STATUS_TONE: Record<WorkflowVersionView["status"], "ok" | "accent" | "neutral" | "outline"> =
  {
    production: "ok",
    published: "accent",
    draft: "neutral",
    archived: "outline",
  };

const CHANGE_TONE: Record<WorkflowNodeChangeKind, "ok" | "danger" | "warn"> = {
  added: "ok",
  removed: "danger",
  changed: "warn",
};

/** Mono version badge: "v12" plus its lifecycle status. */
export function VersionBadge({
  version,
  className,
}: {
  version: WorkflowVersionView;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="font-mono text-sm font-semibold tabular text-ink">v{version.version}</span>
      <Badge tone={STATUS_TONE[version.status]} dot={version.status === "production"}>
        {version.status}
      </Badge>
    </span>
  );
}

function ChangeRow({
  change,
  name,
  onFocusNode,
}: {
  change: WorkflowNodeChange;
  name: string;
  onFocusNode?: (id: string) => void;
}) {
  return (
    <li className="flex min-h-7 items-center gap-2 px-3 py-1 text-xs">
      <Badge tone={CHANGE_TONE[change.kind]} size="sm" mono className="w-14 justify-center">
        {change.kind}
      </Badge>
      <button
        type="button"
        onClick={() => onFocusNode?.(change.nodeId)}
        className="min-w-0 truncate text-left font-medium text-ink hover:underline"
      >
        {name}
      </button>
      {name !== change.nodeId ? (
        <span className="font-mono text-2xs text-ink-3">{change.nodeId}</span>
      ) : null}
      {change.paths.length > 0 ? (
        <span className="ml-auto truncate font-mono text-2xs text-ink-3">
          {change.paths.join(", ")}
        </span>
      ) : null}
    </li>
  );
}

/**
 * Side-by-side comparison of two workflow versions: version badges, an
 * evaluation metrics strip, the node-level change list from the compiler's
 * `WorkflowDiff` and, when sources are given, a text diff of the
 * definitions, with rollback / promote / open actions.
 */
export const VersionCompare = forwardRef<HTMLDivElement, VersionCompareProps>(
  function VersionCompare(
    {
      base,
      candidate,
      diff,
      nodeName,
      baseSource,
      candidateSource,
      metrics = [],
      onRollback,
      onPromote,
      onOpen,
      onFocusNode,
      flush = false,
      className,
      ...rest
    },
    ref,
  ) {
    const changes = useMemo(() => workflowNodeChanges(diff), [diff]);
    const counts = useMemo(() => workflowDiffCounts(diff), [diff]);

    return (
      <Panel
        ref={ref}
        title="Compare versions"
        icon={<History strokeWidth={1.75} aria-hidden="true" />}
        padded={false}
        flush={flush}
        className={className}
        toolbar={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onOpen?.(candidate)}
              leadingIcon={<ExternalLink strokeWidth={1.75} aria-hidden="true" />}
              className="hidden sm:inline-flex"
            >
              Open
            </Button>
            <IconButton
              size="sm"
              label="Open"
              onClick={() => onOpen?.(candidate)}
              className="sm:hidden"
            >
              <ExternalLink strokeWidth={1.75} />
            </IconButton>
            <Button size="sm" onClick={() => onRollback?.(base)}>
              Rollback
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => onPromote?.(candidate)}
              leadingIcon={<Rocket strokeWidth={1.75} aria-hidden="true" />}
            >
              Promote
            </Button>
          </>
        }
        {...rest}
      >
        <div className="flex flex-col gap-4 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <VersionBadge version={base} />
              <span className="truncate text-2xs text-ink-3">
                {base.message ?? "no message"}
                {base.createdBy ? ` · ${base.createdBy}` : ""}
              </span>
            </div>
            <ArrowRight
              className="size-4 shrink-0 text-ink-3"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <VersionBadge version={candidate} />
              <span className="truncate text-2xs text-ink-3">
                {candidate.message ?? "no message"}
                {candidate.createdBy ? ` · ${candidate.createdBy}` : ""}
              </span>
            </div>
            <span className="ml-auto font-mono text-2xs text-ink-3 tabular">
              {base.nodeCount} → {candidate.nodeCount} nodes
            </span>
          </div>

          {metrics.length > 0 ? <MetricsDeltaStrip metrics={metrics} /> : null}

          <section className="flex flex-col gap-2">
            <header className="flex items-center gap-2">
              <h3 className="text-eyebrow">Node changes</h3>
              <span className="font-mono text-2xs text-ink-3 tabular">
                +{counts.added} −{counts.removed} ~{counts.changed} · edges +{counts.edgesAdded} −
                {counts.edgesRemoved}
                {counts.sectionOps > 0
                  ? ` · ${counts.sectionOps} section ${counts.sectionOps === 1 ? "op" : "ops"}`
                  : ""}
              </span>
            </header>
            {changes.length === 0 ? (
              <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-ink-3">
                {diff.layoutOnly
                  ? "Only the layout differs."
                  : "No node-level differences. Only metadata changed."}
              </p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
                {changes.map((c) => (
                  <ChangeRow
                    key={`${c.kind}-${c.nodeId}`}
                    change={c}
                    name={nodeName?.(c.nodeId) ?? c.nodeId}
                    onFocusNode={onFocusNode}
                  />
                ))}
              </ul>
            )}
          </section>

          {baseSource !== undefined && candidateSource !== undefined ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-eyebrow">Definition</h3>
              <SideBySideDiff
                before={baseSource}
                after={candidateSource}
                beforeLabel={`v${base.version}`}
                afterLabel={`v${candidate.version}`}
              />
            </section>
          ) : null}
        </div>
      </Panel>
    );
  },
);
