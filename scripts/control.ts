/**
 * The launcher's control channel: how the API asks `./flowaid` to close FlowAId's window or quit
 * the whole application (`/v1/desktop/*`). It listens on 127.0.0.1 at a port the OS picks, and
 * every request carries a bearer token generated for this launch; both reach only the API, as
 * FLOWAID_LAUNCHER_URL and FLOWAID_LAUNCHER_TOKEN.
 *
 *   GET  /status        { window: "app" | "browser" | "none", tray: boolean, platform }
 *   POST /window/close  { closed: boolean }   false: no window the launcher owns (a browser tab)
 *   POST /window/open   { opened: true }
 *   POST /quit          202 { stopping: true }   answered first, then the launcher stops
 *   POST /activity      { runs, approvals }   what runs in the background, for the menu bar icon
 *
 * Runs on plain Node (native type stripping), like start.ts.
 */
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface LauncherStatus {
  window: "app" | "browser" | "none";
  tray: boolean;
  platform: "macos" | "windows" | "linux" | "other";
}

export interface ControlHandlers {
  status(): LauncherStatus;
  closeWindow(): boolean;
  openWindow(): void;
  quit(): void;
  activity(a: { runs: number; approvals: number }): void;
}

/** A count the API reports: a non-negative integer, or nothing. */
function count(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : null;
}

/** The request body, at most 1 KiB of JSON. */
function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 1024) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

export function platformName(platform: string): LauncherStatus["platform"] {
  return platform === "darwin"
    ? "macos"
    : platform === "win32"
      ? "windows"
      : platform === "linux"
        ? "linux"
        : "other";
}

function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (status === 204) {
    res.writeHead(204, { "cache-control": "no-store" }).end();
    return;
  }
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(json),
    "cache-control": "no-store",
  });
  res.end(json);
}

/** Starts the channel; `quitDelayMs` lets the answer reach the API before the launcher stops. */
export async function startControl(o: {
  token: string;
  handlers: ControlHandlers;
  quitDelayMs?: number;
}): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    if (!authorized(req, o.token)) return send(res, 401, { error: "unauthorized" });
    const route = `${req.method ?? ""} ${(req.url ?? "").split("?")[0]}`;
    try {
      switch (route) {
        case "GET /status":
          return send(res, 200, o.handlers.status());
        case "POST /window/close":
          return send(res, 200, { closed: o.handlers.closeWindow() });
        case "POST /window/open":
          o.handlers.openWindow();
          return send(res, 200, { opened: true });
        case "POST /activity":
          void readJson(req).then((body) => {
            const b = (body ?? {}) as Record<string, unknown>;
            const runs = count(b.runs);
            const approvals = count(b.approvals);
            if (runs === null || approvals === null)
              return send(res, 400, { error: "runs and approvals must be counts" });
            o.handlers.activity({ runs, approvals });
            send(res, 204, null);
          });
          return;
        case "POST /quit":
          send(res, 202, { stopping: true });
          setTimeout(() => o.handlers.quit(), o.quitDelayMs ?? 500).unref();
          return;
        default:
          return send(res, 404, { error: "not found" });
      }
    } catch (error) {
      return send(res, 500, { error: (error as Error).message });
    }
  });
  // the API is the only caller; no keep-alive sockets to wait for when stopping
  server.keepAliveTimeout = 0;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
