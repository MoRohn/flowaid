"use client";
/**
 * What the workspace frame derives from the page: the document title from its breadcrumbs
 * (WCAG 2.4.2), and the open human tasks behind the nav badge and the ⌘K "Pending approvals".
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { get, qs } from "~/api/client";
import type { HumanTask, Page } from "~/api/types";
import type { Session } from "~/session";

const PRODUCT = "FlowAId";

/**
 * "Runs · My workspace · FlowAId": the crumbs from the current page back to the workspace.
 * Placeholder crumbs ("…" while a name loads) are skipped; the workspace is added when a page's
 * crumbs leave it out.
 */
export function documentTitle(crumbs: readonly { label: string }[], workspaceName: string): string {
  const labels = crumbs.map((c) => c.label.trim()).filter((l) => l && l !== "…");
  if (!labels.includes(workspaceName)) labels.unshift(workspaceName);
  return [...labels.reverse(), PRODUCT].join(" · ");
}

/** Sets `document.title` while the page is mounted and puts the previous one back after. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

/** How many open tasks one request counts; the badge reads "100" past that. */
export const PENDING_LIMIT = 100;

/**
 * Open human tasks (the inbox's "Open" tab), refreshed every minute. The key sits under
 * `["human-tasks", ws]`, so answering a task in the inbox invalidates the badge too.
 */
export function usePendingTasks(s: Pick<Session, "ws" | "features" | "can">) {
  return useQuery({
    queryKey: ["human-tasks", s.ws, "pending"],
    queryFn: ({ signal }) =>
      get<Page<HumanTask>>(`/v1/human-tasks${qs({ status: "open", limit: PENDING_LIMIT })}`, {
        signal,
      }),
    enabled: s.features.human_tasks === true && s.can("runs:read"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
