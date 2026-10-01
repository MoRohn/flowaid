import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  endLeftovers,
  readInstance,
  removeInstance,
  controlAnswers,
  findRunningLauncher,
  runningLauncher,
  writeInstance,
  type InstanceRecord,
} from "./instance.ts";

const record = (o: Partial<InstanceRecord> = {}): InstanceRecord => ({
  pid: 4242,
  startedAt: "2026-09-29T10:00:00.000Z",
  webUrl: "http://flowaid.localhost:3000",
  apiUrl: "http://flowaid.localhost:3001",
  control: { url: "http://127.0.0.1:50123", token: "t".repeat(64) },
  processes: [],
  ...o,
});

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("the launcher record", () => {
  it("round-trips, owner-only, and tolerates a missing or broken file", () => {
    dir = mkdtempSync(join(tmpdir(), "flowaid-instance-"));
    const path = join(dir, "launcher.json");
    expect(readInstance(path)).toBeNull();
    writeInstance(path, record());
    expect(readInstance(path)).toEqual(record());
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
    writeInstance(path, { nonsense: true } as unknown as InstanceRecord);
    expect(readInstance(path)).toBeNull();
    removeInstance(path);
    expect(readInstance(path)).toBeNull();
  });
});

describe("findRunningLauncher", () => {
  const answering =
    (status: number, seen: string[] = []): typeof fetch =>
    (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      seen.push(`${url} ${new Headers(init?.headers).get("authorization") ?? ""}`);
      return Promise.resolve(new Response("{}", { status }));
    };

  it("trusts a launcher whose control channel answers with its token, without reading command lines", async () => {
    const rec = record({ pid: process.ppid });
    const seen: string[] = [];
    const cmd = vi.fn(() => null);
    expect(await findRunningLauncher(rec, { fetch: answering(200, seen), cmd })).toEqual(rec);
    expect(seen).toEqual([`${rec.control.url}/status Bearer ${rec.control.token}`]);
    expect(cmd).not.toHaveBeenCalled();
  });

  it("falls back to the command line when the channel does not answer", async () => {
    const rec = record({ pid: process.ppid });
    const down: typeof fetch = () => Promise.reject(new Error("ECONNREFUSED"));
    expect(
      await findRunningLauncher(rec, { fetch: down, cmd: () => "node scripts/start.ts" }),
    ).toEqual(rec);
    expect(
      await findRunningLauncher(rec, { fetch: answering(401), cmd: () => "vim notes.txt" }),
    ).toBeNull();
  });

  it("ignores a dead pid and itself", async () => {
    const fetchSpy = vi.fn(answering(200));
    expect(await findRunningLauncher(record({ pid: 999_999_9 }), { fetch: fetchSpy })).toBeNull();
    expect(await findRunningLauncher(record({ pid: process.pid }), { fetch: fetchSpy })).toBeNull();
    expect(await findRunningLauncher(null)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("controlAnswers is false without a channel", async () => {
    expect(await controlAnswers({ ...record(), control: { url: "", token: "" } })).toBe(false);
  });
});

describe("runningLauncher", () => {
  it("names a live launcher, not a process that reused its pid", () => {
    // this test process is alive; its command line decides
    const rec = record({ pid: process.ppid });
    expect(runningLauncher(rec, () => "node scripts/start.ts --prod")).toEqual(rec);
    expect(runningLauncher(rec, () => "C:\\repo\\node.exe C:\\repo\\scripts\\start.ts")).toEqual(
      rec,
    );
    expect(runningLauncher(rec, () => "/usr/bin/vim notes.txt")).toBeNull();
    expect(runningLauncher(record({ pid: 999_999_9 }), () => "scripts/start.ts")).toBeNull();
    expect(runningLauncher(null)).toBeNull();
  });
});

describe("endLeftovers", () => {
  const procs = [
    { name: "api guard", pid: 11, match: "scripts/guard.ts" },
    { name: "api", pid: 12, match: "src/main.ts" },
    { name: "web", pid: 13, match: "next/dist/bin/next" },
  ];

  it("ends what is left, commands before their guards", () => {
    const killed: number[] = [];
    const ended = endLeftovers(record({ processes: procs }), {
      alive: () => true,
      cmd: (pid) =>
        ({
          11: "node scripts/guard.ts -- node src/main.ts",
          12: "node src/main.ts",
          13: "node /repo/apps/web/node_modules/next/dist/bin/next dev",
        })[pid] ?? null,
      kill: (pid) => void killed.push(pid),
    });
    expect(killed).toEqual([12, 13, 11]);
    expect(ended).toEqual(["api", "web", "api guard"]);
  });

  it("leaves alone a pid that another program now uses, and what already stopped", () => {
    const killed: number[] = [];
    const ended = endLeftovers(record({ processes: procs }), {
      alive: (pid) => pid !== 13,
      cmd: (pid) => (pid === 12 ? "/Applications/Music.app/Contents/MacOS/Music" : "x"),
      kill: (pid) => void killed.push(pid),
    });
    expect(killed).toEqual([]);
    expect(ended).toEqual([]);
  });

  it("matches Windows command lines, whatever the slashes", () => {
    const killed: number[] = [];
    endLeftovers(
      record({ processes: [{ name: "api guard", pid: 21, match: "scripts/guard.ts" }] }),
      {
        alive: () => true,
        cmd: () => '"C:\\Program Files\\nodejs\\node.exe" C:\\flowaid\\scripts\\guard.ts --',
        kill: (pid) => void killed.push(pid),
      },
    );
    expect(killed).toEqual([21]);
  });
});
