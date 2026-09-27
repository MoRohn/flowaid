/**
 * Workspace notifications from the worker (API.md §3.10): `human_task.created` when a run asks a
 * person, `run.failed` when a run fails, `schedule.failed` when a schedule cannot start its run.
 * Channels come from the `notifications` table; their secrets from their credential.
 */
import { notificationTargets, type Database } from "@flowaid/database";
import type { CredentialService } from "@flowaid/credentials";
import { createNotifier, type Notifier, type SmtpSettings } from "@flowaid/observability";
import type { DurableRunEvent, SafeFetch } from "@flowaid/workflow-core";

export interface NotifyDeps {
  db: Database;
  credentials: CredentialService;
  http: SafeFetch;
  smtp?: SmtpSettings | undefined;
  onError?: (error: unknown, channel: string, event: string) => void;
}

export function workspaceNotifier(deps: NotifyDeps): Notifier {
  return createNotifier({
    targets: async (workspaceId, event) =>
      (await deps.db.system((tx) => notificationTargets(tx, workspaceId, event))).map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        config: r.config,
        credentialId: r.credentialId,
      })),
    secretFor: async (credentialId) => (await deps.credentials.decrypt(credentialId)).value,
    fetch: deps.http,
    smtp: deps.smtp,
    onError: (error, channel, event) => deps.onError?.(error, channel?.name ?? "*", event),
  });
}

/** The notifications a batch of run events calls for. */
export function runNotifications(
  events: readonly DurableRunEvent[],
  run: { id: string; workspaceId: string; workflowName: string; workspaceSlug: string },
  webUrl: string | null,
  now: () => Date,
): Parameters<Notifier["notify"]>[0][] {
  const base = webUrl ? webUrl.replace(/\/$/, "") : null;
  const out: Parameters<Notifier["notify"]>[0][] = [];
  for (const e of events) {
    if (e.type === "HUMAN_APPROVAL_REQUESTED") {
      out.push({
        event: "human_task.created",
        workspaceId: run.workspaceId,
        title: `Waiting for you: ${e.request.title}`,
        text: `${run.workflowName} is waiting for a person at "${e.nodeId}".`,
        ...(base ? { url: `${base}/${run.workspaceSlug}/human-tasks/${e.humanTaskId}` } : {}),
        details: { runId: run.id, humanTaskId: e.humanTaskId, nodeId: e.nodeId },
        at: now().toISOString(),
      });
    } else if (e.type === "RUN_FAILED") {
      out.push({
        event: "run.failed",
        workspaceId: run.workspaceId,
        title: `Run failed: ${run.workflowName}`,
        text: `${e.error.code}: ${e.error.message}`,
        ...(base ? { url: `${base}/${run.workspaceSlug}/runs/${run.id}` } : {}),
        details: { runId: run.id, code: e.error.code },
        at: now().toISOString(),
      });
    }
  }
  return out;
}
