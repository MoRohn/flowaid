import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { LauncherClient, startActivityReports } from "./services/desktop.js";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

const TOKEN = "t".repeat(64);

/** A stand-in for the launcher's control channel (scripts/control.ts). */
function fakeLauncher() {
  const seen: string[] = [];
  let window: "app" | "browser" | "none" = "app";
  const server: Server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401).end();
      return;
    }
    seen.push(`${req.method} ${req.url}`);
    const json = (status: number, body: unknown) =>
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (req.url === "/status") return json(200, { window, tray: true, platform: "macos" });
    if (req.url === "/window/close") return json(200, { closed: window === "app" });
    if (req.url === "/quit") return json(202, { stopping: true });
    if (req.url === "/activity") {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        seen.push(`activity ${body}`);
        res.writeHead(204).end();
      });
      return;
    }
    return json(404, {});
  });
  return {
    seen,
    setWindow: (w: typeof window) => (window = w),
    start: () =>
      new Promise<string>((resolve) =>
        server.listen(0, "127.0.0.1", () =>
          resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
        ),
      ),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describeDb("desktop: Close window and Quit FlowAId through the launcher (Postgres)", () => {
  const launcher = fakeLauncher();
  let t: TestApp;
  let plain: TestApp;
  let jar: Jar;
  beforeAll(async () => {
    const url = await launcher.start();
    t = await createTestApp({ launcher: { url, token: TOKEN } });
    plain = await createTestApp();
    jar = await login(t.app);
  });
  afterAll(async () => {
    await t.close();
    await plain.close();
    await launcher.stop();
  });

  it("reports the desktop feature only when a launcher started the API", async () => {
    expect((await call(t.app, jar, "GET", "/v1/me")).json().features.desktop).toBe(true);
    const plainJar = await login(plain.app);
    expect((await call(plain.app, plainJar, "GET", "/v1/me")).json().features.desktop).toBe(false);
    const res = await call(plain.app, plainJar, "POST", "/v1/desktop/quit");
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("DESKTOP_UNAVAILABLE");
  });

  it("reports what the launcher manages", async () => {
    const res = await call(t.app, jar, "GET", "/v1/desktop");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      window: "app",
      tray: true,
      platform: "macos",
      activity: { runs: 0, approvals: 0 },
    });
  });

  it("reports what runs in the background to the launcher, for its icon", async () => {
    launcher.seen.length = 0;
    const url = t.ctx.config.launcher?.url ?? "";
    const stop = startActivityReports(t.ctx.db, new LauncherClient({ url, token: TOKEN }), {
      everyMs: 30,
    });
    try {
      await expect
        .poll(() => launcher.seen.filter((s) => s.startsWith("activity")).length)
        .toBeGreaterThan(0);
      expect(launcher.seen).toContain('activity {"runs":0,"approvals":0}');
    } finally {
      stop();
    }
  });

  it("closes the app window, and says when it cannot (a browser tab)", async () => {
    launcher.setWindow("app");
    const closed = await call(t.app, jar, "POST", "/v1/desktop/window/close");
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toEqual({ closed: true });
    launcher.setWindow("browser");
    expect((await call(t.app, jar, "POST", "/v1/desktop/window/close")).json()).toEqual({
      closed: false,
    });
  });

  it("quits through the launcher and audits who did", async () => {
    launcher.seen.length = 0;
    const res = await call(t.app, jar, "POST", "/v1/desktop/quit");
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ stopping: true });
    expect(launcher.seen).toEqual(["POST /quit"]);
    const audit = (await call(t.app, jar, "GET", "/v1/audit?action=application.quit")).json() as {
      items: unknown[];
    };
    expect(audit.items).toHaveLength(1);
  });

  describe("who may", () => {
    it("refuses API keys, even with every scope, and requests without the CSRF header", async () => {
      const key = (
        await call(t.app, jar, "POST", "/v1/api-keys", { name: "automation", scopes: ["admin"] })
      ).json().key as string | undefined;
      const headers = { authorization: `Bearer ${key ?? "fl_none"}` };
      for (const [method, url] of [
        ["GET", "/v1/desktop"],
        ["POST", "/v1/desktop/window/close"],
        ["POST", "/v1/desktop/quit"],
      ] as const) {
        const res = await t.app.inject({ method, url, headers });
        expect([401, 403], `${method} ${url}`).toContain(res.statusCode);
      }
      launcher.seen.length = 0;
      const noCsrf = await t.app.inject({
        method: "POST",
        url: "/v1/desktop/quit",
        headers: { cookie: jar.header("/v1/desktop/quit") },
      });
      expect(noCsrf.statusCode).toBe(403);
      expect(launcher.seen).toEqual([]);
    });

    it("reports a launcher that does not answer as unavailable", async () => {
      const gone = await createTestApp({
        launcher: { url: "http://127.0.0.1:9", token: TOKEN },
      });
      try {
        const res = await call(gone.app, await login(gone.app), "POST", "/v1/desktop/quit");
        expect(res.statusCode).toBe(503);
        expect(res.json().error.code).toBe("LAUNCHER_UNAVAILABLE");
      } finally {
        await gone.close();
      }
    });
  });
});
