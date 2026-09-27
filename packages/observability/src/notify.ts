/**
 * Notification delivery (ARCHITECTURE.md §9.3, API.md §3.10): one message to one workspace
 * channel. `slack_webhook` posts Slack's `text` payload to the channel's secret URL, `webhook`
 * posts the message as JSON signed with HMAC-SHA256 (`X-FlowAId-Signature: sha256=…` over
 * `<timestamp>.<body>`, `X-FlowAId-Timestamp`), and `email` sends through `SMTP_URL`. Outbound
 * HTTP goes through the caller's SSRF-guarded fetch; nothing here reads the environment.
 */
import { createHmac } from "node:crypto";
import nodemailer from "nodemailer";
import type { JsonObject, SafeFetch } from "@flowaid/workflow-core";

export const NOTIFICATION_EVENTS = [
  "human_task.created",
  "run.failed",
  "trace_review.page",
  "schedule.failed",
  "webhook.rejected",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

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

export interface SmtpSettings {
  url: string;
  from: string;
}

export interface MailTransport {
  sendMail(mail: { from: string; to: string[]; subject: string; text: string }): Promise<unknown>;
}

export interface DeliveryDeps {
  fetch: SafeFetch;
  /** the channel's secret: the Slack webhook URL, or the webhook signing secret */
  secret?: string | undefined;
  smtp?: SmtpSettings | undefined;
  /** tests inject a transport; production builds one from `smtp.url` */
  mailTransport?: (smtp: SmtpSettings) => MailTransport;
  now?: () => number;
  timeoutMs?: number;
}

export class NotificationDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationDeliveryError";
  }
}

export function signNotification(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
}

async function post(
  deps: DeliveryDeps,
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<void> {
  const res = await deps.fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "FlowAId-Notifications/1",
      ...headers,
    },
    body,
    signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
    maxRedirects: 0,
  });
  if (!res.ok) throw new NotificationDeliveryError(`the endpoint answered HTTP ${res.status}`);
  await res.body?.cancel().catch(() => undefined);
}

/** Plain-text body shared by email and logs. */
export function renderText(m: NotificationMessage): string {
  return [m.title, "", m.text, ...(m.url ? ["", m.url] : [])].join("\n");
}

export async function deliverNotification(
  channel: NotificationChannel,
  message: NotificationMessage,
  deps: DeliveryDeps,
): Promise<void> {
  switch (channel.kind) {
    case "slack_webhook": {
      if (!deps.secret) throw new NotificationDeliveryError("the Slack webhook URL is missing");
      const link = message.url ? `\n<${message.url}|Open in FlowAId>` : "";
      await post(
        deps,
        deps.secret,
        JSON.stringify({ text: `*${message.title}*\n${message.text}${link}` }),
        {},
      );
      return;
    }
    case "webhook": {
      const url = typeof channel.config.url === "string" ? channel.config.url : "";
      if (!url) throw new NotificationDeliveryError("the webhook URL is missing");
      const body = JSON.stringify({ ...message, channel: { id: channel.id, name: channel.name } });
      const ts = String(Math.floor((deps.now?.() ?? Date.now()) / 1000));
      await post(deps, url, body, {
        "x-flowaid-event": message.event,
        "x-flowaid-timestamp": ts,
        ...(deps.secret ? { "x-flowaid-signature": signNotification(deps.secret, ts, body) } : {}),
      });
      return;
    }
    case "email": {
      const to = asStrings(channel.config.to);
      if (to.length === 0) throw new NotificationDeliveryError("the channel has no recipients");
      if (!deps.smtp)
        throw new NotificationDeliveryError("email needs SMTP_URL and SMTP_FROM on the server");
      const transport = (deps.mailTransport ?? defaultTransport)(deps.smtp);
      try {
        await transport.sendMail({
          from: deps.smtp.from,
          to,
          subject: `[FlowAId] ${message.title}`,
          text: renderText(message),
        });
      } catch (error) {
        throw new NotificationDeliveryError(
          `the SMTP server refused the message: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return;
    }
  }
}

function defaultTransport(smtp: SmtpSettings): MailTransport {
  return nodemailer.createTransport(smtp.url);
}

export interface NotificationTarget extends NotificationChannel {
  credentialId: string | null;
}

export interface NotifierDeps {
  /** the enabled channels of a workspace subscribed to an event */
  targets: (workspaceId: string, event: NotificationEvent) => Promise<NotificationTarget[]>;
  /** a channel's secret, from its credential */
  secretFor: (credentialId: string) => Promise<string | undefined>;
  fetch: SafeFetch;
  smtp?: SmtpSettings | undefined;
  mailTransport?: (smtp: SmtpSettings) => MailTransport;
  onError?: (error: unknown, channel: NotificationTarget | null, event: NotificationEvent) => void;
}

export interface Notifier {
  /** Delivers to every subscribed channel; never throws (failures go to `onError`). */
  notify(message: NotificationMessage & { event: NotificationEvent }): Promise<void>;
}

export function createNotifier(deps: NotifierDeps): Notifier {
  return {
    async notify(message) {
      let targets: NotificationTarget[];
      try {
        targets = await deps.targets(message.workspaceId, message.event);
      } catch (error) {
        deps.onError?.(error, null, message.event);
        return;
      }
      await Promise.all(
        targets.map(async (t) => {
          try {
            const secret = t.credentialId ? await deps.secretFor(t.credentialId) : undefined;
            await deliverNotification(t, message, {
              fetch: deps.fetch,
              secret,
              smtp: deps.smtp,
              ...(deps.mailTransport ? { mailTransport: deps.mailTransport } : {}),
            });
          } catch (error) {
            deps.onError?.(error, t, message.event);
          }
        }),
      );
    },
  };
}
