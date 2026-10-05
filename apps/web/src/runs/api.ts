"use client";
/**
 * Queries shared by the run surfaces: the node catalog, workflow names (runs carry ids only, the
 * views show names), and paged event loading.
 */
import { useQuery } from "@tanstack/react-query";
import type { NodeManifest } from "@flowaid/workflow-core";
import { get, getAll, qs } from "~/api/client";
import type { Member, Page, WorkflowSummary } from "~/api/types";
import type { Catalog, EventPage } from "./types";

/** `GET /v1/nodes` as a map by type id (changes only with a deploy, so it is cached for long). */
export function useCatalog(ws: string) {
  return useQuery({
    // its own key: ["catalog", "nodes"] holds the manifest array, this the Map built from it
    // (under that prefix, so installing a plugin refreshes both)
    queryKey: ["catalog", "nodes", "by-id", ws],
    queryFn: async (): Promise<Catalog> =>
      new Map((await get<NodeManifest[]>("/v1/nodes")).map((m) => [m.id, m])),
    staleTime: 10 * 60_000,
  });
}

/** Workflow id → name for the whole workspace (≤ 200 workflows per page; enough for labels). */
export function useWorkflowNames(ws: string) {
  return useQuery({
    // not ["workflow-names", ws]: that caches the page itself, and a Map under the same key
    // broke every page reading `.items` from it after a visit to Runs or Human tasks
    queryKey: ["workflow-names", ws, "by-id"],
    queryFn: async () => {
      const page = await get<Page<WorkflowSummary>>(
        `/v1/workflows${qs({ limit: 200, archived: true })}`,
      );
      return new Map(page.items.map((w) => [w.id, w.name]));
    },
    staleTime: 60_000,
  });
}

/** Every durable event of a run, in `seq` order (the API pages at ≤ 1000). */
export async function fetchAllEvents(runId: string, signal?: AbortSignal): Promise<unknown[]> {
  const out: unknown[] = [];
  let after = 0;
  for (let page = 0; page < 200; page++) {
    const res = await get<EventPage>(
      `/v1/runs/${runId}/events${qs({ after, limit: 1000 })}`,
      signal ? { signal } : undefined,
    );
    out.push(...res.items);
    if (!res.next_cursor) break;
    after = Number(res.next_cursor);
    if (!Number.isFinite(after)) break;
  }
  return out;
}

/** Workspace members (names for assignees and responders; escalation targets). */
export function useMembers(ws: string, workspaceId: string | null) {
  return useQuery({
    queryKey: ["members", ws],
    queryFn: () => getAll<Member>(`/v1/workspaces/${workspaceId as string}/members`),
    enabled: Boolean(workspaceId),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
