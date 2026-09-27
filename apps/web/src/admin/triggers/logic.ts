/** Pure helpers of the trigger and notification pages (unit-tested). */
import type { NotificationChannel, NotificationEvent, WebhookDelivery } from "../types";

export type Tone = "ok" | "warn" | "danger" | "neutral";

/** A delivery's badge: accepted/delivered read ok, duplicates are informational, the rest fail. */
export function deliveryTone(status: WebhookDelivery["status"]): Tone {
  switch (status) {
    case "accepted":
    case "delivered":
      return "ok";
    case "duplicate":
    case "pending":
      return "neutral";
    case "rejected":
    case "failed":
      return "danger";
  }
}

export const DELIVERY_LABEL: Readonly<Record<WebhookDelivery["status"], string>> = {
  accepted: "Accepted",
  delivered: "Delivered",
  duplicate: "Duplicate (ignored)",
  pending: "Pending retry",
  rejected: "Rejected",
  failed: "Failed",
};

/** Milliseconds as the jitter field shows them ("0 s", "30 s", "2 min"). */
export function formatJitter(ms: number): string {
  if (ms <= 0) return "none";
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

/** Jitter input (seconds) → ms within the API bounds, or null when invalid. */
export function parseJitterSeconds(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const ms = Number(t) * 1000;
  return ms <= 3_600_000 ? ms : null;
}

export const NOTIFICATION_EVENTS: readonly { id: NotificationEvent; label: string }[] = [
  { id: "human_task.created", label: "A run is waiting for a person" },
  { id: "run.failed", label: "A run failed" },
  { id: "schedule.failed", label: "A schedule could not start its run" },
  { id: "webhook.rejected", label: "A webhook call was rejected" },
  { id: "trace_review.page", label: "A trace review needs attention" },
];

export const KIND_LABEL: Readonly<Record<NotificationChannel["kind"], string>> = {
  email: "Email",
  slack_webhook: "Slack",
  webhook: "Webhook",
};

export interface ChannelDraft {
  kind: NotificationChannel["kind"];
  name: string;
  recipients: string;
  url: string;
  slackWebhookUrl: string;
  events: NotificationEvent[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseRecipients(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Field → problem for a new or edited channel (empty when it can be saved). */
export function channelProblems(d: ChannelDraft, editing: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  if (!d.name.trim()) out.name = "Give the channel a name.";
  if (d.events.length === 0) out.events = "Choose at least one event.";
  if (d.kind === "email") {
    const to = parseRecipients(d.recipients);
    if (to.length === 0) out.recipients = "Add at least one address.";
    else if (to.length > 20) out.recipients = "At most 20 addresses.";
    else {
      const bad = to.find((x) => !EMAIL_RE.test(x));
      if (bad) out.recipients = `${bad} is not an email address.`;
    }
  }
  if (d.kind === "webhook" && !/^https?:\/\/\S+$/.test(d.url.trim()))
    out.url = "Enter the http(s) URL to post to.";
  if (d.kind === "slack_webhook") {
    const u = d.slackWebhookUrl.trim();
    if (!u && !editing) out.slackWebhookUrl = "Paste the Slack incoming-webhook URL.";
    else if (u && !/^https:\/\/\S+$/.test(u))
      out.slackWebhookUrl = "The URL must start with https://";
  }
  return out;
}

/** The request body for a draft (create, or the changed fields of an edit). */
export function channelBody(d: ChannelDraft): Record<string, unknown> {
  const config =
    d.kind === "email"
      ? { to: parseRecipients(d.recipients) }
      : d.kind === "webhook"
        ? { url: d.url.trim() }
        : {};
  return {
    name: d.name.trim(),
    config,
    events: d.events,
    ...(d.kind === "slack_webhook" && d.slackWebhookUrl.trim()
      ? { slackWebhookUrl: d.slackWebhookUrl.trim() }
      : {}),
  };
}

export function draftOf(c?: NotificationChannel): ChannelDraft {
  return {
    kind: c?.kind ?? "email",
    name: c?.name ?? "",
    recipients: (c?.config.to ?? []).join(", "),
    url: c?.config.url ?? "",
    slackWebhookUrl: "",
    events: c?.events ?? ["human_task.created", "run.failed"],
  };
}

/** Tool names from an MCP `tools/list` JSON-RPC answer. */
export function toolNamesFrom(rpc: unknown): string[] {
  const tools = (rpc as { result?: { tools?: { name?: unknown }[] } } | null)?.result?.tools;
  return Array.isArray(tools)
    ? tools.map((t) => t.name).filter((n): n is string => typeof n === "string")
    : [];
}
