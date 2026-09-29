/**
 * Keeps one process that `./flowaid` starts (the API, the worker, the web app, PageIndex,
 * FlowAId's window) tied to the launcher, so nothing outlives it:
 *
 *   node scripts/guard.ts [--ipc] [--grace-ms <n>] -- <command> [args…]
 *
 * - The command runs in a process tree the guard owns: its own process group on macOS and Linux;
 *   on Windows, the tree `taskkill /T` ends.
 * - The launcher writes `stop` on the guard's stdin for a graceful stop (SIGTERM to the group; on
 *   Windows, with `--ipc`, the message `flowaid:shutdown`, which the API and worker handle like
 *   SIGTERM), and `kill` to end the tree at once. After `--grace-ms` (default 30 s) a stop becomes
 *   a kill.
 * - When stdin closes without a word, the launcher is gone (closed terminal, crash, kill -9): the
 *   guard stops the tree the same way. Leftover processes are what this prevents.
 * - The guard reports the command's pid on fd 3 (`{"pid":123}`), for `.flowaid/launcher.json`,
 *   and exits with the command's exit code once the whole tree is gone.
 *
 * Runs on plain Node (native type stripping), like start.ts.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { writeSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export const SHUTDOWN_MESSAGE = "flowaid:shutdown";

export interface GuardOptions {
  command: string;
  args: string[];
  ipc: boolean;
  graceMs: number;
}

export function parseGuardArgs(argv: readonly string[]): GuardOptions {
  const sep = argv.indexOf("--");
  if (sep === -1 || sep === argv.length - 1)
    throw new Error("usage: guard.ts [--ipc] [--grace-ms <n>] -- <command> [args…]");
  const flags = argv.slice(0, sep);
  const graceAt = flags.indexOf("--grace-ms");
  const graceMs = graceAt === -1 ? 30_000 : Number(flags[graceAt + 1]);
  if (!Number.isInteger(graceMs) || graceMs < 0) throw new Error("--grace-ms must be an integer");
  return {
    command: argv[sep + 1] as string,
    args: argv.slice(sep + 2),
    ipc: flags.includes("--ipc"),
    graceMs,
  };
}

const WINDOWS = process.platform === "win32";

/** Ends a process and everything it started, at once. */
export function killTree(pid: number): void {
  if (WINDOWS) {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

function run(o: GuardOptions): void {
  const child: ChildProcess = spawn(o.command, o.args, {
    stdio: ["ignore", "inherit", "inherit", ...(o.ipc ? (["ipc"] as const) : [])],
    // a group of its own, so a stop reaches everything the command starts
    detached: !WINDOWS,
    // Windows runs .cmd files (next.cmd, tsx.cmd) through cmd.exe
    shell: WINDOWS && /\.(?:cmd|bat)$/i.test(o.command),
    windowsHide: true,
  });
  const pid = child.pid;
  if (pid === undefined) {
    child.once("error", (error) => {
      process.stderr.write(`could not start ${o.command}: ${error.message}\n`);
      process.exit(127);
    });
    return;
  }
  try {
    writeSync(3, `${JSON.stringify({ pid })}\n`);
  } catch {
    /* no fd 3: started by hand */
  }

  let stopping = false;
  let force: NodeJS.Timeout | null = null;
  const kill = () => killTree(pid);
  const stop = () => {
    if (stopping) return;
    stopping = true;
    if (WINDOWS) {
      if (o.ipc && child.connected) child.send(SHUTDOWN_MESSAGE);
      else kill();
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    force = setTimeout(kill, o.graceMs);
  };

  createInterface({ input: process.stdin })
    .on("line", (line) => {
      const word = line.trim();
      if (word === "stop") stop();
      else if (word === "kill") kill();
    })
    // the launcher is gone: nobody else will stop this tree
    .on("close", stop);
  // the launcher orchestrates: Ctrl+C reaches it (and, on Windows, the command itself)
  process.on("SIGINT", () => undefined);
  for (const signal of ["SIGTERM", "SIGHUP"] as const) process.on(signal, stop);

  child.once("exit", (code, signal) => {
    if (force) clearTimeout(force);
    // what the command started and left behind goes with it
    if (!WINDOWS) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        /* the group is empty */
      }
    }
    process.exit(code ?? (signal ? 1 : 0));
  });
}

const GUARD = fileURLToPath(import.meta.url);

export interface Guarded {
  /** the guard: exits once the command's whole tree is gone, with the command's exit code */
  readonly process: ChildProcess;
  /** the command's own pid, once it started */
  readonly pid: Promise<number | null>;
  /** graceful: SIGTERM to the tree (Windows: the IPC message, or taskkill) */
  stop(): void;
  /** at once */
  kill(): void;
}

/** Starts `command` under a guard (see the top of this file). */
export function spawnGuarded(
  command: string,
  args: readonly string[],
  o: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    ipc?: boolean;
    graceMs?: number;
    /** the command's output: piped (to prefix it) or dropped */
    output?: "pipe" | "ignore";
  } = {},
): Guarded {
  const out = o.output ?? "pipe";
  const guard = spawn(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      GUARD,
      ...(o.ipc ? ["--ipc"] : []),
      ...(o.graceMs !== undefined ? ["--grace-ms", String(o.graceMs)] : []),
      "--",
      command,
      ...args,
    ],
    { cwd: o.cwd, env: o.env, stdio: ["pipe", out, out, "pipe"], windowsHide: true },
  );
  const pid = new Promise<number | null>((resolvePid) => {
    const report = guard.stdio[3] as NodeJS.ReadableStream | null;
    if (!report) return resolvePid(null);
    let text = "";
    report.on("data", (chunk: Buffer) => {
      text += chunk.toString();
      const line = text.split("\n")[0];
      if (text.includes("\n")) {
        try {
          resolvePid((JSON.parse(line ?? "") as { pid: number }).pid);
        } catch {
          resolvePid(null);
        }
      }
    });
    report.on("end", () => resolvePid(null));
  });
  const say = (word: string) => {
    if (guard.stdin?.writable) guard.stdin.write(`${word}\n`);
  };
  guard.stdin?.on("error", () => undefined);
  return { process: guard, pid, stop: () => say("stop"), kill: () => say("kill") };
}

// run as a script (not imported by start.ts or a test); import.meta.main needs Node 24.2+
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run(parseGuardArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(2);
  }
}
