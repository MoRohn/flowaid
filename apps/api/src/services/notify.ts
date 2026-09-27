/**
 * Notification channel secrets for the API (API.md §3.10): the Slack URL or webhook signing secret
 * behind `POST /v1/notifications/:id/test`. Real events go through the alert dispatcher
 * (`services/alerts.ts`); both deliver with `@flowaid/observability`'s one sender.
 */
import type { CredentialService } from "@flowaid/credentials";

/** A channel's secret (Slack URL or signing secret), stored as an `http.header` credential. */
export async function channelSecret(
  credentials: CredentialService,
  credentialId: string | null,
): Promise<string | undefined> {
  return credentialId ? (await credentials.decrypt(credentialId)).value : undefined;
}
