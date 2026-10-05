/**
 * Data-safety fixes from the 2026-10 product roadmap (docs/project/PRODUCT_ROADMAP_2026-10.md,
 * track A): boolean query flags, archiving, webhook retries, redeploys, credential rotation and
 * environment changes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { FakeWorker } from "./test/fakeWorker.js";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

describeDb("data safety (Postgres)", () => {
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

  const create = async (name: string, triggers: unknown[] = []) => {
    const w = (await call(t.app, jar, "POST", "/v1/workflows", { name })).json();
    const saved = await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id as string}/draft`,
      { definition: { ...w.draft, triggers } },
      { "if-match": String(w.draftRevision) },
    );
    expect(saved.statusCode).toBe(200);
    return { id: w.id as string, draft: w.draft, revision: saved.json().draftRevision as number };
  };
  const publish = async (id: string) => {
    const v = await call(t.app, jar, "POST", `/v1/workflows/${id}/publish`, {});
    expect(v.statusCode).toBe(201);
    return v.json().id as string;
  };
  const deploy = async (id: string, versionId: string, env = "dev") => {
    const dep = await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${id}/deployments/${envs[env] as string}`,
      { versionId },
    );
    return dep;
  };
  const hook = (path: string, body: string, headers: Record<string, string> = {}) =>
    t.app.inject({
      method: "POST",
      url: `/hooks/default/${path}`,
      payload: body,
      headers: { "content-type": "application/json", ...headers },
    });

  describe("boolean query flags", () => {
    it("archives on ?purge=false and only purges on ?purge=true", async () => {
      const w = await create("Purge flag");
      expect(
        (await call(t.app, jar, "DELETE", `/v1/workflows/${w.id}?purge=false`)).statusCode,
      ).toBe(204);
      const archived = (
        await call(t.app, jar, "GET", "/v1/workflows?archived=true&limit=200")
      ).json();
      expect(archived.items.map((x: { id: string }) => x.id)).toContain(w.id);
      const live = (await call(t.app, jar, "GET", "/v1/workflows?archived=false&limit=200")).json();
      expect(live.items.map((x: { id: string }) => x.id)).not.toContain(w.id);
      expect(
        (await call(t.app, jar, "DELETE", `/v1/workflows/${w.id}?purge=true`)).statusCode,
      ).toBe(204);
      expect((await call(t.app, jar, "GET", `/v1/workflows/${w.id}`)).statusCode).toBe(404);
    });
  });

  describe("archiving", () => {
    it("switches off the workflow's triggers and refuses new runs and deploys", async () => {
      const w = await create("Archived hooks", [
        { type: "webhook", path: "archived-hook", signature: "none" },
        { type: "schedule", cron: "0 3 * * *", input: { message: "nightly" } },
      ]);
      const v = await publish(w.id);
      const dep = await deploy(w.id, v);
      expect(dep.statusCode).toBe(200);
      expect((await hook("dev/archived-hook", JSON.stringify({ message: "x" }))).statusCode).toBe(
        202,
      );
      expect((await call(t.app, jar, "DELETE", `/v1/workflows/${w.id}`)).statusCode).toBe(204);

      expect((await hook("dev/archived-hook", JSON.stringify({ message: "y" }))).statusCode).toBe(
        404,
      );
      const schedules = (await call(t.app, jar, "GET", "/v1/schedules?limit=200")).json();
      const mine = schedules.items.filter((s: { workflowId: string }) => s.workflowId === w.id);
      expect(mine.length).toBe(1);
      expect(mine[0].enabled).toBe(false);
      const run = await call(t.app, jar, "POST", `/v1/workflows/${w.id}/run`, {
        input: { message: "z" },
        environmentId: envs.dev,
      });
      expect(run.statusCode).toBe(409);
      expect((await deploy(w.id, v)).statusCode).toBe(409);
    });
  });

  describe("webhook deliveries", () => {
    it("starts a run when a refused delivery is retried, and lists duplicates", async () => {
      const w = await create("Retry hook", [
        { type: "webhook", path: "retry-hook", signature: "none" },
      ]);
      const dep = await deploy(w.id, await publish(w.id));
      const hookId = dep.json().triggers.webhooks[0].id as string;
      await call(t.app, jar, "PATCH", `/v1/webhooks/${hookId}`, {
        idempotencyHeader: "X-Delivery-Id",
      });
      // the blank workflow requires `message`: the first attempt is refused
      const refused = await hook("dev/retry-hook", JSON.stringify({}), { "x-delivery-id": "r-1" });
      expect(refused.statusCode).toBe(400);
      const retried = await hook("dev/retry-hook", JSON.stringify({ message: "fixed" }), {
        "x-delivery-id": "r-1",
      });
      expect(retried.statusCode).toBe(202);
      const runId = retried.json().run_id as string;
      expect(runId).toBeTruthy();
      const again = await hook("dev/retry-hook", JSON.stringify({ message: "fixed" }), {
        "x-delivery-id": "r-1",
      });
      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual({ run_id: runId, duplicate: true });

      const deliveries = (
        await call(t.app, jar, "GET", `/v1/webhooks/${hookId}/deliveries`)
      ).json() as { items: { status: string; runId: string | null; attempt: number }[] };
      const accepted = deliveries.items.find((d) => d.status === "accepted");
      expect(accepted).toMatchObject({ runId, attempt: 2 });
      expect(deliveries.items.some((d) => d.status === "duplicate" && d.runId === runId)).toBe(
        true,
      );
    });
  });

  describe("redeploys", () => {
    it("keep a webhook switched off by hand, and bring back one a version dropped", async () => {
      const hookTrigger = { type: "webhook", path: "kept-off", signature: "none" };
      const w = await create("Kept off", [hookTrigger]);
      const v1 = await publish(w.id);
      const hookId = (await deploy(w.id, v1)).json().triggers.webhooks[0].id as string;
      await call(t.app, jar, "PATCH", `/v1/webhooks/${hookId}`, { enabled: false });

      expect((await deploy(w.id, v1)).statusCode).toBe(200);
      const enabled = async () =>
        (
          (await call(t.app, jar, "GET", "/v1/webhooks?limit=200")).json() as {
            items: { id: string; enabled: boolean }[];
          }
        ).items.find((h) => h.id === hookId)?.enabled;
      expect(await enabled()).toBe(false);

      // a version without the trigger, then one with it again: the deploy switched it off, so
      // declaring it again switches it back on
      const current = (await call(t.app, jar, "GET", `/v1/workflows/${w.id}`)).json();
      const dropped = await call(
        t.app,
        jar,
        "PUT",
        `/v1/workflows/${w.id}/draft`,
        { definition: { ...current.draft, triggers: [] } },
        { "if-match": String(current.draftRevision) },
      );
      await deploy(w.id, await publish(w.id));
      await call(
        t.app,
        jar,
        "PUT",
        `/v1/workflows/${w.id}/draft`,
        { definition: { ...current.draft, triggers: [hookTrigger], description: "again" } },
        { "if-match": String(dropped.json().draftRevision) },
      );
      await deploy(w.id, await publish(w.id));
      expect(await enabled()).toBe(true);
    });
  });

  describe("credentials", () => {
    it("rotating keeps the fields that are not secret", async () => {
      const created = await call(t.app, jar, "POST", "/v1/credentials", {
        name: "Basic auth for rotation",
        type: "http.basic",
        values: { username: "svc-user", password: "old-password" },
      });
      expect(created.statusCode).toBe(201);
      const id = created.json().id as string;
      const rotated = await call(t.app, jar, "POST", `/v1/credentials/${id}/rotate`, {
        values: { password: "new-password" },
      });
      expect(rotated.statusCode).toBe(200);
      expect(rotated.json().publicFields).toMatchObject({ username: "svc-user" });
      expect(await t.ctx.credentials.decrypt(id)).toEqual({
        username: "svc-user",
        password: "new-password",
      });
    });

    it("a type without a connection test records no test result", async () => {
      const created = await call(t.app, jar, "POST", "/v1/credentials", {
        name: "Header without a probe",
        type: "http.header",
        values: { name: "X-Token", value: "abc" },
      });
      const id = created.json().id as string;
      const tested = await call(t.app, jar, "POST", `/v1/credentials/${id}/test`);
      expect(tested.json().ok).toBe(true);
      const after = (await call(t.app, jar, "GET", `/v1/credentials/${id}`)).json();
      expect(after.lastTestedAt).toBeNull();
      expect(after.lastTestOk).toBeNull();
    });
  });

  describe("evaluation gate links (migration 0017)", () => {
    it("repairs links to deleted sets and clears them when a set is deleted", async () => {
      const w = await create("Gate link");
      const newSet = async (name: string) =>
        (await call(t.app, jar, "POST", "/v1/evaluations/sets", { name, workflowId: w.id })).json()
          .id as string;
      const link = (setId: string) =>
        call(t.app, jar, "PATCH", `/v1/workflows/${w.id}`, { evaluationSetId: setId });
      const linked = async () =>
        (await t.db.admin`select evaluation_set_id from workflows where id = ${w.id}`)[0]
          ?.evaluation_set_id as string | null;

      // a database from before 0017: no key, and a link left pointing at a deleted set
      const gone = await newSet("Deleted before 0017");
      expect((await link(gone)).statusCode).toBe(200);
      await t.db.owner.sql.unsafe(
        'ALTER TABLE "workflows" DROP CONSTRAINT IF EXISTS "workflows_evaluation_set_id_evaluation_sets_id_fk"',
      );
      await t.db.admin`delete from evaluation_sets where id = ${gone}`;
      expect(await linked()).toBe(gone);

      const { readFileSync } = await import("node:fs");
      const { MIGRATIONS_DIR } = await import("@flowaid/database");
      const migration = readFileSync(`${MIGRATIONS_DIR}/0017_evaluation_set_fk.sql`, "utf8");
      for (let i = 0; i < 2; i++)
        for (const statement of migration.split("--> statement-breakpoint"))
          await t.db.owner.sql.unsafe(statement);
      expect(await linked()).toBeNull();

      // from now on the database clears the link itself, whoever deletes the set
      const kept = await newSet("Deleted after 0017");
      expect((await link(kept)).statusCode).toBe(200);
      await t.db.admin`delete from evaluation_sets where id = ${kept}`;
      expect(await linked()).toBeNull();
    });
  });

  describe("environments", () => {
    it("refuses a rename onto another environment's name", async () => {
      const res = await call(t.app, jar, "PATCH", `/v1/environments/${envs.staging as string}`, {
        name: "prod",
      });
      expect(res.statusCode).toBe(409);
    });

    it("refuses to delete one with runs, and revokes keys pinned to one it deletes", async () => {
      const used = await call(t.app, jar, "DELETE", `/v1/environments/${envs.dev as string}`);
      expect(used.statusCode).toBe(409);
      expect(used.json().error.message).toMatch(/runs keep their environment/);

      const env = (
        await call(t.app, jar, "POST", "/v1/environments", { name: "scratch" })
      ).json() as { id: string };
      const key = (
        await call(t.app, jar, "POST", "/v1/api-keys", {
          name: "scratch-only",
          scopes: ["runs:read"],
          environmentId: env.id,
        })
      ).json() as { id: string; key: string };
      expect((await call(t.app, jar, "DELETE", `/v1/environments/${env.id}`)).statusCode).toBe(204);
      const asKey = await call(t.app, null, "GET", "/v1/runs", undefined, {
        authorization: `Bearer ${key.key}`,
      });
      expect(asKey.statusCode).toBe(401);
    });
  });
});
