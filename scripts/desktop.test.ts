import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  activityText,
  appBrowserCandidates,
  appWindowArgs,
  desktopAvailable,
  findAppBrowser,
  trayCommands,
  type TrayCommand,
} from "./desktop.ts";

describe("desktopAvailable", () => {
  it("opens a window and an icon on a desktop only", () => {
    expect(desktopAvailable({}, "darwin")).toBe(true);
    expect(desktopAvailable({}, "win32")).toBe(true);
    expect(desktopAvailable({ DISPLAY: ":0" }, "linux")).toBe(true);
    expect(desktopAvailable({ WAYLAND_DISPLAY: "wayland-0" }, "linux")).toBe(true);
    // headless Linux, CI and SSH sessions have no screen here
    expect(desktopAvailable({}, "linux")).toBe(false);
    expect(desktopAvailable({ CI: "true" }, "darwin")).toBe(false);
    expect(desktopAvailable({ SSH_CONNECTION: "10.0.0.2 5000 10.0.0.3 22" }, "darwin")).toBe(false);
    expect(desktopAvailable({ SSH_TTY: "/dev/ttys001", DISPLAY: ":10" }, "linux")).toBe(false);
  });
});

describe("findAppBrowser", () => {
  it("prefers Chrome, then Edge, Brave and Chromium, on macOS", () => {
    const installed = new Set([
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]);
    expect(findAppBrowser({ HOME: "/Users/me" }, "darwin", (p) => installed.has(p))).toBe(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    );
    expect(
      findAppBrowser({ HOME: "/Users/me" }, "darwin", (p) =>
        p.startsWith("/Users/me/Applications/Chromium.app"),
      ),
    ).toBe("/Users/me/Applications/Chromium.app/Contents/MacOS/Chromium");
  });

  it("looks in Program Files on Windows and on PATH on Linux", () => {
    const win = appBrowserCandidates({ PROGRAMFILES: "C:\\Program Files" }, "win32");
    expect(win[0]).toBe("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
    expect(win).toContain("C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe");
    expect(
      findAppBrowser(
        { PATH: "/usr/local/bin:/usr/bin" },
        "linux",
        (p) => p === "/usr/bin/chromium",
      ),
    ).toBe("/usr/bin/chromium");
  });

  it("falls back to the default browser when none is installed", () => {
    expect(findAppBrowser({ HOME: "/Users/me" }, "darwin", () => false)).toBeNull();
  });
});

describe("appWindowArgs", () => {
  it("opens an app window with FlowAId's own profile", () => {
    const args = appWindowArgs("http://flowaid.localhost:3000", "/repo/.flowaid/window");
    // the marker tells the page it is the window this launcher can close
    expect(args).toContain("--app=http://flowaid.localhost:3000/#flowaid-window");
    expect(args).toContain("--user-data-dir=/repo/.flowaid/window");
    expect(args).toContain("--no-first-run");
  });
});

describe("trayCommands", () => {
  it("passes on open and quit, one per line, and ignores anything else", async () => {
    const out = new PassThrough();
    const seen: TrayCommand[] = [];
    trayCommands(out, (c) => seen.push(c));
    out.write("open\nnoise\n  quit  \nrm -rf /\n");
    out.end("open");
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual(["open", "quit", "open"]);
  });
});

describe("activityText", () => {
  it("says what runs in the background, for the icon's menu", () => {
    expect(activityText({ runs: 0, approvals: 0 })).toBe("No runs in progress");
    expect(activityText({ runs: 1, approvals: 0 })).toBe("1 run in progress");
    expect(activityText({ runs: 3, approvals: 1 })).toBe("3 runs in progress · 1 approval waiting");
    expect(activityText({ runs: 0, approvals: 2 })).toBe(
      "No runs in progress · 2 approvals waiting",
    );
  });
});
