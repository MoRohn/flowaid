/**
 * `ContainerSandbox` (`SANDBOX_MODE=container`, ARCHITECTURE.md §10.7): every run is a throwaway
 * container with no network, a read-only root, a small tmpfs, bounded memory and pids, all
 * capabilities dropped, no new privileges and an unprivileged user. It is the only host for `shell`.
 * Code runs in a Node image fed over stdin; the container has no bridges, so requests that need
 * network, tools or state belong in the isolated-vm executor.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  ForbiddenError,
  SandboxError,
  type JsonValue,
  type SandboxBridges,
  type SandboxExecutor,
  type SandboxLogLine,
  type SandboxRunRequest,
  type SandboxRunResult,
  type SandboxShellRequest,
  type SandboxShellResult,
} from "@flowaid/workflow-core";
import { SANDBOX_LIMITS } from "./limits.js";
import { ENTRY, transpile } from "./transpile.js";
import { validateOutput } from "./validate.js";

export interface ContainerSandboxOptions {
  /** container CLI (docker, podman or nerdctl); default "docker" */
  cli?: string;
  /** image for code runs; default node:24-alpine */
  nodeImage?: string;
  /** default image for shell scripts; default alpine:3.22 */
  shellImage?: string;
  /** images a shell request may name (the defaults are always allowed) */
  allowedImages?: readonly string[];
  /** e.g. "runsc" for gVisor */
  runtime?: string;
  pidsLimit?: number;
}

/** The `docker run` arguments for one throwaway container. */
export function containerArgs(
  o: {
    name: string;
    image: string;
    memoryMb: number;
    pidsLimit: number;
    runtime?: string;
    env?: Record<string, string>;
  },
  command: readonly string[],
): string[] {
  const args = [
    "run",
    "--rm",
    "-i",
    "--name",
    o.name,
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "--memory",
    `${o.memoryMb}m`,
    "--memory-swap",
    `${o.memoryMb}m`,
    "--pids-limit",
    String(o.pidsLimit),
    "--cpus",
    "1",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--user",
    "65534:65534",
    "--workdir",
    "/tmp",
  ];
  if (o.runtime) args.push("--runtime", o.runtime);
  for (const [k, v] of Object.entries(o.env ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k))
      throw new ForbiddenError(`invalid environment variable name ${k}`);
    args.push("--env", `${k}=${v}`);
  }
  args.push(o.image, ...command);
  return args;
}

/** Runs inside the node image: reads { code, inputs } on stdin, prints one JSON line on stdout. */
const NODE_RUNNER = `
const chunks = []; process.stdin.on("data", (c) => chunks.push(c)); process.stdin.on("end", async () => {
  const { code, inputs } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const logs = []; const fmt = (a) => a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ");
  for (const level of ["log", "info", "debug", "warn", "error"]) console[level] = (...a) => { if (logs.length < ${SANDBOX_LIMITS.logLines}) logs.push({ level: level === "log" ? "info" : level, message: fmt(a).slice(0, ${SANDBOX_LIMITS.logLineBytes}) }); };
  try {
    const main = new Function(code + "\\nreturn ${ENTRY};")();
    const output = await main(inputs);
    process.stdout.write(JSON.stringify({ ok: true, output: output === undefined ? null : output, logs }) + "\\n");
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: String(e && e.message || e), logs }) + "\\n");
  }
});`;

interface Exec {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
}

export class ContainerSandbox implements SandboxExecutor {
  readonly kind = "container" as const;
  constructor(private readonly o: ContainerSandboxOptions = {}) {}

  private exec(
    args: string[],
    name: string,
    stdin: string,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<Exec> {
    const cli = this.o.cli ?? "docker";
    return new Promise((resolve, reject) => {
      const child = spawn(cli, args, { stdio: ["pipe", "pipe", "pipe"], shell: false });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let outBytes = 0;
      let errBytes = 0;
      let timedOut = false;
      let cancelled = false;
      const kill = () =>
        spawn(cli, ["kill", name], { stdio: "ignore" }).on("error", () => undefined);
      const timer = setTimeout(
        () => {
          timedOut = true;
          kill();
        },
        Math.min(timeoutMs, SANDBOX_LIMITS.maxWallClockMs),
      );
      const onAbort = () => {
        cancelled = true;
        kill();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (c: Buffer) => {
        if ((outBytes += c.byteLength) <= SANDBOX_LIMITS.streamBytes) out.push(c);
      });
      child.stderr.on("data", (c: Buffer) => {
        if ((errBytes += c.byteLength) <= SANDBOX_LIMITS.streamBytes) err.push(c);
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new SandboxError(`SANDBOX_UNAVAILABLE: cannot start ${cli}: ${e.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve({
          exitCode: code ?? -1,
          stdout: Buffer.concat(out).toString("utf8"),
          stderr: Buffer.concat(err).toString("utf8"),
          timedOut,
          cancelled,
        });
      });
      child.stdin.end(stdin);
    });
  }

  async run(req: SandboxRunRequest, bridges: SandboxBridges): Promise<SandboxRunResult> {
    if (req.allowNetwork || req.tools.length > 0)
      throw new SandboxError(
        "the container sandbox has no network or tool bridges; use the isolated-vm executor for code that needs them",
      );
    const started = performance.now();
    const code = await transpile(req.code, req.language);
    const stdin = JSON.stringify({ code, inputs: req.inputs });
    if (Buffer.byteLength(stdin) > SANDBOX_LIMITS.bridgeBytes)
      throw new SandboxError(`inputs are larger than ${SANDBOX_LIMITS.bridgeBytes} bytes`);
    const name = `flowaid-code-${randomUUID()}`;
    const memoryMb = req.memoryMb ?? SANDBOX_LIMITS.memoryMb;
    const args = containerArgs(
      {
        name,
        image: this.o.nodeImage ?? "node:24-alpine",
        memoryMb,
        pidsLimit: this.o.pidsLimit ?? 64,
        ...(this.o.runtime ? { runtime: this.o.runtime } : {}),
      },
      ["node", "--max-old-space-size=" + String(Math.max(16, memoryMb - 32)), "-e", NODE_RUNNER],
    );
    const r = await this.exec(args, name, stdin, req.timeoutMs, bridges.signal);
    if (r.timedOut)
      throw new SandboxError(
        `the code exceeded its ${Math.min(req.timeoutMs, SANDBOX_LIMITS.maxWallClockMs)} ms wall-clock deadline`,
      );
    if (r.cancelled) throw new SandboxError("the run was cancelled");
    const line = r.stdout.trim().split("\n").pop() ?? "";
    let parsed: { ok: boolean; output?: JsonValue; error?: string; logs?: SandboxLogLine[] };
    try {
      parsed = JSON.parse(line) as typeof parsed;
    } catch {
      throw new SandboxError(
        r.exitCode === 137
          ? `the code exceeded its ${memoryMb} MiB memory limit`
          : `the container failed (exit ${r.exitCode}): ${r.stderr.slice(0, 1000)}`,
      );
    }
    if (!parsed.ok)
      throw new SandboxError(`the code threw: ${parsed.error ?? "unknown error"}`, {
        logs: (parsed.logs ?? []) as unknown as JsonValue,
      });
    const output = parsed.output ?? null;
    validateOutput(req.outputSchema, output);
    return { output, logs: parsed.logs ?? [], durationMs: Math.round(performance.now() - started) };
  }

  async shell(req: SandboxShellRequest, signal: AbortSignal): Promise<SandboxShellResult> {
    const started = performance.now();
    const image = req.image ?? this.o.shellImage ?? "alpine:3.22";
    const allowed = new Set([
      this.o.shellImage ?? "alpine:3.22",
      this.o.nodeImage ?? "node:24-alpine",
      ...(this.o.allowedImages ?? []),
    ]);
    if (!allowed.has(image))
      throw new ForbiddenError(`image ${image} is not allowed for shell scripts`);
    const name = `flowaid-shell-${randomUUID()}`;
    const args = containerArgs(
      {
        name,
        image,
        memoryMb: req.memoryMb ?? SANDBOX_LIMITS.memoryMb,
        pidsLimit: this.o.pidsLimit ?? 64,
        ...(this.o.runtime ? { runtime: this.o.runtime } : {}),
        ...(req.env ? { env: req.env } : {}),
      },
      ["sh", "-c", req.script],
    );
    const r = await this.exec(args, name, req.stdin ?? "", req.timeoutMs, signal);
    if (r.timedOut)
      throw new SandboxError(
        `the script exceeded its ${Math.min(req.timeoutMs, SANDBOX_LIMITS.maxWallClockMs)} ms wall-clock deadline`,
      );
    if (r.cancelled) throw new SandboxError("the run was cancelled");
    return {
      exitCode: r.exitCode,
      stdout: r.stdout,
      stderr: r.stderr,
      durationMs: Math.round(performance.now() - started),
    };
  }
}

/** True when the container CLI answers (used to skip container tests on machines without one). */
export function containerRuntimeAvailable(cli = "docker"): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cli, ["info", "--format", "{{.ServerVersion}}"], { stdio: "ignore" });
    const t = setTimeout(() => (child.kill(), resolve(false)), 5000);
    child.on("error", () => (clearTimeout(t), resolve(false)));
    child.on("close", (code) => (clearTimeout(t), resolve(code === 0)));
  });
}
