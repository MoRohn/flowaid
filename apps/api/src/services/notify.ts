/**
 * Workspace notifications from the API (API.md §3.10): the channel lookup and secret resolution
 * behind `POST /v1/notifications/:id/test` and `webhook.rejected`. The worker sends the run
 * events (`human_task.created`, `run.failed`) and `schedule.failed`.
 */
import { notificationTargets, type Database } from "@flowaid/database";
import type { CredentialService } from "@flowaid/credentials";
import { createNotifier, type Notifier, type SmtpSettings } from "@flowaid/observability";
import type { SafeFetch } from "@flowaid/workflow-core";

export interface ApiNotifyDeps {
  db: Database;
  credentials: CredentialService;
  http: SafeFetch;
  smtp?: SmtpSettings | undefined;
  onError?: (error: unknown, channel: string, event: string) => void;
}

/** A channel's secret (Slack URL or signing secret), stored as an `http.header` credential. */
export async function channelSecret(
  credentials: CredentialService,
  credentialId: string | null,
): Promise<string | undefined> {
  return credentialId ? (await credentials.decrypt(credentialId)).value : undefined;
}

export function apiNotifier(deps: ApiNotifyDeps): Notifier {
  return createNotifier({
    targets: async (workspaceId, event) =>
      (await deps.db.system((tx) => notificationTargets(tx, workspaceId, event))).map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        config: r.config,
        credentialId: r.credentialId,
      })),
    secretFor: (credentialId) => channelSecret(deps.credentials, credentialId),
    fetch: deps.http,
    smtp: deps.smtp,
    onError: (error, channel, event) => deps.onError?.(error, channel?.name ?? "*", event),
  });
}
