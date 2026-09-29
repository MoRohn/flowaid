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
          { encoding: "utf8", windowsHide: true },
        )
      : spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
  const line = result.status === 0 ? result.stdout.trim() : "";
  return line ? line : null;
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
