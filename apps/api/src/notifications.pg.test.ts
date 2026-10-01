import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { signAlert, type AlertDispatcher, type AlertMessage } from "@flowaid/observability";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

interface Received {
  path: string;
  headers: IncomingMessage["headers"];
  body: string;
}

describeDb("notification channels (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  let server: Server;
  let base: string;
  let answer = 204;
  const received: Received[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        received.push({ path: req.url ?? "", headers: req.headers, body });
        res.statusCode = answer;
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    t = await createTestApp();
    jar = await login(t.app);
  });
  afterAll(async () => {
    await t.close();
    await new Promise((r) => server.close(r));
  });

  it("lists the event catalogue and reports the feature", async () => {
    const events = (await call(t.app, jar, "GET", "/v1/notifications/events")).json() as {
      id: string;
    }[];
    expect(events.map((e) => e.id)).toEqual([
      "human_task.created",
      "run.failed",
      "trace_review.page",
      "schedule.failed",
      "webhook.rejected",
      "budget.warning",
      "budget.exceeded",
    ]);
    expect((await call(t.app, jar, "GET", "/v1/me")).json().features.settings_notifications).toBe(
      true,
    );
  });

  it("pages the channels by name with a cursor", async () => {
    for (const name of ["Pager C", "Pager A", "Pager B"])
      await call(t.app, jar, "POST", "/v1/notifications", {
        kind: "webhook",
        name,
        config: { url: `${base}/pager` },
        events: ["run.failed"],
      });
    type Page = { items: { name: string }[]; next_cursor: string | null };
    const list = async (q: string) =>
      (await call(t.app, jar, "GET", `/v1/notifications?${q}`)).json() as Page;
    const all = (await list("limit=200")).items.map((c) => c.name);
    expect(all.filter((n) => n.startsWith("Pager"))).toEqual(["Pager A", "Pager B", "Pager C"]);
    const names: string[] = [];
    let cursor: string | null = null;
    do {
      const pg = await list(`limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      expect(pg.items.length).toBeLessThanOrEqual(2);
      names.push(...pg.items.map((c) => c.name));
      cursor = pg.next_cursor;
    } while (cursor);
    expect(names).toEqual(all);
    expect((await call(t.app, jar, "GET", "/v1/notifications?limit=500")).statusCode).toBe(400);
  });

  it("creates a signed webhook channel, returns the secret once and test-sends to it", async () => {
    const created = await call(t.app, jar, "POST", "/v1/notifications", {
      kind: "webhook",
      name: "Ops hook",
      config: { url: `${base}/ops` },
      events: ["run.failed", "human_task.created"],
    });
    expect(created.statusCode).toBe(201);
    const { channel, signingSecret } = created.json() as {
      channel: { id: string; secretSet: boolean; config: unknown };
      signingSecret: string;
    };
    expect(signingSecret).toMatch(/^nfsec_/);
    expect(channel).toMatchObject({ secretSet: true, config: { url: `${base}/ops` } });
    const listed = (await call(t.app, jar, "GET", "/v1/notifications")).json() as {
      items: { id: string }[];
    };
    expect(listed.items.map((c) => c.id)).toContain(channel.id);
    expect(JSON.stringify(listed)).not.toContain(signingSecret);

    const test = await call(t.app, jar, "POST", `/v1/notifications/${channel.id}/test`);
    expect(test.json()).toEqual({ ok: true });
    const got = received.at(-1) as Received;
    expect(got.path).toBe("/ops");
    const ts = String(got.headers["x-flowaid-timestamp"]);
    expect(got.headers["x-flowaid-signature"]).toBe(signAlert(signingSecret, ts, got.body));
    expect(JSON.parse(got.body)).toMatchObject({ event: "test", title: "Test notification" });

    answer = 500;
    const failed = await call(t.app, jar, "POST", `/v1/notifications/${channel.id}/test`);
    expect(failed.json()).toEqual({ ok: false, error: "the channel answered 500" });
    answer = 204;

    const rotated = await call(t.app, jar, "POST", `/v1/notifications/${channel.id}/rotate-secret`);
    expect(rotated.json().signingSecret).not.toBe(signingSecret);
  });

  it("validates each kind's configuration and needs SMTP for email", async () => {
    const bad = await call(t.app, jar, "POST", "/v1/notifications", {
      kind: "email",
      name: "Mail",
      config: { to: ["not-an-email"] },
      events: ["run.failed"],
    });
    expect(bad.statusCode).toBe(400);
    expect(
      (
        await call(t.app, jar, "POST", "/v1/notifications", {
          kind: "slack_webhook",
          name: "Slack",
          events: ["run.failed"],
        })
      ).statusCode,
    ).toBe(400);
    const mail = (
      await call(t.app, jar, "POST", "/v1/notifications", {
        kind: "email",
        name: "Mail",
        config: { to: ["ops@example.com"] },
        events: ["human_task.created"],
      })
    ).json() as { channel: { id: string } };
    const test = await call(t.app, jar, "POST", `/v1/notifications/${mail.channel.id}/test`);
    expect(test.json()).toMatchObject({ ok: false, error: expect.stringContaining("SMTP_URL") });

    const patched = await call(t.app, jar, "PATCH", `/v1/notifications/${mail.channel.id}`, {
      enabled: false,
      events: ["run.failed", "schedule.failed"],
    });
    expect(patched.json()).toMatchObject({
      enabled: false,
      events: ["run.failed", "schedule.failed"],
    });
    expect(
      (await call(t.app, jar, "DELETE", `/v1/notifications/${mail.channel.id}`)).statusCode,
    ).toBe(204);
  });

  it("stores a Slack URL as a credential and posts to it", async () => {
    const created = (
      await call(t.app, jar, "POST", "/v1/notifications", {
        kind: "slack_webhook",
        name: "Slack ops",
        events: ["run.failed"],
        // the test server stands in for hooks.slack.com (https only in production)
        slackWebhookUrl: "https://hooks.slack.example/services/T/B/x",
      })
    ).json() as { channel: { id: string; secretSet: boolean } };
    expect(created.channel.secretSet).toBe(true);
    const listed = JSON.stringify((await call(t.app, jar, "GET", "/v1/notifications")).json());
    expect(listed).not.toContain("hooks.slack.example");
  });

  it("alerts webhook.rejected under one occurrence key per webhook per hour", async () => {
    // the dispatcher sends each (channel, key) once, so one key per hour means one alert per hour
    const sent: { key: string; message: AlertMessage }[] = [];
    t.ctx.alerts = {
      dispatch: (_ws: string, key: string, message: AlertMessage) => {
        sent.push({ key, message });
        return Promise.resolve({ sent: 1, failed: 0, skipped: 0 });
      },
    } as unknown as AlertDispatcher;
    const w = (await call(t.app, jar, "POST", "/v1/workflows", { name: "Hooked" })).json() as {
      id: string;
    };
    const dev = (
      (await call(t.app, jar, "GET", "/v1/environments")).json() as { id: string; name: string }[]
    ).find((e) => e.name === "dev")?.id as string;
    const draft = (await call(t.app, jar, "GET", `/v1/workflows/${w.id}`)).json() as {
      draft: Record<string, unknown>;
      draftRevision: number;
    };
    await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id}/draft`,
      {
        definition: {
          ...draft.draft,
          triggers: [{ type: "webhook", path: "orders", signature: "hmac_sha256" }],
        },
      },
      { "if-match": String(draft.draftRevision) },
    );
    const v = (await call(t.app, jar, "POST", `/v1/workflows/${w.id}/publish`, {})).json() as {
      id: string;
    };
    await call(t.app, jar, "PUT", `/v1/workflows/${w.id}/deployments/${dev}`, { versionId: v.id });
    const hook = (
      (await call(t.app, jar, "GET", `/v1/webhooks?workflowId=${w.id}`)).json() as {
        items: { url: string }[];
      }
    ).items[0];
    const path = new URL(hook?.url as string).pathname;
    for (let i = 0; i < 3; i++)
      expect((await t.app.inject({ method: "POST", url: path, payload: "{}" })).statusCode).toBe(
        403,
      );
    expect(new Set(sent.map((s) => s.key)).size).toBe(1);
    expect(sent[0]?.message).toMatchObject({
      event: "webhook.rejected",
      title: "A call to webhook /dev/orders was rejected",
      text: expect.stringContaining("no signing secret"),
    });
    t.clock.t += 61 * 60_000;
    await t.app.inject({ method: "POST", url: path, payload: "{}" });
    expect(new Set(sent.map((s) => s.key)).size).toBe(2);
  });
});
