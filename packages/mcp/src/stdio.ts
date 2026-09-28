/**
 * stdio MCP servers (ARCHITECTURE.md §10.2): worker-only, off unless enabled, and only for commands
 * on the operator's absolute-path allow-list. The child gets a scrubbed environment, a fresh temp
 * working directory and its own process group, which is killed on close, timeout or cancel.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { ForbiddenError } from "@flowaid/workflow-core";

export interface StdioCommandRule {
  /** Absolute path of the executable. */
  readonly command: string;
  /** Regex source the space-joined arguments must match; absent means any arguments. */
  readonly argsPattern?: string;
}

export interface StdioPolicy {
  /** `MCP_STDIO_ENABLED` */
  enabled: boolean;
  /** `FLOWAID_MCP_STDIO_ALLOWED_COMMANDS` (empty = none) */
  allowedCommands: readonly StdioCommandRule[];
  /** `FLOWAID_MCP_STDIO_ENV_ALLOWLIST`: names the child may inherit from `parentEnv` or the request. */
  envAllowlist: readonly string[];
  /** The worker's environment values for the allow-listed names. */
  parentEnv?: Readonly<Record<string, string | undefined>>;
}

export interface StdioServerConfig {
  command: string;
  args?: readonly string[];
  /** Requested environment; only allow-listed names pass. */
  env?: Readonly<Record<string, string>>;
}

export interface StdioSpawnPlan {
  command: string;
  args: string[];
  env: Record<string, string>;
}

const SHELL_META = /[;&|`$<>(){}[\]!*?~\\'"\n\r\t\0]/;
const ARG_META = /[;&|`$<>\n\r\0]|\$\(|`/;
/** Flags that turn an interpreter or package runner into "run this string / fetch this package". */
const DANGEROUS_FLAGS = new Set([
  "-e",
  "--eval",
  "-p",
  "--print",
  "-r",
  "--require",
  "--import",
  "--loader",
  "--experimental-loader",
  "-c",
  "--command",
  "-y",
  "--yes",
  "--allow-all",
  "-A",
  "--unsafely-ignore-certificate-errors",
  "--inspect",
  "--inspect-brk",
  "--remote-debugging-port",
]);
const SHELLS = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "csh",
  "tcsh",
  "cmd",
  "cmd.exe",
  "powershell",
  "pwsh",
]);
const PACKAGE_RUNNERS = new Set(["npx", "pnpx", "bunx", "uvx", "pipx"]);
/** Environment names that change how any process loads code. */
const DANGEROUS_ENV =
  /^(?:LD_|DYLD_)|^(?:NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|PYTHONPATH|PYTHONSTARTUP|PYTHONHOME|PYTHONUSERBASE|PERL5OPT|PERL5LIB|RUBYOPT|RUBYLIB|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS|CLASSPATH|DOTNET_STARTUP_HOOKS|BASH_ENV|ENV|PROMPT_COMMAND|IFS|GCONV_PATH)$/;
/**
 * Names the process environment already means something by: where binaries, home and temp
 * files are, locale, trust stores and proxies. A credential field never sets one.
 */
const SYSTEM_ENV =
  /^(?:LC_|XDG_)|^(?:PATH|HOME|USER|LOGNAME|SHELL|PWD|OLDPWD|TMPDIR|TMP|TEMP|LANG|LANGUAGE|TZ|TERM|SSL_CERT_FILE|SSL_CERT_DIR|REQUESTS_CA_BUNDLE|CURL_CA_BUNDLE|HTTP_PROXY|HTTPS_PROXY|NO_PROXY|ALL_PROXY)$/;

export class StdioPolicyError extends ForbiddenError {}

const basename = (p: string) => p.split("/").pop() ?? p;

/**
 * Second line of defence after the allow-list: rejects shell metacharacters, shells, package
 * runners, code-evaluating flags (including `--flag=value` forms) and loader environment names.
 */
export function validateStdioConfig(config: StdioServerConfig): void {
  const { command } = config;
  const args = config.args ?? [];
  if (!command.startsWith("/") || command.includes(".."))
    throw new StdioPolicyError(`stdio command must be an absolute path: ${command}`);
  if (SHELL_META.test(command))
    throw new StdioPolicyError("stdio command contains shell metacharacters");
  const name = basename(command).toLowerCase();
  if (SHELLS.has(name)) throw new StdioPolicyError(`shells cannot be stdio servers (${name})`);
  if (PACKAGE_RUNNERS.has(name))
    throw new StdioPolicyError(
      `package runners cannot be stdio servers (${name}); install the server and allow its binary`,
    );
  for (const arg of args) {
    if (ARG_META.test(arg))
      throw new StdioPolicyError(
        `stdio argument contains shell metacharacters: ${JSON.stringify(arg)}`,
      );
    const flag = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (DANGEROUS_FLAGS.has(flag) || /^--inspect(?:-|=|$)/.test(flag))
      throw new StdioPolicyError(`stdio argument ${flag} is not allowed`);
  }
  if (
    args[0] &&
    ["exec", "dlx", "x"].includes(args[0]) &&
    ["npm", "pnpm", "yarn", "bun"].includes(name)
  )
    throw new StdioPolicyError(`${name} ${args[0]} cannot start a stdio server`);
  for (const key of Object.keys(config.env ?? {}))
    if (DANGEROUS_ENV.test(key))
      throw new StdioPolicyError(`environment variable ${key} is not allowed`);
}

/** Applies the policy and returns exactly what will be spawned, or throws `StdioPolicyError`. */
export function planStdioSpawn(
  policy: StdioPolicy,
  config: StdioServerConfig,
  credentialFields: Readonly<Record<string, string>> = {},
): StdioSpawnPlan {
  if (!policy.enabled)
    throw new StdioPolicyError("stdio MCP servers are disabled (MCP_STDIO_ENABLED=false)");
  const rule = policy.allowedCommands.find((r) => r.command === config.command);
  if (!rule)
    throw new StdioPolicyError(`${config.command} is not in FLOWAID_MCP_STDIO_ALLOWED_COMMANDS`);
  const args = [...(config.args ?? [])];
  if (
    rule.argsPattern !== undefined &&
    !new RegExp(`^(?:${rule.argsPattern})$`).test(args.join(" "))
  )
    throw new StdioPolicyError(
      `the arguments do not match the allowed pattern for ${config.command}`,
    );
  validateStdioConfig(config);
  const allowed = new Set(policy.envAllowlist);
  const env: Record<string, string> = {};
  for (const name of allowed) {
    const v = config.env?.[name] ?? policy.parentEnv?.[name];
    if (v !== undefined) env[name] = v;
  }
  // The bound credential's fields reach the child as environment variables (upper-cased names),
  // never as a loader, system or allow-listed variable (`path` would otherwise replace PATH).
  for (const [k, v] of Object.entries(credentialFields)) {
    const name = k.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
    if (DANGEROUS_ENV.test(name) || SYSTEM_ENV.test(name) || allowed.has(name))
      throw new StdioPolicyError(
        `credential field ${k} would set the environment variable ${name}; rename the field`,
      );
    env[name] = v;
  }
  return { command: config.command, args, env };
}

export interface StdioTransportOptions {
  signal?: AbortSignal;
  /** Audit hook (`mcp_server.stdio_spawn`); receives names only, never values. */
  onSpawn?: (info: {
    command: string;
    args: string[];
    envNames: string[];
    pid: number | undefined;
  }) => void;
  /** Bytes of stderr kept for diagnostics (default 1 MiB). */
  stderrLimit?: number;
  /** Grace period between SIGTERM and SIGKILL on close (default 2 s). */
  killGraceMs?: number;
}

/** MCP transport over a policy-checked child process in its own process group. */
export class PolicyStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private child?: ChildProcess;
  private cwd?: string;
  private readonly buffer = new ReadBuffer();
  private stderrChunks: Buffer[] = [];
  private stderrBytes = 0;
  private closed = false;

  constructor(
    private readonly plan: StdioSpawnPlan,
    private readonly opts: StdioTransportOptions = {},
  ) {}

  /** The last `stderrLimit` bytes the server wrote to stderr. */
  get stderr(): string {
    return Buffer.concat(this.stderrChunks).toString("utf8");
  }

  start(): Promise<void> {
    if (this.child) throw new Error("PolicyStdioTransport already started");
    this.cwd = mkdtempSync(join(tmpdir(), "flowaid-mcp-"));
    return new Promise((resolve, reject) => {
      const child = spawn(this.plan.command, this.plan.args, {
        cwd: this.cwd,
        env: this.plan.env,
        shell: false,
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      this.child = child;
      const limit = this.opts.stderrLimit ?? 1024 * 1024;
      child.once("error", (error) => {
        reject(error);
        this.onerror?.(error);
        void this.close();
      });
      child.once("spawn", () => {
        this.opts.onSpawn?.({
          command: this.plan.command,
          args: this.plan.args,
          envNames: Object.keys(this.plan.env),
          pid: child.pid,
        });
        resolve();
      });
      child.once("close", () => void this.close());
      child.stdout?.on("data", (chunk: Buffer) => {
        this.buffer.append(chunk);
        for (;;) {
          let message: JSONRPCMessage | null;
          try {
            message = this.buffer.readMessage();
          } catch (error) {
            this.onerror?.(error as Error);
            continue;
          }
          if (message === null) break;
          this.onmessage?.(message);
        }
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        this.stderrChunks.push(chunk);
        this.stderrBytes += chunk.byteLength;
        while (this.stderrBytes > limit && this.stderrChunks.length > 1)
          this.stderrBytes -= this.stderrChunks.shift()?.byteLength ?? 0;
      });
      this.opts.signal?.addEventListener("abort", () => void this.close(), { once: true });
    });
  }

  send(message: JSONRPCMessage): Promise<void> {
    const stdin = this.child?.stdin;
    if (!stdin || this.closed) return Promise.reject(new Error("stdio transport is not connected"));
    return new Promise((resolve, reject) => {
      stdin.write(serializeMessage(message), (error) => (error ? reject(error) : resolve()));
    });
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    const child = this.child;
    if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      killGroup(child.pid, "SIGTERM");
      const t = setTimeout(
        () => killGroup(child.pid ?? 0, "SIGKILL"),
        this.opts.killGraceMs ?? 2000,
      );
      t.unref();
      child.once("exit", () => clearTimeout(t));
    }
    if (this.cwd) rmSync(this.cwd, { recursive: true, force: true });
    this.buffer.clear();
    this.onclose?.();
    return Promise.resolve();
  }
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  if (pid <= 0) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}
