import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseGuardArgs, spawnGuarded, type Guarded } from "./guard.ts";

const WINDOWS = process.platform === "win32";

/**
 * A command like the API: it starts a grandchild (as tsx watch, next dev and PageIndex jobs
 * do), writes both pids, and on SIGTERM or the IPC shutdown message records a graceful stop.
 */
const FIXTURE = String.raw`
const { spawn } = require("node:child_process");
const { writeFileSync, appendFileSync } = require("node:fs");
const dir = process.argv[1];
const ignoreTerm = process.argv[2] === "ignore-term";
const grand = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(dir + "/pids", JSON.stringify({ child: process.pid, grand: grand.pid }));
const graceful = () => { appendFileSync(dir + "/log", "graceful\n"); grand.kill(); process.exit(0); };
if (ignoreTerm) process.on("SIGTERM", () => appendFileSync(dir + "/log", "ignored\n"));
else process.on("SIGTERM", graceful);
process.on("message", (m) => { if (m === "flowaid:shutdown") graceful(); });
setInterval(() => {}, 1000);
`;

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(check: () => boolean, ms = 10_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
}

let dir = "";
let running: Guarded | null = null;
afterEach(() => {
  running?.kill();
  running = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function start(o: { ignoreTerm?: boolean; graceMs?: number; ipc?: boolean } = {}) {
  dir = mkdtempSync(join(tmpdir(), "flowaid-guard-"));
  const guarded = spawnGuarded(
    process.execPath,
    ["-e", FIXTURE, dir, ...(o.ignoreTerm ? ["ignore-term"] : [])],
    { ipc: o.ipc ?? WINDOWS, graceMs: o.graceMs ?? 10_000, output: "ignore" },
  );
  running = guarded;
  const exited = new Promise<number | null>((r) => guarded.process.once("exit", (c) => r(c)));
  expect(await until(() => existsSync(join(dir, "pids")))).toBe(true);
  const pids = JSON.parse(readFileSync(join(dir, "pids"), "utf8")) as {
    child: number;
    grand: number;
  };
  expect(await guarded.pid).toBe(pids.child);
  return { guarded, pids, exited };
}

const log = () => (existsSync(join(dir, "log")) ? readFileSync(join(dir, "log"), "utf8") : "");
const gone = (pids: { child: number; grand: number }) => () =>
  !alive(pids.child) && !alive(pids.grand);

describe("the process guard", () => {
  it("stops the command gracefully, with everything it started", async () => {
    const { guarded, pids, exited } = await start();
    guarded.stop();
    expect(await exited).toBe(0);
    expect(await until(gone(pids))).toBe(true);
    expect(log()).toContain("graceful");
  });

  it("stops the tree by itself when the launcher disappears", async () => {
    const { guarded, pids, exited } = await start();
    // what a crashed or killed launcher looks like to the guard: its stdin closes
    guarded.process.stdin?.end();
    await exited;
    expect(await until(gone(pids))).toBe(true);
    expect(log()).toContain("graceful");
  });

  it("kills a command that ignores the stop once the grace period ends", async () => {
    const { guarded, pids, exited } = await start({ ignoreTerm: true, graceMs: 300 });
    guarded.stop();
    await exited;
    expect(await until(gone(pids))).toBe(true);
    if (!WINDOWS) expect(log()).toContain("ignored");
  });

  it("kills the tree at once when asked", async () => {
    const { guarded, pids, exited } = await start({ ignoreTerm: true, graceMs: 60_000 });
    guarded.kill();
    await exited;
    expect(await until(gone(pids), 5000)).toBe(true);
  });

  it("exits with the command's code, taking its leftovers along", async () => {
    dir = mkdtempSync(join(tmpdir(), "flowaid-guard-"));
    const script = String.raw`
      const { spawn } = require("node:child_process");
      const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      require("node:fs").writeFileSync(process.argv[1] + "/grand", String(g.pid));
      setTimeout(() => process.exit(3), 200);`;
    const guarded = spawnGuarded(process.execPath, ["-e", script, dir], { output: "ignore" });
    running = guarded;
    const code = await new Promise<number | null>((r) => guarded.process.once("exit", r));
    expect(code).toBe(3);
    const grand = Number(readFileSync(join(dir, "grand"), "utf8"));
    // Windows keeps no process group to sweep (there the launcher's stop reaches the tree), so
    // only macOS and Linux promise it; whatever is left here is cleaned up
    if (!WINDOWS) expect(await until(() => !alive(grand))).toBe(true);
    else if (alive(grand)) process.kill(grand);
  });
});

describe("parseGuardArgs", () => {
  it("reads the flags before -- and the command after", () => {
    expect(parseGuardArgs(["--ipc", "--grace-ms", "500", "--", "node", "a.js", "--x"])).toEqual({
      command: "node",
      args: ["a.js", "--x"],
      ipc: true,
      graceMs: 500,
    });
    expect(parseGuardArgs(["--", "next"]).graceMs).toBe(30_000);
    expect(() => parseGuardArgs(["node"])).toThrow(/usage/);
    expect(() => parseGuardArgs(["--grace-ms", "x", "--", "node"])).toThrow(/integer/);
  });
});
