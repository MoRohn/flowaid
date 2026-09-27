/**
 * Observability alerts (ARCHITECTURE.md §10.5, UPGRADE_PLAN P6-04): the workspace's notification
 * channels (`notifications` rows: `email`, `slack_webhook`, `webhook`) receive alerts for the
 * events they subscribe to — `human_task.created`, `run.failed`, `trace_review.page`,
 * `schedule.failed`, `webhook.rejected`.
 *
 * `AlertDispatcher` is storage-agnostic: the app injects how channels are listed, how a delivery
 * is claimed (a unique `(channel, key)` so a retried job or a second worker never sends twice)
 * and recorded, and how a channel's secret is read. Senders post JSON (Slack, webhooks with an
 * HMAC-SHA256 signature) or speak SMTP (`smtp://` with STARTTLS when offered, `smtps://`).
 */
import { createHmac } from "node:crypto";
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import type { JsonObject } from "@flowaid/workflow-core";

export const ALERT_EVENTS = [
  "human_task.created",
  "run.failed",
  "trace_review.page",
  "schedule.failed",
  "webhook.rejected",
] as const;
export type AlertEvent = (typeof ALERT_EVENTS)[number];

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertMessage {
  event: AlertEvent | "test";
  title: string;
  text: string;
  severity: AlertSeverity;
  /** deep link into the web app */
  url?: string;
  /** structured facts for webhook receivers (ids, codes, verdicts) — never secrets */
  data?: JsonObject;
}

export interface AlertChannel {
  id: string;
  kind: "email" | "slack_webhook" | "webhook";
  name: string;
  config: JsonObject;
  credentialId: string | null;
}

export interface SmtpConfig {
  /** `smtp://user:pass@host:587` (STARTTLS when offered) or `smtps://user:pass@host:465` */
  url: string;
  from: string;
  /** accept self-signed certificates (tests, local relays) */
  insecureTls?: boolean;
  timeoutMs?: number;
}

export type AlertFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface AlertSendDeps {
  fetch: AlertFetch;
  smtp?: SmtpConfig | null;
}

/** The URL or signing secret a channel's credential holds. */
export function channelSecret(fields: Record<string, string> | null): string | null {
  if (!fields) return null;
  return (
    fields.url ?? fields.value ?? fields.token ?? fields.key ?? Object.values(fields)[0] ?? null
  );
}

function severityEmoji(s: AlertSeverity): string {
  return s === "critical"
    ? ":rotating_light:"
    : s === "warning"
      ? ":warning:"
      : ":information_source:";
}

export function slackPayload(m: AlertMessage): JsonObject {
  const line = `${severityEmoji(m.severity)} *${m.title}*`;
  return {
    text: `${m.title}: ${m.text}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `${line}\n${m.text}` } },
      ...(m.url
        ? [
            {
              type: "context",
              elements: [{ type: "mrkdwn", text: `<${m.url}|Open in FlowAId>` }],
            },
          ]
        : []),
    ],
  };
}

export function webhookPayload(m: AlertMessage, at: string): JsonObject {
  return {
    event: m.event,
    severity: m.severity,
    title: m.title,
    text: m.text,
    ...(m.url ? { url: m.url } : {}),
    data: m.data ?? {},
    at,
  };
}

/** `sha256=<hex>` over `<timestamp>.<body>` (the same shape the webhook ingress verifies). */
export function signAlert(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

async function postJson(
  fetch: AlertFetch,
  url: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "FlowAId-Alerts/1", ...headers },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`the channel answered ${res.status}`);
  await res.body?.cancel().catch(() => undefined);
}

function recipients(config: JsonObject): string[] {
  const to = config.to;
  const list = Array.isArray(to) ? to : typeof to === "string" ? to.split(",") : [];
  return list
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((x) => /^[^\s@<>]+@[^\s@<>]+$/.test(x));
}

/** Sends one alert to one channel; throws with the reason when the channel refuses. */
export async function sendAlert(
  channel: AlertChannel,
  message: AlertMessage,
  secret: string | null,
  deps: AlertSendDeps,
  now: Date = new Date(),
): Promise<void> {
  switch (channel.kind) {
    case "slack_webhook": {
      const url = secret ?? (typeof channel.config.url === "string" ? channel.config.url : null);
      if (!url) throw new Error("the Slack channel has no webhook URL");
      await postJson(deps.fetch, url, JSON.stringify(slackPayload(message)));
      return;
    }
    case "webhook": {
      const url = typeof channel.config.url === "string" ? channel.config.url : null;
      if (!url) throw new Error("the webhook channel has no URL");
      const at = now.toISOString();
      const body = JSON.stringify(webhookPayload(message, at));
      const timestamp = String(Math.floor(now.getTime() / 1000));
      await postJson(
        deps.fetch,
        url,
        body,
        secret
          ? {
              "x-flowaid-timestamp": timestamp,
              "x-flowaid-signature": signAlert(secret, timestamp, body),
            }
          : {},
      );
      return;
    }
    case "email": {
      if (!deps.smtp) throw new Error("email alerts need SMTP_URL and SMTP_FROM");
      const to = recipients(channel.config);
      if (to.length === 0) throw new Error("the email channel has no valid recipient");
      const subject = `[FlowAId] ${message.title}`;
      const text = `${message.text}${message.url ? `\n\n${message.url}` : ""}\n`;
      await sendMail(deps.smtp, { to, subject, text });
      return;
    }
  }
}

// ─── SMTP ───────────────────────────────────────────────────────────────────────────────────

interface Mail {
  to: string[];
  subject: string;
  text: string;
}

/** Minimal RFC 5321 client: EHLO, STARTTLS when offered (smtp://), AUTH PLAIN, one message. */
export async function sendMail(config: SmtpConfig, mail: Mail): Promise<void> {
  const url = new URL(config.url);
  const implicitTls = url.protocol === "smtps:";
  if (!implicitTls && url.protocol !== "smtp:")
    throw new Error("SMTP_URL must be smtp:// or smtps://");
  const host = url.hostname;
  const port = Number(url.port || (implicitTls ? 465 : 587));
  const user = decodeURIComponent(url.username);
  const pass = decodeURIComponent(url.password);
  const timeoutMs = config.timeoutMs ?? 20_000;
  const tlsOptions = { servername: host, rejectUnauthorized: !config.insecureTls };

  let socket: Socket | TLSSocket = implicitTls
    ? tlsConnect({ host, port, ...tlsOptions })
    : netConnect({ host, port });
  socket.setTimeout(timeoutMs);
  let buffer = "";
  let waiting: ((reply: { code: number; lines: string[] }) => void) | null = null;
  let failed: Error | null = null;
  const replies: { code: number; lines: string[] }[] = [];
  let pending: string[] = [];

  const attach = (s: Socket | TLSSocket) => {
    s.setEncoding("utf8");
    s.on("data", (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        pending.push(line);
        if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
          const reply = { code: Number(line.slice(0, 3)), lines: pending };
          pending = [];
          if (waiting) {
            const w = waiting;
            waiting = null;
            w(reply);
          } else replies.push(reply);
        }
      }
    });
    s.on("timeout", () => s.destroy(new Error("SMTP server timed out")));
    s.on("error", (e: Error) => {
      failed = e;
      if (waiting) {
        const w = waiting;
        waiting = null;
        w({ code: 0, lines: [e.message] });
      }
    });
  };
  attach(socket);

  const read = () =>
    new Promise<{ code: number; lines: string[] }>((resolve) => {
      const next = replies.shift();
      if (next) resolve(next);
      else if (failed) resolve({ code: 0, lines: [failed.message] });
      else waiting = resolve;
    });
  const expect = async (ok: number[], what: string) => {
    const reply = await read();
    if (!ok.includes(reply.code))
      throw new Error(`SMTP ${what} failed: ${reply.lines.join(" ").slice(0, 300)}`);
    return reply;
  };
  const send = (line: string) => socket.write(`${line}\r\n`);

  try {
    if (!implicitTls)
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", () => resolve());
        socket.once("error", reject);
      });
    await expect([220], "greeting");
    send(`EHLO flowaid`);
    let ehlo = await expect([250], "EHLO");
    if (!implicitTls && ehlo.lines.some((l) => /STARTTLS/i.test(l))) {
      send("STARTTLS");
      await expect([220], "STARTTLS");
      socket.removeAllListeners("data");
      socket = tlsConnect({ socket, ...tlsOptions });
      attach(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once("secureConnect", () => resolve());
        socket.once("error", reject);
      });
      send(`EHLO flowaid`);
      ehlo = await expect([250], "EHLO");
    }
    if (user) {
      const token = Buffer.from(`\0${user}\0${pass}`).toString("base64");
      send(`AUTH PLAIN ${token}`);
      await expect([235], "authentication");
    }
    send(`MAIL FROM:<${config.from}>`);
    await expect([250], "MAIL FROM");
    for (const to of mail.to) {
      send(`RCPT TO:<${to}>`);
      await expect([250, 251], `RCPT TO ${to}`);
    }
    send("DATA");
    await expect([354], "DATA");
    const headers = [
      `From: ${config.from}`,
      `To: ${mail.to.join(", ")}`,
      `Subject: ${mail.subject.replace(/[\r\n]+/g, " ")}`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
    ];
    // dot-stuffing (RFC 5321 §4.5.2)
    const body = mail.text.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
    socket.write(`${headers.join("\r\n")}\r\n\r\n${body}\r\n.\r\n`);
    await expect([250], "message");
    send("QUIT");
    await read().catch(() => undefined);
  } finally {
    socket.end();
    socket.destroy();
  }
}

// ─── dispatch ───────────────────────────────────────────────────────────────────────────────

export interface AlertStore {
  /** enabled channels of the workspace subscribed to `event` */
  channels(workspaceId: string, event: AlertMessage["event"]): Promise<AlertChannel[]>;
  /** claims `(channel, key)`; returns the delivery id, or null when it was already claimed */
  claim(input: {
    workspaceId: string;
    channelId: string;
    event: string;
    key: string;
  }): Promise<string | null>;
  finish(id: string, result: { status: "sent" | "failed"; error?: string }): Promise<void>;
  /** the decrypted fields of a channel's credential */
  secret(workspaceId: string, credentialId: string): Promise<Record<string, string> | null>;
}

export interface AlertDispatcherOptions extends AlertSendDeps {
  store: AlertStore;
  onError?: (error: unknown, context: { channelId?: string; event: string }) => void;
  now?: () => Date;
}

export interface DispatchResult {
  sent: number;
  failed: number;
  skipped: number;
}

export class AlertDispatcher {
  constructor(private readonly o: AlertDispatcherOptions) {}

  /**
   * Sends `message` to every subscribed channel once per `key` (the occurrence id). Channel
   * failures are recorded and reported, never thrown: an alert must not fail the job that raised it.
   */
  async dispatch(workspaceId: string, key: string, message: AlertMessage): Promise<DispatchResult> {
    const result: DispatchResult = { sent: 0, failed: 0, skipped: 0 };
    let channels: AlertChannel[];
    try {
      channels = await this.o.store.channels(workspaceId, message.event);
    } catch (error) {
      this.o.onError?.(error, { event: message.event });
      return result;
    }
    for (const channel of channels) {
      let id: string | null = null;
      try {
        id = await this.o.store.claim({
          workspaceId,
          channelId: channel.id,
          event: message.event,
          key,
        });
        if (!id) {
          result.skipped++;
          continue;
        }
        const fields = channel.credentialId
          ? await this.o.store.secret(workspaceId, channel.credentialId)
          : null;
        await sendAlert(
          channel,
          message,
          channelSecret(fields),
          this.o,
          this.o.now?.() ?? new Date(),
        );
        await this.o.store.finish(id, { status: "sent" });
        result.sent++;
      } catch (error) {
        result.failed++;
        this.o.onError?.(error, { channelId: channel.id, event: message.event });
        if (id)
          await this.o.store
            .finish(id, {
              status: "failed",
              error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
            })
            .catch(() => undefined);
      }
    }
    return result;
  }
}
