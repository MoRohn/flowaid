/** Queries the Overview shares with what it shows above its metrics (the getting-started checklist). */
import { get } from "~/api/client";
import type { Page, WorkflowWithActivity } from "~/api/types";

/**
 * The workspace's workflows with their deployments, for the Overview's workflow filter and the
 * getting-started checklist: one request shared by both.
 */
export const overviewWorkflows = (ws: string) => ({
  queryKey: ["workflows", ws, "overview"],
  queryFn: () => get<Page<WorkflowWithActivity>>("/v1/workflows?limit=200&include=activity"),
  staleTime: 30_000,
});
