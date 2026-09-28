import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { auditEvents, templates, users } from "@flowaid/database";
import { eq } from "drizzle-orm";
import { firstBoot } from "./bootstrap/firstBoot.js";
import { Jar, OWNER, call, createTestApp, login, type TestApp } from "./test/app.js";

describeDb("identity and access (Postgres)", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  // Every test signs in from 127.0.0.1: move past the per-IP login window.
  beforeEach(() => {
    t.clock.t += 61_000;
  });
  const audit = async (action: string) =>
    (await t.db.admin`select * from audit_events where action = ${action}`).length;

  it("first boot created the owner, the default workspace, three environments and templates — once", async () => {
    const again = await firstBoot(t.ctx.db, {
      adminEmail: "other@example.com",
      adminPassword: "Another-Pass-1",
    });
    expect(again.created).toBe(false);
    const envs = await t.db.admin`select name, protected from environments order by name`;
    expect(envs.map((e) => `${e.name}:${e.protected}`)).toEqual([
      "dev:false",
      "prod:true",
      "staging:false",
    ]);
    expect((await t.db.admin`select slug from workspaces`).map((w) => w.slug)).toEqual(["default"]);
    const tpl = await t.db.admin`select slug, required_resources from templates order by slug`;
    expect(tpl.map((x) => x.slug)).toEqual([
      "github-issue-triage",
      "github-issue-triage.retrieval",
      "research-agent",
      "support-triage",
    ]);
    void templates;
    void users;
  });

  it("login sets hardened cookies and returns the session; me reports the principal", async () => {
    const res = await t.app.inject({ method: "POST", url: "/v1/auth/login", payload: OWNER });
    expect(res.statusCode).toBe(200);
    const cookies = res.cookies as unknown as {
      name: string;
      path: string;
      httpOnly: boolean;
      secure: boolean;
      sameSite: string;
    }[];
    expect(cookies.find((c) => c.name === "__Host-fa_session")).toMatchObject({
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });
    expect(cookies.find((c) => c.name === "fa_refresh")).toMatchObject({
      path: "/v1/auth/refresh",
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
    });
    expect(res.json()).toMatchObject({
      user: { email: OWNER.email, status: "active" },
      workspaces: [{ slug: "default", role: "owner" }],
      mustChangePassword: false,
    });
    const jar = new Jar();
    jar.take(res);
    const me = (await call(t.app, jar, "GET", "/v1/me")).json();
    expect(me.principal).toMatchObject({ type: "user", workspaceSlug: "default", role: "owner" });
    expect(me.principal.scopes).toContain("admin");
    expect(me.features).toMatchObject({ workflows: true, knowledge: true });
    expect(me.features).not.toHaveProperty("oidc");
    expect(await audit("auth.login")).toBeGreaterThan(0);
  });

  it("rejects wrong passwords (audited with a hashed email) and throttles", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: OWNER.email, password: "nope-nope-nope" },
    });
    expect(res.statusCode).toBe(401);
    const [row] = await t.db
      .admin`select details from audit_events where action = 'auth.login_failed' limit 1`;
    expect(row?.details).toMatchObject({ emailHash: expect.stringMatching(/^[0-9a-f]{16}$/) });
    expect(JSON.stringify(row?.details)).not.toContain(OWNER.email);
    let last = 0;
    for (let i = 0; i < 11; i++)
      last = (
        await t.app.inject({
          method: "POST",
          url: "/v1/auth/login",
          payload: { email: "throttle@example.com", password: "x" },
        })
      ).statusCode;
    expect(last).toBe(429);
  });

  it("requires X-Requested-With on cookie mutations (CSRF)", async () => {
    const jar = await login(t.app);
    const res = await t.app.inject({
      method: "POST",
      url: "/v1/environments",
      payload: { name: "qa" },
      headers: { cookie: jar.header("/v1/environments") },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/X-Requested-With/);
  });

  it("rotates refresh tokens and revokes the family on reuse", async () => {
    const jar = await login(t.app);
    const first = jar.get("fa_refresh");
    const r1 = await call(t.app, jar, "POST", "/v1/auth/refresh");
    expect(r1.statusCode).toBe(200);
    expect(jar.get("fa_refresh")).not.toBe(first);
    // A stolen, already-rotated token is presented: the whole family dies.
    const replay = await t.app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      headers: { cookie: `fa_refresh=${first}`, "x-requested-with": "flowaid" },
    });
    expect(replay.statusCode).toBe(401);
    expect(await audit("auth.refresh_reuse_detected")).toBe(1);
    const afterReuse = await call(t.app, jar, "POST", "/v1/auth/refresh");
    expect(afterReuse.statusCode).toBe(401);
  });

  it("logout-all invalidates live access tokens through the token version", async () => {
    const a = await login(t.app);
    const b = await login(t.app);
    expect((await call(t.app, a, "GET", "/v1/me")).statusCode).toBe(200);
    expect((await call(t.app, b, "POST", "/v1/auth/logout-all")).statusCode).toBe(204);
    expect((await call(t.app, a, "GET", "/v1/me")).statusCode).toBe(401);
  });

  it("API keys: shown once, scoped, capped by the creator's role, rotated with grace, revoked", async () => {
    const jar = await login(t.app);
    const created = await call(t.app, jar, "POST", "/v1/api-keys", {
      name: "ci",
      scopes: ["workflows:read", "runs:read", "admin"],
    });
    expect(created.statusCode).toBe(201);
    const { key, id } = created.json();
    const bearer = { authorization: `Bearer ${key}` };
    const envs = await t.app.inject({ method: "GET", url: "/v1/environments", headers: bearer });
    expect(envs.statusCode).toBe(200);
    expect(envs.json()).toHaveLength(3);
    const me = (await t.app.inject({ method: "GET", url: "/v1/me", headers: bearer })).json();
    expect(me.principal).toMatchObject({ type: "api_key", id });
    const list = (await call(t.app, jar, "GET", "/v1/api-keys")).json();
    expect(JSON.stringify(list)).not.toContain(key);

    // A viewer's key loses what the viewer cannot do.
    const member = await call(
      t.app,
      jar,
      "POST",
      `/v1/workspaces/${me.principal.workspaceId}/members`,
      { email: "viewer@example.com", role: "editor" },
    );
    expect(member.statusCode).toBe(201);
    const viewerId = member.json().userId as string;
    const pw = await import("./auth/passwords.js").then((m) => m.hashPassword("Viewer-Pass-12"));
    await t.db
      .admin`update users set password_hash = ${pw}, status = 'active' where id = ${viewerId}`;
    const vJar = await login(t.app, new Jar(), {
      email: "viewer@example.com",
      password: "Viewer-Pass-12",
    });
    const vKey = (
      await call(t.app, vJar, "POST", "/v1/api-keys", { name: "v", scopes: ["workflows:read"] })
    ).statusCode;
    expect(vKey).toBe(403); // editors lack api_keys:manage
    const tooMuch = await call(t.app, jar, "POST", "/v1/api-keys", {
      name: "x",
      scopes: ["nope:scope"],
    });
    expect(tooMuch.statusCode).toBe(400);

    const rotated = await call(t.app, jar, "POST", `/v1/api-keys/${id}/rotate`, {
      graceMinutes: 0,
    });
    expect(rotated.statusCode).toBe(200);
    const next = rotated.json().key as string;
    expect(
      (
        await t.app.inject({
          method: "GET",
          url: "/v1/environments",
          headers: { authorization: `Bearer ${next}` },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await t.app.inject({ method: "GET", url: "/v1/environments", headers: bearer })).statusCode,
    ).toBe(401);
    expect(
      (await call(t.app, jar, "DELETE", `/v1/api-keys/${rotated.json().id as string}`)).statusCode,
    ).toBe(204);
    expect(
      (
        await t.app.inject({
          method: "GET",
          url: "/v1/environments",
          headers: { authorization: `Bearer ${next}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(await audit("api_key.create")).toBeGreaterThan(0);
    expect(await audit("api_key.rotate")).toBe(1);
  });

  it("a demoted creator's key loses scopes on the next request", async () => {
    const jar = await login(t.app);
    const ws = (await call(t.app, jar, "GET", "/v1/me")).json().principal.workspaceId as string;
    const added = await call(t.app, jar, "POST", `/v1/workspaces/${ws}/members`, {
      email: "admin2@example.com",
      role: "admin",
    });
    const adminId = added.json().userId as string;
    const pw = await import("./auth/passwords.js").then((m) => m.hashPassword("Admin2-Pass-12"));
    await t.db
      .admin`update users set password_hash = ${pw}, status = 'active' where id = ${adminId}`;
    const aJar = await login(t.app, new Jar(), {
      email: "admin2@example.com",
      password: "Admin2-Pass-12",
    });
    const k = (
      await call(t.app, aJar, "POST", "/v1/api-keys", {
        name: "admin key",
        scopes: ["api_keys:manage", "workflows:read"],
      })
    ).json().key as string;
    const headers = { authorization: `Bearer ${k}` };
    expect((await t.app.inject({ method: "GET", url: "/v1/api-keys", headers })).statusCode).toBe(
      200,
    );
    expect(
      (
        await call(t.app, jar, "PATCH", `/v1/workspaces/${ws}/members/${adminId}`, {
          role: "viewer",
        })
      ).statusCode,
    ).toBe(204);
    expect((await t.app.inject({ method: "GET", url: "/v1/api-keys", headers })).statusCode).toBe(
      403,
    );
    expect(
      (await t.app.inject({ method: "GET", url: "/v1/environments", headers })).statusCode,
    ).toBe(200);
    // Removal revokes the key outright.
    expect(
      (await call(t.app, jar, "DELETE", `/v1/workspaces/${ws}/members/${adminId}`)).statusCode,
    ).toBe(204);
    expect(
      (await t.app.inject({ method: "GET", url: "/v1/environments", headers })).statusCode,
    ).toBe(401);
    expect((await call(t.app, aJar, "GET", "/v1/me")).statusCode).toBe(401);
  });

  it("environments CRUD with conflicts, and workspace settings", async () => {
    const jar = await login(t.app);
    const created = await call(t.app, jar, "POST", "/v1/environments", {
      name: "qa",
      variables: { REGION: "eu" },
    });
    expect(created.statusCode).toBe(201);
    expect((await call(t.app, jar, "POST", "/v1/environments", { name: "qa" })).statusCode).toBe(
      409,
    );
    const id = created.json().id as string;
    expect(
      (await call(t.app, jar, "PATCH", `/v1/environments/${id}`, { protected: true })).json(),
    ).toMatchObject({ protected: true, variables: { REGION: "eu" } });
    expect((await call(t.app, jar, "DELETE", `/v1/environments/${id}`)).statusCode).toBe(204);
    const ws = (await call(t.app, jar, "GET", "/v1/me")).json().principal.workspaceId as string;
    const patched = await call(t.app, jar, "PATCH", `/v1/workspaces/${ws}`, {
      settings: { retention: { runsDays: 30 } },
    });
    expect(patched.json().settings).toMatchObject({ retention: { runsDays: 30 } });
    expect(
      (
        await call(t.app, jar, "PATCH", `/v1/workspaces/${ws}`, {
          settings: { retention: { auditDays: 7 } },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("a new user without a workspace can create one; slugs are unique", async () => {
    const pw = await import("./auth/passwords.js").then((m) => m.hashPassword("Loner-Pass-123"));
    await t.db
      .admin`insert into users (id, email, name, password_hash, status) values (gen_random_uuid(), 'loner@example.com', 'Loner', ${pw}, 'active')`;
    const jar = await login(t.app, new Jar(), {
      email: "loner@example.com",
      password: "Loner-Pass-123",
    });
    expect((await call(t.app, jar, "GET", "/v1/environments")).statusCode).toBe(403);
    expect(
      (await call(t.app, jar, "POST", "/v1/workspaces", { name: "Mine", slug: "default" }))
        .statusCode,
    ).toBe(409);
    const ws = await call(t.app, jar, "POST", "/v1/workspaces", {
      name: "Mine",
      slug: "loner-space",
    });
    expect(ws.statusCode).toBe(201);
    const envs = await call(t.app, jar, "GET", "/v1/environments", undefined, {
      "x-workspace": "loner-space",
    });
    expect(envs.json()).toHaveLength(3);
    expect(
      (await call(t.app, jar, "GET", "/v1/environments", undefined, { "x-workspace": "default" }))
        .statusCode,
    ).toBe(403);
  });

  it("the invited first-boot owner must change the password", async () => {
    const other = await createTestApp();
    try {
      await other.db.admin`delete from users`;
      const boot = await firstBoot(other.ctx.db, {});
      expect(boot).toMatchObject({
        created: true,
        ownerEmail: "owner@flowaid.local",
        generatedPassword: expect.any(String),
      });
      const res = await other.app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email: "owner@flowaid.local", password: boot.generatedPassword },
      });
      expect(res.json()).toMatchObject({ mustChangePassword: true });
      const jar = new Jar();
      jar.take(res);
      expect(
        (
          await call(other.app, jar, "POST", "/v1/me/password", {
            currentPassword: boot.generatedPassword,
            newPassword: "weak",
          })
        ).statusCode,
      ).toBe(400);
      const changed = await call(other.app, jar, "POST", "/v1/me/password", {
        currentPassword: boot.generatedPassword,
        newPassword: "A-Much-Better-1",
      });
      expect(changed.json()).toMatchObject({ mustChangePassword: false });
      expect((await call(other.app, jar, "GET", "/v1/me")).statusCode).toBe(200);
    } finally {
      await other.close();
    }
    void auditEvents;
    void eq;
  });
});
