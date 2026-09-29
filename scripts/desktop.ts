/**
 * The desktop side of `./flowaid`: FlowAId's own window and its menu bar (tray) icon.
 *
 * - **The window.** With a Chromium browser installed (Chrome, Edge, Brave or Chromium), the app
 *   opens in an app window of its own: a separate profile in `.flowaid/window`, no tabs or address
 *   bar. The launcher started that browser, so it can close it ("Close window" in the app) and
 *   open it again. Without one, the default browser opens a tab, which only the page can close.
 * - **The icon.** A menu bar item on macOS (a small Swift helper, compiled once with the Xcode
 *   command line tools into `.flowaid/tray`), a notification-area icon on Windows (PowerShell and
 *   Windows Forms) and, on Linux, a `yad --notification` icon when yad is installed. Its menu
 *   opens the window again or quits FlowAId; the helper prints `open` or `quit` on stdout and
 *   exits with the launcher.
 *
 * Runs on plain Node (native type stripping), like start.ts.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { createInterface } from "node:readline";

import { spawnGuarded, type Guarded } from "./guard.ts";

export type Platform = "darwin" | "win32" | "linux" | (string & {});

/** Whether this session has a screen for a window and an icon: not CI, not over SSH, not headless Linux. */
export function desktopAvailable(env: NodeJS.ProcessEnv, platform: Platform): boolean {
  if (env.CI) return false;
  if (platform === "win32") return true;
  if (env.SSH_CONNECTION || env.SSH_TTY) return false;
  if (platform === "darwin") return true;
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

/** Chromium browsers that open app windows (`--app`), in order of preference. */
export function appBrowserCandidates(env: NodeJS.ProcessEnv, platform: Platform): string[] {
  if (platform === "darwin") {
    const apps = ["Google Chrome", "Microsoft Edge", "Brave Browser", "Chromium"];
    // the target's own path form, whichever computer computes it
    const dirs = ["/Applications", posix.join(env.HOME ?? "", "Applications")];
    return dirs.flatMap((d) => apps.map((a) => posix.join(d, `${a}.app`, "Contents/MacOS", a)));
  }
  if (platform === "win32") {
    const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(
      (r): r is string => Boolean(r),
    );
    const exes = [
      "Google\\Chrome\\Application\\chrome.exe",
      "Microsoft\\Edge\\Application\\msedge.exe",
      "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      "Chromium\\Application\\chrome.exe",
    ];
    return exes.flatMap((e) => roots.map((r) => `${r}\\${e}`));
  }
  const names = [
    "google-chrome",
    "google-chrome-stable",
    "microsoft-edge",
    "brave-browser",
    "chromium",
    "chromium-browser",
  ];
  const path = (env.PATH ?? "").split(":").filter(Boolean);
  return names.flatMap((n) => path.map((p) => posix.join(p, n)));
}

export function findAppBrowser(
  env: NodeJS.ProcessEnv,
  platform: Platform,
  exists: (path: string) => boolean = existsSync,
): string | null {
  return appBrowserCandidates(env, platform).find((p) => exists(p)) ?? null;
}

/**
 * Marks FlowAId's own window: the page records it for that window, so Close window there asks
 * this launcher, and anywhere else closes only that tab (apps/web/src/shell/appWindow.ts).
 */
export const APP_WINDOW_FRAGMENT = "#flowaid-window";

/** Arguments for FlowAId's own app window: its own profile, so it is a browser this launcher owns. */
export function appWindowArgs(url: string, profileDir: string): string[] {
  return [
    `--user-data-dir=${profileDir}`,
    `--app=${new URL(APP_WINDOW_FRAGMENT, url).href}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1440,900",
  ];
}

/** Opens `url` in the default browser: a tab the launcher cannot close. */
export function openInDefaultBrowser(url: string, platform: Platform = process.platform): void {
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, platform === "win32" ? ['""', url] : [url], {
    stdio: "ignore",
    detached: true,
    shell: platform === "win32",
  }).unref();
}

export type WindowKind = "app" | "browser";

/**
 * FlowAId's window: an app window the launcher owns, or a default-browser tab. The app browser
 * runs under a guard (scripts/guard.ts), so it closes with the launcher, however that stops.
 */
export class AppWindow {
  readonly kind: WindowKind;
  private readonly url: string;
  private readonly browser: string | null;
  private readonly profileDir: string;
  private readonly onStart: ((guardPid: number, pid: number) => void) | undefined;
  private guarded: Guarded | null = null;

  constructor(o: {
    url: string;
    browser: string | null;
    profileDir: string;
    /** the guard's and the browser's pids, for .flowaid/launcher.json */
    onStart?: (guardPid: number, pid: number) => void;
  }) {
    this.url = o.url;
    this.browser = o.browser;
    this.profileDir = o.profileDir;
    this.onStart = o.onStart;
    this.kind = o.browser ? "app" : "browser";
  }

  private running(): boolean {
    return this.guarded !== null && this.guarded.process.exitCode === null;
  }

  /** Opens the window, or a new one in the running app browser (it hands the request over). */
  open(): void {
    if (!this.browser) return openInDefaultBrowser(this.url);
    mkdirSync(this.profileDir, { recursive: true });
    const args = appWindowArgs(this.url, this.profileDir);
    if (this.running()) {
      // the browser already runs this profile: it opens the window and this process exits
      spawn(this.browser, args, { stdio: "ignore", windowsHide: true }).on("error", () =>
        openInDefaultBrowser(this.url),
      );
      return;
    }
    const g = spawnGuarded(this.browser, args, { graceMs: 5000, output: "ignore" });
    this.guarded = g;
    g.process.once("exit", (code) => {
      if (this.guarded === g) this.guarded = null;
      // 127: the browser did not start
      if (code === 127) openInDefaultBrowser(this.url);
    });
    const guardPid = g.process.pid;
    void g.pid.then((pid) => {
      if (pid !== null && guardPid !== undefined) this.onStart?.(guardPid, pid);
    });
  }

  /** Closes the app window. False when there is none this launcher owns (a browser tab). */
  close(): boolean {
    if (!this.guarded || !this.running()) return false;
    this.guarded.stop();
    this.guarded = null;
    return true;
  }
}

// ─── tray ────────────────────────────────────────────────────────────────────────────────────

export type TrayCommand = "open" | "quit";

/** What runs in the background, as the API reports it (scripts/control.ts `POST /activity`). */
export interface Activity {
  /** runs executing now (queued, starting, running, retrying) */
  runs: number;
  /** human tasks waiting for someone */
  approvals: number;
}

/** The icon's status line: what FlowAId is doing while its window may be closed. */
export function activityText(a: Activity): string {
  const parts = [
    a.runs === 0 ? "No runs in progress" : `${a.runs} run${a.runs === 1 ? "" : "s"} in progress`,
    ...(a.approvals > 0 ? [`${a.approvals} approval${a.approvals === 1 ? "" : "s"} waiting`] : []),
  ];
  return parts.join(" · ");
}

export interface Tray {
  readonly pid: number | undefined;
  /** shows the activity in the icon's menu (and, on macOS, the approvals as a badge) */
  update(activity: Activity): void;
  stop(): void;
}

/** Reads the helper's stdout: one command per line, anything else ignored. */
export function trayCommands(
  stream: NodeJS.ReadableStream,
  on: (command: TrayCommand) => void,
): void {
  createInterface({ input: stream }).on("line", (line) => {
    const c = line.trim();
    if (c === "open" || c === "quit") on(c);
  });
}

const HERE = import.meta.dirname;

/**
 * The macOS helper, compiled once per source version into `cacheDir`. Null (with the reason) when
 * the Swift compiler is missing: `xcode-select --install` provides it.
 */
function macHelper(cacheDir: string): { path: string } | { error: string } {
  const source = join(HERE, "desktop/tray-macos.swift");
  const hash = createHash("sha256").update(readFileSync(source)).digest("hex").slice(0, 12);
  const binary = join(cacheDir, `flowaid-tray-${hash}`);
  if (existsSync(binary)) return { path: binary };
  if (spawnSync("xcrun", ["-f", "swiftc"], { stdio: "ignore" }).status !== 0)
    return { error: "the Swift compiler is missing (install it with `xcode-select --install`)" };
  mkdirSync(cacheDir, { recursive: true });
  const built = spawnSync("xcrun", ["swiftc", "-O", "-swift-version", "5", source, "-o", binary], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  if (built.status !== 0)
    return { error: `the menu bar helper did not compile: ${built.stderr.toString().trim()}` };
  return { path: binary };
}

function onPath(name: string, env: NodeJS.ProcessEnv): boolean {
  return (env.PATH ?? "").split(":").some((p) => p && existsSync(join(p, name)));
}

/**
 * Starts the icon. Returns the running tray, or why there is none (the app works without it:
 * the address and Ctrl+C in the terminal still do).
 */
export function startTray(o: {
  url: string;
  cacheDir: string;
  onCommand: (command: TrayCommand) => void;
  platform?: Platform;
  env: NodeJS.ProcessEnv;
}): { tray: Tray } | { error: string } {
  const platform = o.platform ?? process.platform;
  const env = o.env;
  let child: ChildProcess;
  if (platform === "darwin") {
    const helper = macHelper(o.cacheDir);
    if ("error" in helper) return helper;
    child = spawn(helper.path, [o.url], { stdio: ["pipe", "pipe", "ignore"] });
  } else if (platform === "win32") {
    child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-File",
        join(HERE, "desktop/tray-windows.ps1"),
        "-Url",
        o.url,
        "-ParentPid",
        String(process.pid),
      ],
      { stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
    );
  } else {
    if (!onPath("yad", env))
      return { error: "no tray on Linux without yad (install it, e.g. `sudo apt install yad`)" };
    child = spawn(
      "yad",
      [
        "--notification",
        `--image=${join(HERE, "../apps/web/public/favicon.svg")}`,
        `--text=FlowAId · ${o.url}`,
        "--menu=Open FlowAId!echo open|Quit FlowAId!echo quit",
        "--command=echo open",
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
  }
  let stopped = false;
  child.on("error", () => undefined);
  child.stdin?.on("error", () => undefined);
  if (child.stdout) trayCommands(child.stdout, o.onCommand);
  return {
    tray: {
      pid: child.pid,
      update(activity) {
        // one JSON line per update; the helpers read their stdin (yad does not)
        if (stopped || !child.stdin?.writable) return;
        child.stdin.write(
          `${JSON.stringify({ type: "activity", ...activity, text: activityText(activity) })}\n`,
        );
      },
      stop() {
        if (stopped) return;
        stopped = true;
        // the helpers also exit when their stdin closes: with the launcher, however it stops
        child.stdin?.end();
        child.kill("SIGTERM");
      },
    },
  };
}

/**
 * A desktop notification: when an approval arrives while FlowAId runs in the background. On
 * Windows the notification-area icon shows it (a balloon); on macOS, `osascript`.
 */
export function notify(title: string, body: string, platform: Platform = process.platform): void {
  if (platform !== "darwin") return;
  const q = (s: string) => JSON.stringify(s);
  spawn("osascript", ["-e", `display notification ${q(body)} with title ${q(title)}`], {
    stdio: "ignore",
  }).on("error", () => undefined);
}
