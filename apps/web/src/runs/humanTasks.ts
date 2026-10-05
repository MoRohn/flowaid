/** Human task rows → inbox and review views. Pure. */
import type { ApprovalRequestView } from "@flowaid/ui";
import type { PendingApprovalView } from "@flowaid/ui/data";
import type { ApprovalRecord } from "@flowaid/ui/human";
import { ApiError } from "~/api/client";
import type { HumanTask, Member } from "~/api/types";
import type { ExternalReviewView } from "./types";

/** `approve_refund` → "Approve refund" (task rows carry the node id, not its name). */
export function humanizeId(id: string): string {
  const words = id.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : id;
}

export function taskToPending(
  task: HumanTask,
  workflowName: string,
  members: readonly Member[] = [],
): PendingApprovalView {
  const assignee = task.assignees[0];
  const member = assignee ? members.find((m) => m.userId === assignee) : undefined;
  const view: PendingApprovalView = {
    id: task.id,
    runId: task.runId,
    nodeId: task.nodeId,
    nodeName: task.nodeName ?? humanizeId(task.nodeId),
    request: task.request,
    requestedAt: task.createdAt,
    workflowId: task.workflowId,
    workflowName,
  };
  if (assignee) view.assigneeName = member?.name || member?.email || assignee;
  return view;
}

/** Resolved, by outcome: the statuses each asks the API for. */
export const INBOX_OUTCOMES = [
  { id: "all", label: "All", status: "responded,expired,cancelled" },
  { id: "answered", label: "Answered", status: "responded" },
  { id: "expired", label: "Expired", status: "expired" },
  { id: "cancelled", label: "Cancelled", status: "cancelled" },
] as const;
export type InboxOutcome = (typeof INBOX_OUTCOMES)[number]["id"];

/** The API query for a tab: Resolved covers every closed status, narrowed by outcome. */
export function inboxQuery(
  tab: "open" | "mine" | "resolved",
  outcome: InboxOutcome = "all",
  workflowId?: string,
): Record<string, string | boolean | undefined> {
  if (tab === "mine") return { status: "open", assignedToMe: true };
  if (tab === "open") return { status: "open" };
  return {
    status: INBOX_OUTCOMES.find((o) => o.id === outcome)?.status ?? INBOX_OUTCOMES[0].status,
    workflowId,
  };
}

/**
 * Why a task closed without an answer. A task is "cancelled" whenever its run ends first, so the
 * run's status says how: cancelled, out of time, or failed.
 */
export function closedTaskNote(
  status: "expired" | "cancelled",
  runStatus: string | undefined,
): string {
  if (status === "expired")
    return "Nobody answered before this task expired; the workflow went on as its expiry setting says.";
  if (runStatus === "timed_out")
    return "The run reached its time limit before anyone answered, so this task closed.";
  if (runStatus === "failed") return "The run failed before anyone answered, so this task closed.";
  if (runStatus === "cancelled")
    return "The run was cancelled before anyone answered, so this task no longer needs an answer.";
  return "The run ended before anyone answered, so this task no longer needs an answer.";
}

/**
 * A 409 for a task that already has its answer (a double submit, another tab, the external link):
 * the answer the person meant to give is recorded, so it is not a failure.
 */
export function alreadyAnswered(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409 && /responded|answered/.test(e.message);
}

/** What the card shows once the task is answered. */
export function respondedRecord(
  task: HumanTask,
  members: readonly Member[] = [],
): ApprovalRecord | undefined {
  if (!task.response || !task.respondedAt) return undefined;
  const by = task.respondedBy ?? undefined;
  const member = by ? members.find((m) => m.userId === by) : undefined;
  const who =
    member?.name || member?.email || (by?.startsWith("review_token:") ? "External reviewer" : by);
  return { response: task.response, at: task.respondedAt, ...(who ? { by: who } : {}) };
}

/** The external page's card: only the fields `GET /v1/review` returns, never run internals. */
export function externalToApproval(v: ExternalReviewView): ApprovalRequestView {
  return {
    // No ids of any kind reach this page; the card's id slot stays empty.
    id: "",
    runId: "",
    nodeId: "review",
    nodeName: "Review request",
    request: {
      title: v.title,
      context: v.context as ApprovalRequestView["request"]["context"],
      mode: v.mode,
      assignees: [],
      expiresAt: v.expiresAt,
      externalReview: true,
      origin: "human_node",
    },
    requestedAt: new Date().toISOString(),
    reason: "You were sent this link to review one step of a workflow",
  };
}

/** Reads `#t=<token>` from a URL fragment. */
export function tokenFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const t = params.get("t");
  return t && /^[A-Za-z0-9_-]{16,}$/.test(t) ? t : null;
}
