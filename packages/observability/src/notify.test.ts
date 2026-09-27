import { describe, expect, it, vi } from "vitest";
import type { SafeFetch } from "@flowaid/workflow-core";
import { signAlert } from "./alerts.js";
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_LABELS,
  deliverNotification,
  NotificationDeliveryError,
} from "./notify.js";

const message = {
  event: "test" as const,
  workspaceId: "ws1",
  title: "Test notification",
  text: "Channels are wired up.",
  url: "https://flowaid.example/default/settings",
  at: "2026-09-27T12:00:00.000Z",
};

function fetchOk() {
  return vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))) as unknown as SafeFetch &
    ReturnType<typeof vi.fn>;
}

describe("notification delivery (the alert sender)", () => {
  it("labels every alert event", () => {
    for (const e of NOTIFICATION_EVENTS) expect(NOTIFICATION_EVENT_LABELS[e]).toBeTruthy();
  });

  it("posts Slack's payload to the secret URL", async () => {
    const fetch = fetchOk();
    await deliverNotification(
      { id: "c1", kind: "slack_webhook", name: "ops", config: {} },
      message,
      { fetch, secret: "https://hooks.slack.test/x" },
    );
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.test/x");
    expect((JSON.parse(init.body as string) as { text: string }).text).toContain(
      "Test notification",
    );
  });

  it("signs webhook bodies over timestamp and body, exactly like real alerts", async () => {
    const fetch = fetchOk();
    await deliverNotification(
      { id: "c2", kind: "webhook", name: "hook", config: { url: "https://recv.test/in" } },
      message,
      { fetch, secret: "s3cret" },
    );
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    const h = init.headers as Record<string, string>;
    expect(h["x-flowaid-signature"]).toBe(
      signAlert("s3cret", h["x-flowaid-timestamp"] as string, init.body as string),
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      event: "test",
      data: { workspaceId: "ws1" },
    });
  });

  it("reports refusals and a missing SMTP server as delivery errors", async () => {
    const refused = vi.fn(() =>
      Promise.resolve(new Response("no", { status: 500 })),
    ) as unknown as SafeFetch;
    await expect(
      deliverNotification(
        { id: "c3", kind: "webhook", name: "hook", config: { url: "https://recv.test/in" } },
        message,
        { fetch: refused },
      ),
    ).rejects.toBeInstanceOf(NotificationDeliveryError);
    await expect(
      deliverNotification(
        { id: "c4", kind: "email", name: "mail", config: { to: ["ops@example.com"] } },
        message,
        { fetch: fetchOk() },
      ),
    ).rejects.toThrow(/SMTP_URL and SMTP_FROM/);
  });
});
