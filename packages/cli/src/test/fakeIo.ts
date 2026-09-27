/** An in-memory `CliIO` with a scripted `fetch` for CLI tests. */
import type { CliIO } from "../io.js";

export interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

export type Route = (call: Call) => Response | undefined;

export const json = (status: number, body: unknown, type = "application/json"): Response =>
  new Response(status === 204 ? null : typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": type },
  });

export function fakeIo(
  routes: Route[] = [],
  o: { env?: Record<string, string>; files?: Record<string, string>; stdin?: string } = {},
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const calls: Call[] = [];
  const files = new Map<string, string | Uint8Array>(Object.entries(o.files ?? {}));
  const modes = new Map<string, number | undefined>();
  const execs: { command: string; args: string[] }[] = [];
  const io: CliIO = {
    out: (t) => void stdout.push(t),
    err: (t) => void stderr.push(t),
    env: { XDG_CONFIG_HOME: "/cfg", ...o.env },
    cwd: "/work",
    home: "/home/u",
    readText: (path) => {
      const f = files.get(path);
      return f === undefined
        ? Promise.reject(new Error(`ENOENT: ${path}`))
        : Promise.resolve(typeof f === "string" ? f : new TextDecoder().decode(f));
    },
    readStdin: () => Promise.resolve(o.stdin ?? ""),
    writeFile: (path, data, mode) => {
      files.set(path, data);
      modes.set(path, mode);
      return Promise.resolve();
    },
    exec: (command, args) => {
      execs.push({ command, args });
      return Promise.resolve(0);
    },
    fetch: (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      const call: Call = {
        method: init.method ?? "GET",
        url,
        headers: Object.fromEntries(
          Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
            k.toLowerCase(),
            v,
          ]),
        ),
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      for (const r of routes) {
        const res = r(call);
        if (res) return Promise.resolve(res);
      }
      return Promise.resolve(
        json(404, {
          error: { code: "NOT_FOUND", message: "no route", retryable: false, request_id: "r1" },
        }),
      );
    },
  };
  return { io, stdout, stderr, calls, files, modes, execs };
}
