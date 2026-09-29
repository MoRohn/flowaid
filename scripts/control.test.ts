import { afterEach, describe, expect, it } from "vitest";

import { platformName, startControl, type ControlHandlers } from "./control.ts";

const TOKEN = "a".repeat(64);

function handlers(o: { owned?: boolean } = {}) {
  const calls: string[] = [];
  const h: ControlHandlers = {
    status: () => ({
      window: o.owned === false ? "browser" : "app",
      tray: true,
      platform: "macos",
    }),
    closeWindow: () => (calls.push("close"), o.owned !== false),
    openWindow: () => void calls.push("open"),
    quit: () => void calls.push("quit"),
    activity: (a) => void calls.push(`activity ${a.runs}/${a.approvals}`),
  };
  return { h, calls };
}

let stop: (() => Promise<void>) | null = null;
afterEach(async () => {
  await stop?.();
  stop = null;
});

async function started(h: ControlHandlers, quitDelayMs = 0) {
  const control = await startControl({ token: TOKEN, handlers: h, quitDelayMs });
  stop = () => control.close();
  const req = (method: string, path: string, token: string | null = TOKEN) =>
    fetch(`${control.url}${path}`, {
      method,
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
    });
  return { url: control.url, req };
}

describe("the launcher's control channel", () => {
  it("listens on this computer only", async () => {
    const { url } = await started(handlers().h);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("refuses requests without this launch's token", async () => {
    const { h, calls } = handlers();
    const { req } = await started(h);
    expect((await req("POST", "/quit", null)).status).toBe(401);
    expect((await req("POST", "/quit", "b".repeat(64))).status).toBe(401);
    expect((await req("POST", "/quit", TOKEN.slice(1))).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("reports status and closes or opens the window", async () => {
    const owned = handlers();
    const { req } = await started(owned.h);
    expect(await (await req("GET", "/status")).json()).toEqual({
      window: "app",
      tray: true,
      platform: "macos",
    });
    expect(await (await req("POST", "/window/close")).json()).toEqual({ closed: true });
    expect(await (await req("POST", "/window/open")).json()).toEqual({ opened: true });
    expect(owned.calls).toEqual(["close", "open"]);
    expect((await req("GET", "/quit")).status).toBe(404);
  });

  it("says when there is no window it owns", async () => {
    const { req } = await started(handlers({ owned: false }).h);
    expect(await (await req("POST", "/window/close")).json()).toEqual({ closed: false });
  });

  it("answers a quit before stopping", async () => {
    const { h, calls } = handlers();
    const { req } = await started(h, 30);
    const res = await req("POST", "/quit");
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ stopping: true });
    expect(calls).toEqual([]);
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toEqual(["quit"]);
  });
});

describe("activity from the API", () => {
  it("passes counts on to the icon and refuses anything else", async () => {
    const { h, calls } = handlers();
    const { url } = await started(h);
    const post = (body: string) =>
      fetch(`${url}/activity`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body,
      });
    expect((await post(JSON.stringify({ runs: 2, approvals: 1 }))).status).toBe(204);
    expect((await post(JSON.stringify({ runs: -1, approvals: 0 }))).status).toBe(400);
    expect((await post(JSON.stringify({ runs: "2", approvals: 0 }))).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(calls).toEqual(["activity 2/1"]);
  });
});

describe("platformName", () => {
  it("names the platforms the app words its hints for", () => {
    expect(platformName("darwin")).toBe("macos");
    expect(platformName("win32")).toBe("windows");
    expect(platformName("linux")).toBe("linux");
    expect(platformName("freebsd")).toBe("other");
  });
});
