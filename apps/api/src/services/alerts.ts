/**
 * The alert dispatcher (P6-04): notification channels from `notifications`, deliveries claimed in
 * `alert_deliveries`, channel secrets decrypted by the credential service.
 */
import {
  alertChannels,
  claimAlertDelivery,
  finishAlertDelivery,
  type Database,
} from "@flowaid/database";
import type { CredentialService } from "@flowaid/credentials";
import { AlertDispatcher, type AlertFetch, type SmtpConfig } from "@flowaid/observability";

export function createAlertDispatcher(deps: {
  db: Database;
  credentials: CredentialService;
  fetch: AlertFetch;
  smtp?: SmtpConfig | null;
  onError?: (error: unknown, context: { channelId?: string; event: string }) => void;
}): AlertDispatcher {
  return new AlertDispatcher({
    fetch: deps.fetch,
    smtp: deps.smtp ?? null,
    ...(deps.onError ? { onError: deps.onError } : {}),
    store: {
      channels: (workspaceId, event) => alertChannels(deps.db, workspaceId, event),
      claim: (input) => claimAlertDelivery(deps.db, input),
      finish: (id, result) => finishAlertDelivery(deps.db, id, result),
      secret: (_workspaceId, credentialId) => deps.credentials.decrypt(credentialId),
    },
  });
}

/** `SMTP_URL` + `SMTP_FROM` → the SMTP settings of email channels, or null. */
export function smtpFromEnv(
  env: { SMTP_URL?: string | undefined; SMTP_FROM?: string | undefined } | undefined,
) {
  return env?.SMTP_URL && env.SMTP_FROM ? { url: env.SMTP_URL, from: env.SMTP_FROM } : null;
}
