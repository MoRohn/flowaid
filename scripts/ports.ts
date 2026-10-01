/**
 * The ports `pnpm start` and `pnpm preflight` use. The web app is the address people open
 * (http://flowaid.localhost:3000); the API sits beside it on 3001. When a default port is taken
 * by another app the next free one is used instead; a port someone asked for explicitly is never
 * swapped for another. Runs on plain Node: only `node:` built-ins and erasable TypeScript.
 */
import { connect, createServer } from "node:net";

/** The web app: the address in the browser. */
export const DEFAULT_WEB_PORT = 3000;
/** The API: the web app forwards browser calls to it; scripts and SDKs call it directly. */
export const DEFAULT_API_PORT = 3001;
const MAX_PORT = 65_535;
/** How many ports above a busy default are tried before giving up. */
const ATTEMPTS = 50;

function canListen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

/** True when something accepts connections on host:port. */
function answers(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/**
 * Resolves true when nothing is listening on host:port. Binding alone is not enough: another app
 * on the IPv6 wildcard (`:::3000`) leaves 127.0.0.1:3000 bindable, yet a browser opening
 * flowaid.localhost:3000 over ::1 would reach that app. So for a loopback or wildcard bind both
 * loopback addresses must also be silent.
 */
export async function portIsFree(host: string, port: number): Promise<boolean> {
  if (!(await canListen(host, port))) return false;
  const local = host === "0.0.0.0" || host === "::" || host === "localhost" || /^127\./.test(host);
  const probes = local || host === "::1" ? ["127.0.0.1", "::1"] : [host];
  const heard = await Promise.all(probes.map((h) => answers(h, port)));
  return !heard.includes(true);
}

/**
 * Waits until every port is free (processes that were just ended can hold theirs for a moment),
 * polling every 200 ms; true when they all freed within `timeoutMs`.
 */
export async function waitForPortsFree(
  host: string,
  ports: readonly number[],
  timeoutMs = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const free = await Promise.all(ports.map((p) => portIsFree(host, p)));
    if (free.every(Boolean)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
}

export interface PortRequest {
  /** The port wanted: a default, or what the user passed. */
  port: number;
  /** Passed by the user (`--port 3000`): used as is or not at all. */
  explicit: boolean;
  /** Ports a fallback must skip, such as the one the API is about to take. */
  avoid?: readonly number[];
}

export type PortChoice =
  | { ok: true; port: number; requested: number; fallback: boolean }
  | { ok: false; requested: number; reason: "in-use" | "exhausted" };

/**
 * The port to listen on: the requested one when it is free; for a default that is busy, the
 * next free port above it (skipping `avoid`); for an explicit port that is busy, an error.
 */
export async function choosePort(
  request: PortRequest,
  isFree: (port: number) => Promise<boolean>,
): Promise<PortChoice> {
  const requested = request.port;
  const avoid = new Set(request.avoid ?? []);
  if (!avoid.has(requested) && (await isFree(requested)))
    return { ok: true, port: requested, requested, fallback: false };
  if (request.explicit) return { ok: false, requested, reason: "in-use" };
  let tried = 0;
  for (let port = requested + 1; port <= MAX_PORT && tried < ATTEMPTS; port += 1) {
    if (avoid.has(port)) continue;
    tried += 1;
    if (await isFree(port)) return { ok: true, port, requested, fallback: true };
  }
  return { ok: false, requested, reason: "exhausted" };
}
