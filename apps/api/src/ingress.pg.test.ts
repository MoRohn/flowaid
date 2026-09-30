import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { signWebhook } from "./routes/ingress.js";
import { FakeWorker } from "./test/fakeWorker.js";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

describeDb("webhooks, schedules, events and audit (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  let worker: FakeWorker;
  let envs: Record<string, string>;
  beforeAll(async () => {
    t = await createTestApp();
    jar = await login(t.app);
    envs = Object.fromEntries(
      (
        (await call(t.app, jar, "GET", "/v1/environments")).json() as { id: string; name: string }[]
      ).map((e) => [e.name, e.id]),
    );
    worker = new FakeWorker(t.db.app, () => "complete");
    await worker.start();
  });
  afterAll(async () => {
    await worker.stop();
    await t.close();
  });

  const deployWith = async (name: string, triggers: unknown[], env = "dev") => {
    const w = (await call(t.app, jar, "POST", "/v1/workflows", { name })).json();
    await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id as string}/draft`,
      { definition: { ...w.draft, triggers } },
      { "if-match": String(w.draftRevision) },
    );
    const v = (
      await call(t.app, jar, "POST", `/v1/workflows/${w.id as string}/publish`, {})
    ).json();
    const dep = await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id as string}/deployments/${envs[env] as string}`,
      { versionId: v.id },
    );
    expect(dep.statusCode).toBe(200);
    return { id: w.id as string, triggers: dep.json().triggers };
  };
  const hook = (path: string, body: string, headers: Record<string, string> = {}) =>
    t.app.inject({
      method: "POST",
      url: `/hooks/default/${path}`,
      payload: body,
      headers: { "content-type": "application/json", ...headers },
    });

  it("verifies HMAC signatures with timestamps, refuses replays and unbound secrets", async () => {
    const wf = await deployWith("Orders", [{ type: "webhook", path: "orders" }]);
    const hookId = wf.triggers.webhooks[0].id as string;
    const body = JSON.stringify({ message: "order 1" });
    expect((await hook("dev/orders", body)).statusCode).toBe(403);
    const { secret } = (
      await call(t.app, jar, "POST", `/v1/webhooks/${hookId}/rotate-secret`)
    ).json();
    const ts = String(Math.floor(t.clock.now() / 1000));
    const sig = signWebhook(secret as string, Buffer.from(body), ts);
    const ok = await hook("dev/orders", body, { "x-signature": sig, "x-timestamp": ts });
    expect(ok.statusCode).toBe(202);
    const runId = ok.json().run_id as string;
    const run = (await call(t.app, jar, "GET", `/v1/runs/${runId}`)).json();
    expect(run).toMatchObject({
      origin: "webhook",
      input: { message: "order 1" },
      labels: { webhookId: hookId },
    });
    expect(
      (await hook("dev/orders", body, { "x-signature": sig, "x-timestamp": ts })).statusCode,
    ).toBe(401);
    expect(
      (
        await hook("dev/orders", body, {
          "x-signature": signWebhook(secret as string, Buffer.from(body)),
        })
      ).statusCode,
    ).toBe(401);
    const stale = String(Math.floor(t.clock.now() / 1000) - 3600);
    expect(
      (
        await hook("dev/orders", body, {
          "x-signature": signWebhook(secret as string, Buffer.from(body), stale),
          "x-timestamp": stale,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await hook("dev/orders", body, { "x-signature": "sha256=deadbeef", "x-timestamp": ts }))
        .statusCode,
    ).toBe(401);
    expect((await hook("dev/nope", body)).statusCode).toBe(404);
    const deliveries = (await call(t.app, jar, "GET", `/v1/webhooks/${hookId}/deliveries`)).json();
    expect(
      deliveries.items.filter((d: { status: string }) => d.status === "rejected").length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("deduplicates deliveries by header and answers with the original run", async () => {
    const wf = await deployWith("Dedupe", [{ type: "webhook", path: "dedupe", signature: "none" }]);
    const hookId = wf.triggers.webhooks[0].id as string;
    await call(t.app, jar, "PATCH", `/v1/webhooks/${hookId}`, {
      idempotencyHeader: "X-Delivery-Id",
    });
    const first = await hook("dev/dedupe", JSON.stringify({ message: "a" }), {
      "x-delivery-id": "d-1",
    });
    expect(first.statusCode).toBe(202);
    const again = await hook("dev/dedupe", JSON.stringify({ message: "b" }), {
      "x-delivery-id": "d-1",
    });
    expect(again.json()).toEqual({ run_id: first.json().run_id, duplicate: true });
    const other = await hook("dev/dedupe", JSON.stringify({ message: "b" }), {
      "x-delivery-id": "d-2",
    });
    expect(other.json().run_id).not.toBe(first.json().run_id);
    expect(
      (await call(t.app, jar, "PATCH", `/v1/webhooks/${hookId}`, { path: "other" })).statusCode,
    ).toBe(409);
  });

  it("allows unsigned hooks only outside protected environments; token mode works", async () => {
    const prodWf = await deployWith(
      "Prod hook",
      [{ type: "webhook", path: "prodhook", signature: "none" }],
      "prod",
    );
    expect(prodWf.triggers.webhooks).toHaveLength(1);
    expect((await hook("prod/prodhook", JSON.stringify({ message: "x" }))).statusCode).toBe(403);
    const tok = await deployWith("Token hook", [
      { type: "webhook", path: "tokenhook", signature: "token" },
    ]);
    const { secret } = (
      await call(
        t.app,
        jar,
        "POST",
        `/v1/webhooks/${tok.triggers.webhooks[0].id as string}/rotate-secret`,
      )
    ).json();
    expect(
      (
        await hook("dev/tokenhook", JSON.stringify({ message: "x" }), {
          "x-webhook-token": "wrong-token-value-xyz",
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await hook("dev/tokenhook", JSON.stringify({ message: "x" }), {
          "x-webhook-token": secret as string,
        })
      ).statusCode,
    ).toBe(202);
  });

  it("pages webhooks by path and schedules by next run (none last) with a cursor", async () => {
    const wf = await deployWith("Pager", [
      { type: "webhook", path: "pager-c" },
      { type: "webhook", path: "pager-a" },
      { type: "webhook", path: "pager-b" },
      { type: "schedule", cron: "0 6 * * *" },
      { type: "schedule", cron: "0 3 * * *" },
      { type: "schedule", cron: "0 9 * * *" },
    ]);
    type Page = { items: { id: string; path?: string }[]; next_cursor: string | null };
    const list = async (url: string) => (await call(t.app, jar, "GET", url)).json() as Page;

    const first = await list(`/v1/webhooks?workflowId=${wf.id}&limit=2`);
    expect(first.items.map((w) => w.path)).toEqual(["dev/pager-a", "dev/pager-b"]);
    expect(first.next_cursor).toEqual(expect.any(String));
    const rest = await list(
      `/v1/webhooks?workflowId=${wf.id}&limit=2&cursor=${first.next_cursor ?? ""}`,
    );
    expect(rest.items.map((w) => w.path)).toEqual(["dev/pager-c"]);
    expect(rest.next_cursor).toBeNull();

    const all = (await list(`/v1/schedules?workflowId=${wf.id}`)).items;
    expect(all).toHaveLength(3);
    const off = all[0]?.id as string;
    await t.db.admin`update schedules set next_run_at = null where id = ${off}`;
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const pg = await list(
        `/v1/schedules?workflowId=${wf.id}&limit=1${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(pg.items).toHaveLength(1);
      ids.push(...pg.items.map((x) => x.id));
      cursor = pg.next_cursor;
    } while (cursor);
    expect(ids).toEqual([...all.slice(1).map((x) => x.id), off]);
  });

  it("edits schedules, refuses cron changes and fires them by hand", async () => {
    const wf = await deployWith("Cronjob", [
      { type: "schedule", cron: "0 6 * * *", input: { message: "morning" } },
    ]);
    const s = (await call(t.app, jar, "GET", `/v1/schedules?workflowId=${wf.id}`)).json().items[0];
    expect(s).toMatchObject({ cron: "0 6 * * *", enabled: true, nextRunAt: expect.any(String) });
    expect(
      (await call(t.app, jar, "PATCH", `/v1/schedules/${s.id as string}`, { cron: "* * * * *" }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await call(t.app, jar, "PATCH", `/v1/schedules/${s.id as string}`, {
          catchUp: "all",
          jitterMs: 1000,
        })
      ).json(),
    ).toMatchObject({ catchUp: "all", jitterMs: 1000 });
    const fired = await call(t.app, jar, "POST", `/v1/schedules/${s.id as string}/trigger`);
    expect(fired.statusCode).toBe(202);
    expect(
      (await call(t.app, jar, "GET", `/v1/runs/${fired.json().run_id as string}`)).json(),
    ).toMatchObject({ origin: "schedule", input: { message: "morning" } });
  });

  it("publishes events: starts triggered workflows and signals waiting runs", async () => {
    const wf = await deployWith("On order", [{ type: "event", eventName: "order.created" }]);
    const ws = (await call(t.app, jar, "GET", "/v1/me")).json().principal.workspaceId as string;
    const waiting = (
      await call(t.app, jar, "POST", `/v1/workflows/${wf.id}/run`, { input: { message: "x" } })
    ).json().run_id as string;
    await t.db
      .admin`insert into event_subscriptions (workspace_id, event_name, correlation_key, run_id, node_run_id) values (${ws}, 'order.created', null, ${waiting}, gen_random_uuid())`;
    const res = await call(t.app, jar, "POST", "/v1/events/order.created", {
      payload: { message: "ord-1" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().started).toHaveLength(1);
    expect(res.json().delivered).toEqual([waiting]);
    for (
      let i = 0;
      i < 100 && !worker.jobs.some((j) => j.type === "run.signal" && j.runId === waiting);
      i++
    )
      await new Promise((r) => setTimeout(r, 50));
    expect(worker.jobs.find((j) => j.type === "run.signal" && j.runId === waiting)).toMatchObject({
      signal: { type: "event", eventName: "order.created", payload: { message: "ord-1" } },
    });
  });

  it("delivers correlated events only to the runs waiting with that key (RFC-0006)", async () => {
    const wf = await deployWith("On payment", [
      { type: "event", eventName: "order.paid", correlationKey: "/order" },
    ]);
    const ws = (await call(t.app, jar, "GET", "/v1/me")).json().principal.workspaceId as string;
    const runFor = async () =>
      (
        await call(t.app, jar, "POST", `/v1/workflows/${wf.id}/run`, { input: { message: "x" } })
      ).json().run_id as string;
    const [a, b, any] = [await runFor(), await runFor(), await runFor()];
    await t.db
      .admin`insert into event_subscriptions (workspace_id, event_name, correlation_key, run_id, node_run_id) values
        (${ws}, 'order.paid', 'A-1', ${a}, gen_random_uuid()),
        (${ws}, 'order.paid', 'B-2', ${b}, gen_random_uuid()),
        (${ws}, 'order.paid', null, ${any}, gen_random_uuid())`;

    const keyed = await call(t.app, jar, "POST", "/v1/events/order.paid", {
      payload: { order: "A-1", message: "paid" },
      correlationKey: "A-1",
    });
    expect(keyed.statusCode).toBe(202);
    expect([...keyed.json().delivered].sort()).toEqual([a, any].sort());
    // the trigger's correlationKey pointer names the started run's session
    const started = keyed.json().started[0] as string;
    expect((await call(t.app, jar, "GET", `/v1/runs/${started}`)).json().sessionId).toBe("A-1");
    for (
      let i = 0;
      i < 100 && !worker.jobs.some((j) => j.type === "run.signal" && j.runId === a);
      i++
    )
      await new Promise((r) => setTimeout(r, 50));
    expect(worker.jobs.find((j) => j.type === "run.signal" && j.runId === a)).toMatchObject({
      signal: { type: "event", eventName: "order.paid", correlationKey: "A-1" },
    });

    const unkeyed = await call(t.app, jar, "POST", "/v1/events/order.paid", {
      payload: { message: "no key" },
    });
    expect(unkeyed.json().delivered).toEqual([any]);
  });

  it("lists audit events with filters and pagination", async () => {
    const page = (
      await call(t.app, jar, "GET", "/v1/audit?action=workflow.publish&limit=2")
    ).json();
    expect(page.items).toHaveLength(2);
    expect(page.items.every((a: { action: string }) => a.action === "workflow.publish")).toBe(true);
    expect(page.next_cursor).not.toBeNull();
    const next = (
      await call(
        t.app,
        jar,
        "GET",
        `/v1/audit?action=workflow.publish&limit=2&cursor=${page.next_cursor as string}`,
      )
    ).json();
    expect(next.items[0].id).not.toBe(page.items[1].id);
  });
});
