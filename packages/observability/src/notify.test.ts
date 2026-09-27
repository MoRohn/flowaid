import { describe, expect, it, vi } from "vitest";
import {
  createNotifier,
  deliverNotification,
  signNotification,
  type NotificationMessage,
  type NotificationTarget,
} from "./notify.js";

const message: NotificationMessage = {
  event: "run.failed",
  workspaceId: "ws",
  title: "Run failed: Refund triage",
  text: "NODE_EXECUTION_ERROR: the model refused",
  url: "https://app.example.com/default/runs/r1",
  at: "2026-09-27T12:00:00.000Z",
};

function fakeFetch(status = 200) {
  return vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(new Response("ok", { status })),
  );
}

describe("deliverNotification", () => {
  it("posts Slack's text payload to the secret URL", async () => {
    const fetch = fakeFetch();
    await deliverNotification(
      { id: "c", kind: "slack_webhook", name: "ops", config: {} },
      message,
      {
        fetch,
        secret: "https://hooks.slack.com/services/T/B/x",
      },
    );
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.com/services/T/B/x");
    expect((JSON.parse(init.body as string) as { text: string }).text).toContain(
      "<https://app.example.com/default/runs/r1|Open in FlowAId>",
    );
  });

  it("signs webhook bodies over timestamp and body", async () => {
    const fetch = fakeFetch();
    await deliverNotification(
      { id: "c", kind: "webhook", name: "hook", config: { url: "https://example.com/in" } },
      message,
      { fetch, secret: "s3cret", now: () => 1_790_000_000_000 },
    );
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["x-flowaid-timestamp"]).toBe("1790000000");
    expect(headers["x-flowaid-signature"]).toBe(
      signNotification("s3cret", "1790000000", init.body as string),
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      event: "run.failed",
      channel: { id: "c" },
    });
  });

  it("reports non-2xx answers", async () => {
    await expect(
      deliverNotification(
        { id: "c", kind: "webhook", name: "h", config: { url: "https://e.x/" } },
        message,
        { fetch: fakeFetch(500) },
      ),
    ).rejects.toThrow("HTTP 500");
  });

  it("sends email through the SMTP transport, and explains a missing server", async () => {
    const sendMail = vi.fn(() => Promise.resolve({}));
    const channel = {
      id: "c",
      kind: "email" as const,
      name: "mail",
      config: { to: ["ops@example.com"] },
    };
    await deliverNotification(channel, message, {
      fetch: fakeFetch(),
      smtp: { url: "smtp://localhost:2525", from: "FlowAId <n@example.com>" },
      mailTransport: () => ({ sendMail }),
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["ops@example.com"],
        subject: "[FlowAId] Run failed: Refund triage",
      }),
    );
    await expect(deliverNotification(channel, message, { fetch: fakeFetch() })).rejects.toThrow(
      "SMTP_URL",
    );
  });
});

describe("createNotifier", () => {
  it("delivers to every subscribed channel and reports failures without throwing", async () => {
    const fetch = vi.fn((url: string) =>
      Promise.resolve(new Response("", { status: url.includes("bad") ? 500 : 200 })),
    );
    const onError = vi.fn();
    const notifier = createNotifier({
      targets: () =>
        Promise.resolve<NotificationTarget[]>([
          {
            id: "a",
            kind: "webhook",
            name: "good",
            config: { url: "https://good.example/" },
            credentialId: null,
          },
          {
            id: "b",
            kind: "webhook",
            name: "bad",
            config: { url: "https://bad.example/" },
            credentialId: null,
          },
          { id: "c", kind: "slack_webhook", name: "slack", config: {}, credentialId: "cred" },
        ]),
      secretFor: () => Promise.resolve("https://hooks.slack.com/services/x"),
      fetch,
      onError,
    });
    await notifier.notify({ ...message, event: "run.failed" });
    expect(fetch.mock.calls.map((c) => c[0]).sort()).toEqual([
      "https://bad.example/",
      "https://good.example/",
      "https://hooks.slack.com/services/x",
    ]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0] as [Error])[0].message).toContain("HTTP 500");
  });
});
