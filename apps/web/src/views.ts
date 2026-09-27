/** API rows → @flowaid/ui view types. */
import type { EnvironmentView } from "@flowaid/ui";
import type { WorkflowListItemView } from "@flowaid/ui/data";
import type { Environment, WorkflowWithActivity } from "~/api/types";

export function toEnvironmentViews(envs: readonly Environment[]): EnvironmentView[] {
  return envs.map((e) => ({ id: e.id, name: e.name, protected: e.protected }));
}

export function toWorkflowListItem(
  w: WorkflowWithActivity,
  envs: readonly Environment[],
): WorkflowListItemView {
  const protectedIds = new Set(envs.filter((e) => e.protected).map((e) => e.id));
  const deployments = w.deployments
    .filter((d): d is { environmentId: string; version: number } => d.version !== null)
    .map((d) => ({ environment: d.environmentId, version: d.version }));
  return {
    id: w.id,
    name: w.name,
    ...(w.description ? { description: w.description } : {}),
    ...(w.latestVersion !== null ? { version: w.latestVersion } : {}),
    versionStatus:
      w.latestVersion === null
        ? "draft"
        : deployments.some((d) => protectedIds.has(d.environment))
          ? "production"
          : "published",
    ...(w.lastRun ? { lastRunStatus: w.lastRun.status, lastRunAt: w.lastRun.createdAt } : {}),
    runs24h: w.runs24h,
    updatedAt: w.updatedAt,
    deployments,
    tags: w.tags,
  };
}
