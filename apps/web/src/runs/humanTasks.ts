/** Human task rows → inbox and review views. Pure. */
import type { ApprovalRequestView } from "@flowaid/ui";
import type { PendingApprovalView } from "@flowaid/ui/data";
import type { ApprovalRecord } from "@flowaid/ui/human";
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
    nodeName: humanizeId(task.nodeId),
    request: task.request,
    requestedAt: task.createdAt,
    workflowId: task.workflowId,
    workflowName,
  };
  if (assignee) view.assigneeName = member?.name || member?.email || assignee;
  return view;
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
