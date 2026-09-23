import { forwardRef, type HTMLAttributes, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import type { RunStatus } from "@/lib/categories";
import type { EnvironmentId, EnvironmentView } from "@/types";
import { Badge, Card, StatusChip, Tooltip } from "@/primitives";
import { RelativeTime } from "./RelativeTime";
import { RunsSparkline } from "./RunsSparkline";

export type WorkflowVersionStatus = "draft" | "published" | "production";

export interface WorkflowDeploymentView {
  /** Environment id (environments are workspace data, see `EnvironmentDots.environments`). */
  environment: EnvironmentId;
  version: number;
}

/** A workflow as the list page sees it. */
export interface WorkflowListItemView {
  id: string;
  name: string;
  description?: string;
  /** Latest version number, or undefined while only a draft exists. */
  version?: number;
  versionStatus: WorkflowVersionStatus;
  lastRunStatus?: RunStatus;
  lastRunAt?: string;
  /** Runs per hour over the last 24 hours: 24 points. */
  runs24h: number[];
  updatedAt: string;
  deployments: WorkflowDeploymentView[];
  owner?: string;
  tags?: string[];
}

export const VERSION_STATUS_LABEL: Record<WorkflowVersionStatus, string> = {
  draft: "Draft",
  published: "Published",
  production: "Production",
};

export function VersionStatusBadge({
  status,
  className,
}: {
  status: WorkflowVersionStatus;
  className?: string;
}) {
  return (
    <Badge
      tone={status === "production" ? "ok" : status === "published" ? "neutral" : "outline"}
      dot={status !== "draft"}
      className={className}
    >
      {VERSION_STATUS_LABEL[status]}
    </Badge>
  );
}

/** "Production" → "prod", "Staging" → "stg", "Development" → "dev": the first three letters, lower-cased. */
export function environmentAbbreviation(name: string): string {
  return name.trim().slice(0, 3).toLowerCase();
}

/** One dot per workspace environment, filled when a version is deployed there; protected environments read in the ok tone. */
export function EnvironmentDots({
  environments,
  deployments,
  className,
}: {
  environments: readonly EnvironmentView[];
  deployments: WorkflowDeploymentView[];
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-label="Deployments">
      {environments.map((env) => {
        const d = deployments.find((x) => x.environment === env.id);
        return (
          <Tooltip
            key={env.id}
            content={d ? `${env.name} · v${d.version}` : `${env.name} · not deployed`}
          >
            <span
              tabIndex={-1}
              aria-label={d ? `${env.name} v${d.version}` : `${env.name} not deployed`}
              className={cn(
                "inline-flex h-4 items-center gap-1 rounded-xs px-1 font-mono text-2xs uppercase tabular",
                d
                  ? env.protected
                    ? "bg-ok-soft text-ok-text"
                    : "bg-surface-3 text-ink-2"
                  : "text-ink-3",
              )}
            >
              <span
                aria-hidden="true"
                className={cn("size-1.5 rounded-full", d ? "bg-current" : "border border-current")}
              />
              {environmentAbbreviation(env.name)}
            </span>
          </Tooltip>
        );
      })}
    </span>
  );
}

export interface WorkflowCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  workflow: WorkflowListItemView;
  /** The workspace's environments, for the deployment dots. */
  environments: readonly EnvironmentView[];
  onOpen?: (workflow: WorkflowListItemView) => void;
  selected?: boolean;
}

/**
 * Card view of a workflow: name, description, version status, last run
 * status, a 24-point run sparkline, deployment dots and updated time.
 */
export const WorkflowCard = forwardRef<HTMLDivElement, WorkflowCardProps>(function WorkflowCard(
  { workflow, environments, onOpen, selected = false, className, ...rest },
  ref,
) {
  const runs = workflow.runs24h.reduce((a, b) => a + b, 0);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
      e.preventDefault();
      onOpen?.(workflow);
    }
  };
  return (
    <Card
      ref={ref}
      interactive={Boolean(onOpen)}
      selected={selected}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={() => onOpen?.(workflow)}
      onKeyDown={onOpen ? onKeyDown : undefined}
      aria-label={onOpen ? `Open ${workflow.name}` : undefined}
      className={cn("gap-0 p-0", className)}
      {...rest}
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-ink">{workflow.name}</span>
          <span className="line-clamp-2 min-h-[2lh] text-xs text-ink-3">
            {workflow.description ?? "No description"}
          </span>
        </div>
        <VersionStatusBadge status={workflow.versionStatus} className="shrink-0" />
      </div>
      <div className="mt-3 flex items-end justify-between gap-3 px-4">
        <div className="flex flex-col gap-1">
          <span className="text-eyebrow">Runs · 24h</span>
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-md font-medium tabular text-ink">{runs}</span>
            {workflow.lastRunStatus ? (
              <StatusChip status={workflow.lastRunStatus} size="sm" />
            ) : (
              <span className="text-2xs text-ink-3">no runs yet</span>
            )}
          </span>
        </div>
        <RunsSparkline values={workflow.runs24h} width={96} height={28} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border px-4 py-2">
        <EnvironmentDots environments={environments} deployments={workflow.deployments} />
        <span className="flex items-center gap-1 font-mono text-2xs text-ink-3 tabular">
          {workflow.version !== undefined ? <span>v{workflow.version}</span> : <span>draft</span>}
          <span aria-hidden="true">·</span>
          <RelativeTime date={workflow.updatedAt} />
        </span>
      </div>
    </Card>
  );
});
