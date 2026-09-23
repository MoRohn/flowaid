import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import { DecisionBadge } from "@/decision";
import { Button, CategoryDot, Collapsible, LogoMark, StatusChip } from "@/primitives";
import type { NodeRunView } from "@/types";
import { ApprovalCard, type ApprovalCardProps } from "./ApprovalCard";

export interface ReviewPageProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Everything the card needs; `workflowName` is also used in the page header. */
  card: ApprovalCardProps;
  /** Node runs so far, in execution order. */
  nodeRuns?: NodeRunView[];
  runId?: string;
  /** Opens the full run in the app (external reviewers may not have access). */
  onOpenRun?: () => void;
  /** "Run so far" starts open. Default false. */
  defaultRunOpen?: boolean;
  /** Replaces the wordmark area (a customer logo, a workspace name). */
  brand?: ReactNode;
}

/** One compact row per node run: category, name, kind, status, decision, duration. */
export function ReviewRunRow({ run }: { run: NodeRunView }) {
  return (
    <li className="flex min-h-8 items-center gap-2.5 px-2 text-xs">
      <CategoryDot category={run.category} size={7} />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium text-ink">{run.nodeName}</span>
        <span className="ml-1.5 font-mono text-2xs text-ink-3">{run.nodeType}</span>
        {run.attempt > 1 ? (
          <span className="ml-1.5 font-mono text-2xs text-ink-3">×{run.attempt}</span>
        ) : null}
      </span>
      {run.decision ? <DecisionBadge result={run.decision} size="sm" distribution={false} /> : null}
      {run.routeTaken ? (
        <span className="font-mono text-2xs text-ink-3">→ {run.routeTaken}</span>
      ) : null}
      <StatusChip status={run.status} size="sm" compact />
      <span className="w-14 text-right font-mono text-2xs text-ink-3 tabular">
        {run.durationMs !== undefined ? formatMs(run.durationMs) : "—"}
      </span>
    </li>
  );
}

/**
 * Shell-free review page for the external approval link: a centred 640px
 * column with the ApprovalCard and a collapsible "Run so far" list of the
 * node runs that led here. It imports nothing from the app shell so it can
 * be served on its own route.
 */
export const ReviewPage = forwardRef<HTMLDivElement, ReviewPageProps>(function ReviewPage(
  { card, nodeRuns = [], runId, onOpenRun, defaultRunOpen = false, brand, className, ...rest },
  ref,
) {
  const completed = nodeRuns.filter((r) => r.status === "completed").length;
  return (
    <div
      ref={ref}
      className={cn("min-h-full w-full bg-canvas px-4 py-6 sm:py-10", className)}
      {...rest}
    >
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
        <header className="flex items-center gap-3 px-1">
          {brand ?? (
            <span className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-ink">
              <LogoMark size={18} accent />
              {card.workflowName ?? "Review"}
            </span>
          )}
          {runId ? <span className="font-mono text-2xs text-ink-3">{runId}</span> : null}
          <span className="flex-1" />
          {onOpenRun ? (
            <Button
              size="sm"
              variant="ghost"
              trailingIcon={<ExternalLink strokeWidth={1.75} aria-hidden="true" />}
              onClick={onOpenRun}
            >
              Open run
            </Button>
          ) : null}
        </header>

        <ApprovalCard {...card} />

        {nodeRuns.length > 0 ? (
          <Collapsible
            title="Run so far"
            meta={`${completed}/${nodeRuns.length} steps`}
            defaultOpen={defaultRunOpen}
            className="rounded-md border border-border bg-surface px-2 py-1 shadow-1"
            contentClassName="pl-0"
          >
            <ul role="list" className="divide-y divide-border">
              {nodeRuns.map((run) => (
                <ReviewRunRow key={run.id} run={run} />
              ))}
            </ul>
          </Collapsible>
        ) : null}

        <p className="m-0 px-1 text-center text-2xs text-ink-3">
          Your response is recorded on the run's audit trail and resumes the workflow.
        </p>
      </div>
    </div>
  );
});
