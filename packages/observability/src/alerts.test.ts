import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AlertDispatcher,
  PRIVATE_NETWORK_FIX,
  budgetAlert,
  channelSecret,
  withPrivateNetworkFix,
  sendAlert,
  sendMail,
  signAlert,
  type AlertChannel,
  type AlertMessage,
  type AlertStore,
} from "./alerts.js";
import { startMetricsListener } from "./listener.js";

const MESSAGE: AlertMessage = {
  event: "run.failed",
  title: "Run failed: Refund triage",
  text: "NODE_EXECUTION_ERROR: the model refused",
  severity: "warning",
  url: "https://flowaid.example/default/runs/r1",
  data: { runId: "r1" },
};

function channel(
  kind: AlertChannel["kind"],
  config: Record<string, string | string[]>,
): AlertChannel {
  return { id: `ch-${kind}`, kind, name: kind, config, credentialId: null };
}

/** A fake SMTP server recording the conversation (no TLS, AUTH PLAIN accepted). */
async function fakeSmtp(): Promise<{
  port: number;
  lines: string[];
  messages: string[];
  server: Server;
}> {
  const lines: string[] = [];
  const messages: string[] = [];
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("220 fake ESMTP\r\n");
    let data = false;
    let body = "";
    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (data) {
          if (line === ".") {
            data = false;
            messages.push(body);
            body = "";
            socket.write("250 queued\r\n");
          } else body += `${line}\n`;
          continue;
        }
        lines.push(line);
        if (line.startsWith("EHLO")) socket.write("250-fake\r\n250 AUTH PLAIN\r\n");
        else if (line.startsWith("AUTH PLAIN")) socket.write("235 ok\r\n");
        else if (line.startsWith("MAIL FROM") || line.startsWith("RCPT TO"))
          socket.write("250 ok\r\n");
        else if (line === "DATA") {
          data = true;
          socket.write("354 go\r\n");
        } else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("502 no\r\n");
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const address = server.address();
  return {
    port: typeof address === "object" && address ? address.port : 0,
    lines,
    messages,
    server,
  };
}

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

describe("alert channels", () => {
  it("posts a Slack message with the title, text and a link", async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response("ok")));
    await sendAlert(channel("slack_webhook", {}), MESSAGE, "https://hooks.slack.test/T/B/x", {
      fetch,
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.test/T/B/x");
    const body = JSON.parse(init.body as string) as { text: string; blocks: unknown[] };
    expect(body.text).toContain("Run failed: Refund triage");
    expect(JSON.stringify(body.blocks)).toContain("Open in FlowAId");
  });

  it("signs webhook payloads with the channel secret", async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response("ok")));
    const now = new Date("2026-09-27T12:00:00Z");
    await sendAlert(
      channel("webhook", { url: "https://hooks.example/alerts" }),
      MESSAGE,
      "s3cret",
      { fetch },
      now,
    );
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const body = init.body as string;
    expect(JSON.parse(body)).toMatchObject({ event: "run.failed", data: { runId: "r1" } });
    expect(headers["x-flowaid-signature"]).toBe(
      signAlert("s3cret", headers["x-flowaid-timestamp"] ?? "", body),
    );
  });

  it("fails loudly when the receiver refuses", async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response("nope", { status: 500 })));
    await expect(
      sendAlert(channel("webhook", { url: "https://hooks.example/a" }), MESSAGE, null, { fetch }),
    ).rejects.toThrow(/500/);
  });

  it("emails through SMTP with AUTH PLAIN and dot-stuffing", async () => {
    const smtp = await fakeSmtp();
    servers.push(smtp.server);
    await sendAlert(
      channel("email", { to: ["oncall@example.com", "not-an-address"] }),
      { ...MESSAGE, text: "line one\n.starts with a dot" },
      null,
      {
        fetch: vi.fn(),
        smtp: { url: `smtp://alerts:pw@127.0.0.1:${smtp.port}`, from: "flowaid@example.com" },
      },
    );
    expect(smtp.lines).toContain("MAIL FROM:<flowaid@example.com>");
    expect(smtp.lines).toContain("RCPT TO:<oncall@example.com>");
    expect(smtp.lines.some((l) => l.startsWith("RCPT TO:<not-an-address"))).toBe(false);
    expect(smtp.lines.find((l) => l.startsWith("AUTH PLAIN"))).toBe(
      `AUTH PLAIN ${Buffer.from("\0alerts\0pw").toString("base64")}`,
    );
    expect(smtp.messages[0]).toContain("Subject: [FlowAId] Run failed: Refund triage");
    expect(smtp.messages[0]).toContain("\n..starts with a dot");
  });

  it("rejects email without SMTP configuration", async () => {
    await expect(
      sendAlert(channel("email", { to: "a@b.co" }), MESSAGE, null, { fetch: vi.fn() }),
    ).rejects.toThrow(/SMTP_URL/);
    await expect(
      sendMail({ url: "http://x", from: "a@b.co" }, { to: ["a@b.co"], subject: "s", text: "t" }),
    ).rejects.toThrow(/smtp:\/\//);
  });

  it("reads the URL or secret from a credential's fields", () => {
    expect(channelSecret({ url: "https://hooks.slack.test/x" })).toBe("https://hooks.slack.test/x");
    expect(channelSecret({ value: "v" })).toBe("v");
    expect(channelSecret(null)).toBeNull();
  });
});

describe("AlertDispatcher", () => {
  function store(channels: AlertChannel[]): AlertStore & { finished: [string, string][] } {
    const claimed = new Set<string>();
    const finished: [string, string][] = [];
    return {
      finished,
      channels: () => Promise.resolve(channels),
      claim: ({ channelId, key }) => {
        const k = `${channelId}|${key}`;
        if (claimed.has(k)) return Promise.resolve(null);
        claimed.add(k);
        return Promise.resolve(k);
      },
      finish: (id, r) => {
        finished.push([id, r.status]);
        return Promise.resolve();
      },
      secret: () => Promise.resolve({ url: "https://hooks.slack.test/x" }),
    };
  }

  it("sends once per occurrence and records failures without throwing", async () => {
    const fetch = vi.fn((url: string) =>
      Promise.resolve(new Response("", { status: url.includes("broken") ? 502 : 200 })),
    );
    const s = store([
      { ...channel("slack_webhook", {}), credentialId: "cred" },
      channel("webhook", { url: "https://broken.example/x" }),
    ]);
    const errors: unknown[] = [];
    const d = new AlertDispatcher({ store: s, fetch, onError: (e) => errors.push(e) });
    expect(await d.dispatch("ws", "run.failed:r1", MESSAGE)).toEqual({
      sent: 1,
      failed: 1,
      skipped: 0,
    });
    expect(await d.dispatch("ws", "run.failed:r1", MESSAGE)).toEqual({
      sent: 0,
      failed: 0,
      skipped: 2,
    });
    expect(s.finished.map(([, st]) => st).sort()).toEqual(["failed", "sent"]);
    expect(errors).toHaveLength(1);
  });

  it("records a refused private address with how to allow it", async () => {
    const errors: string[] = [];
    const s = store([channel("webhook", { url: "http://127.0.0.1:9/hook" })]);
    s.finish = (_id, r) => {
      if (r.error) errors.push(r.error);
      return Promise.resolve();
    };
    const fetch = vi.fn(() =>
      Promise.reject(new Error("refused to connect to 127.0.0.1: private or reserved address")),
    );
    await new AlertDispatcher({ store: s, fetch }).dispatch("ws", "run.failed:r2", MESSAGE);
    expect(errors).toEqual([
      `refused to connect to 127.0.0.1: private or reserved address. ${PRIVATE_NETWORK_FIX}`,
    ]);
  });
});

describe("private-address refusals", () => {
  it("name FLOWAID_ALLOW_PRIVATE_NETWORK once, without the raw code", () => {
    const fixed = withPrivateNetworkFix(
      "E_TOOL_SERVER_PRIVATE: server http://localhost:3101/ resolves to a private address",
    );
    expect(fixed).toBe(
      `server http://localhost:3101/ resolves to a private address. ${PRIVATE_NETWORK_FIX}`,
    );
    expect(withPrivateNetworkFix(fixed)).toBe(fixed);
    expect(withPrivateNetworkFix("the endpoint answered HTTP 500")).toBe(
      "the endpoint answered HTTP 500",
    );
  });
});

describe("Prometheus listener", () => {
  it("serves /metrics and 404s elsewhere", async () => {
    const listener = await startMetricsListener({
      port: 0,
      host: "127.0.0.1",
      handler: (_req, res) => res.end("flowaid_runs_total 1\n"),
    });
    try {
      const ok = await fetch(`http://127.0.0.1:${listener.port}/metrics`);
      expect(await ok.text()).toContain("flowaid_runs_total");
      expect((await fetch(`http://127.0.0.1:${listener.port}/`)).status).toBe(404);
    } finally {
      await listener.close();
    }
  });
});

describe("envelopeAddress", () => {
  it("takes the address of a display-name sender", async () => {
    const { envelopeAddress } = await import("./alerts.js");
    expect(envelopeAddress("FlowAId <notifications@example.com>")).toBe(
      "notifications@example.com",
    );
    expect(envelopeAddress("alerts@example.com")).toBe("alerts@example.com");
  });
});

describe("budgetAlert", () => {
  const at = (spentUsd: number, monthlyCostUsd: number | null = 100) => ({
    month: "2030-03",
    spentUsd,
    monthlyCostUsd,
  });
  it("is quiet below 80 % and without a budget", () => {
    expect(budgetAlert("ws", at(79.99))).toBeNull();
    expect(budgetAlert("ws", at(500, null))).toBeNull();
  });
  it("warns from 80 % and reports the budget used up from 100 %, keyed once per month", () => {
    expect(budgetAlert("ws", at(80), "https://x/settings")).toMatchObject({
      key: "budget.warning:ws:2030-03",
      message: {
        event: "budget.warning",
        severity: "warning",
        title: "80% of the monthly budget spent (2030-03)",
        url: "https://x/settings",
        data: { month: "2030-03", spentUsd: 80, monthlyCostUsd: 100 },
      },
    });
    expect(budgetAlert("ws", at(100))).toMatchObject({
      key: "budget.exceeded:ws:2030-03",
      message: { event: "budget.exceeded", severity: "critical" },
    });
    expect(budgetAlert("ws", { ...at(100), month: "2030-04" })?.key).toBe(
      "budget.exceeded:ws:2030-04",
    );
  });
});
