/**
 * Notification channels as the settings UI and the test-send route see them (ARCHITECTURE.md
 * §9.3, API.md §3.10). Delivery is the same code the alert dispatcher uses (`sendAlert`): a test
 * send posts exactly what a real alert would, with the same payload, headers and signature
 * (`X-FlowAId-Signature: sha256=…` over `<timestamp>.<body>`, `X-FlowAId-Timestamp`).
 */
import type { JsonObject, SafeFetch } from "@flowaid/workflow-core";
import { ALERT_EVENTS, sendAlert, type AlertEvent, type SmtpConfig } from "./alerts.js";

export const NOTIFICATION_EVENTS = ALERT_EVENTS;
export type NotificationEvent = AlertEvent;

export const NOTIFICATION_EVENT_LABELS: Readonly<Record<NotificationEvent, string>> = {
  "human_task.created": "A run is waiting for a person",
  "run.failed": "A run failed",
  "trace_review.page": "A trace review needs attention",
  "schedule.failed": "A schedule could not start its run",
  "webhook.rejected": "A webhook call was rejected",
};

export type NotificationKind = "email" | "slack_webhook" | "webhook";

export interface NotificationChannel {
  id: string;
  kind: NotificationKind;
  name: string;
  config: JsonObject;
}

export interface NotificationMessage {
  event: NotificationEvent | "test";
  workspaceId: string;
  title: string;
  text: string;
  /** deep link into the web app */
  url?: string;
  details?: JsonObject;
  at: string;
}

/** SMTP_URL and SMTP_FROM (`Name <address>` or a bare address). */
export type SmtpSettings = Pick<SmtpConfig, "url" | "from"> & Partial<SmtpConfig>;

export interface DeliveryDeps {
  fetch: SafeFetch;
  /** the channel's secret: the Slack webhook URL, or the webhook signing secret */
  secret?: string | undefined;
  smtp?: SmtpSettings | undefined;
  now?: () => number;
}

export class NotificationDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationDeliveryError";
  }
}

/** Sends one message to one channel; throws `NotificationDeliveryError` with the reason. */
export async function deliverNotification(
  channel: NotificationChannel,
  message: NotificationMessage,
  deps: DeliveryDeps,
): Promise<void> {
  try {
    await sendAlert(
      { ...channel, credentialId: null },
      {
        event: message.event,
        title: message.title,
        text: message.text,
        severity: message.event === "test" ? "info" : "warning",
        ...(message.url ? { url: message.url } : {}),
        data: { workspaceId: message.workspaceId, ...(message.details ?? {}) },
      },
      deps.secret ?? null,
      {
        fetch: (url, init) => deps.fetch(url, { ...init, maxRedirects: 0 }),
        smtp: deps.smtp ?? null,
      },
      new Date(deps.now?.() ?? Date.parse(message.at)),
    );
  } catch (error) {
    throw new NotificationDeliveryError(error instanceof Error ? error.message : String(error));
  }
}
