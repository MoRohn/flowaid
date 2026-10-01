/**
 * One FlowAId per checkout: `.flowaid/launcher.json` records the running launcher (its pid,
 * address and control channel) and every process it started, each with a fragment of its
 * command line.
 *
 * - `./flowaid` while FlowAId runs opens the running instance's window instead of starting a
 *   second stack on other ports.
 * - After a launcher that could not clean up (the machine slept through a kill, a guard was
 *   killed too), the next start ends what is left. It only ends a recorded pid whose command line
 *   still contains its recorded fragment, never an unrelated process that reused the pid.
 *
 * Runs on plain Node (native type stripping), like start.ts.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { killTree } from "./guard.ts";

export interface InstanceProcess {
  name: string;
  pid: number;
  /** a fragment of its command line, checked before it is ended */
  match: string;
}

export interface InstanceRecord {
  pid: number;
  startedAt: string;
  webUrl: string;
  apiUrl: string;
  control: { url: string; token: string };
  processes: InstanceProcess[];
}

export function readInstance(path: string): InstanceRecord | null {
  try {
    const rec = JSON.parse(readFileSync(path, "utf8")) as InstanceRecord;
    return typeof rec.pid === "number" && Array.isArray(rec.processes) ? rec : null;
  } catch {
    return null;
  }
}

/** Owner-only: the record carries the control channel's token. */
export function writeInstance(path: string, rec: InstanceRecord): void {
  writeFileSync(path, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Windows keeps the user profile's permissions */
  }
}

export function removeInstance(path: string): void {
  rmSync(path, { force: true });
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: alive, but another user's
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The process's command line, or null when it is gone. */
export function commandLine(pid: number, platform: string = process.platform): string | null {
  const result =
    platform === "win32"
      ? spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
          ],
          // WMI can take tens of seconds on a busy machine: give up rather than hang a launch
          { encoding: "utf8", windowsHide: true, timeout: COMMAND_LINE_TIMEOUT_MS },
        )
      : spawnSync("ps", ["-o", "command=", "-p", String(pid)], {
          encoding: "utf8",
          timeout: COMMAND_LINE_TIMEOUT_MS,
        });
  const line = result.status === 0 ? result.stdout.trim() : "";
  return line ? line : null;
}

const COMMAND_LINE_TIMEOUT_MS = 15_000;

/**
 * Whether the record's control channel answers with its token: proof that the recorded process is
 * a live FlowAId launcher (a reused pid cannot know the token), and fast on every platform.
 */
export async function controlAnswers(
  rec: InstanceRecord,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!rec.control?.url || !rec.control.token) return false;
  try {
    const res = await fetchImpl(`${rec.control.url}/status`, {
      headers: { authorization: `Bearer ${rec.control.token}` },
      signal: AbortSignal.timeout(3000),
    });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The running launcher the record names, if any: its control channel answers first, and only
 * when it does not (an older record, a launcher that is still starting) is the process's command
 * line read, which on Windows means a slow WMI query.
 */
export async function findRunningLauncher(
  rec: InstanceRecord | null,
  o: { fetch?: typeof fetch; cmd?: (pid: number) => string | null } = {},
): Promise<InstanceRecord | null> {
  if (!rec || !isAlive(rec.pid) || rec.pid === process.pid) return null;
  if (await controlAnswers(rec, o.fetch)) return rec;
  return runningLauncher(rec, o.cmd);
}

/** The launcher named by the record, when it is still running (not a process that reused its pid). */
export function runningLauncher(
  rec: InstanceRecord | null,
  cmd: (pid: number) => string | null = commandLine,
): InstanceRecord | null {
  if (!rec || !isAlive(rec.pid) || rec.pid === process.pid) return null;
  const line = cmd(rec.pid)?.replaceAll("\\", "/") ?? "";
  return line.includes("scripts/start.ts") ? rec : null;
}

/**
 * Ends what a previous launcher left running. Commands (their own process groups) go before the
 * guards that watched them. Returns the names of the processes it ended.
 */
export function endLeftovers(
  rec: InstanceRecord,
  o: {
    cmd?: (pid: number) => string | null;
    kill?: (pid: number) => void;
    alive?: (pid: number) => boolean;
  } = {},
): string[] {
  const cmd = o.cmd ?? commandLine;
  const kill = o.kill ?? killTree;
  const alive = o.alive ?? isAlive;
  const ended: string[] = [];
  const ordered = [
    ...rec.processes.filter((p) => !p.name.endsWith(" guard")),
    ...rec.processes.filter((p) => p.name.endsWith(" guard")),
  ];
  for (const p of ordered) {
    if (p.pid === process.pid || !alive(p.pid)) continue;
    const line = cmd(p.pid)?.replaceAll("\\", "/");
    if (!line?.includes(p.match.replaceAll("\\", "/"))) continue;
    kill(p.pid);
    ended.push(p.name);
  }
  return ended;
}
