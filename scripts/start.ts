/**
 * `pnpm start`: one command from a fresh clone to a running FlowAId — database, API, worker and
 * web app — on this machine.
 *
 * 1. Preflight: Node.js, pnpm, dependencies, free ports, and Docker when no database is given.
 *    The app opens at http://flowaid.localhost:3000 (the API beside it on 3001); when another app
 *    holds a default port the next free one is used, while a port passed explicitly must be free.
 * 2. Installs dependencies when they are missing or older than pnpm-lock.yaml.
 * 3. Configuration: `.env` and `.env.local` (provider keys and overrides), plus local secrets
 *    generated once into `.flowaid/dev.env` (master key, owner password) and printed once.
 * 4. Database: DATABASE_URL when set, otherwise a pgvector Postgres container (`flowaid-dev-db`,
 *    loopback only, data in the `flowaid-dev-db` volume).
 * 5. Builds what the apps import, then starts the API, the worker and the web app with prefixed
 *    logs, waits for /v1/ready and prints where to sign in.
 * 6. On a desktop: opens FlowAId in its own window and shows its menu bar (tray) icon, whose menu
 *    opens the window again or quits (scripts/desktop.ts). The app's own Close window and Quit
 *    FlowAId reach this launcher through the API (scripts/control.ts). Ctrl+C also stops
 *    everything.
 *
 * `--prod` runs the production builds (Next's standalone server, compiled API and worker) instead of watch
 * mode; `--playground` serves the @flowaid/ui component playground instead of the stack.
 *
 * Runs on plain Node (native type stripping) so it works before `pnpm install`.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs, parseEnv } from "node:util";

import {
  DEFAULT_DOMAIN,
  DEFAULT_HOST,
  DEFAULT_PORT,
  ROOT,
  authModeForBind,
  checkPort,
  formatReport,
  hasFailures,
  isLoopbackBind,
  probe,
  runPreflight,
  useColor,
  type CheckResult,
} from "./preflight.ts";
import { startControl, platformName } from "./control.ts";
import {
  AppWindow,
  desktopAvailable,
  findAppBrowser,
  notify,
  openInDefaultBrowser,
  startTray,
  type Activity,
  type Tray,
} from "./desktop.ts";
import { spawnGuarded, type Guarded } from "./guard.ts";
import {
  endLeftovers,
  readInstance,
  removeInstance,
  runningLauncher,
  writeInstance,
  type InstanceProcess,
  type InstanceRecord,
} from "./instance.ts";
import { DEFAULT_API_PORT, DEFAULT_WEB_PORT } from "./ports.ts";

const HELP = `Usage: ./flowaid [options]   (or: pnpm start [options])

Start FlowAId locally: Postgres, the API, the worker and the web app.

Options
  --port <n>          Web app port, the one in the address (default ${DEFAULT_WEB_PORT}; when another
                      app holds it, the next free port is used)
  --api-port <n>      API port (default ${DEFAULT_API_PORT}; likewise)
  --host <address>    Interface to bind (default ${DEFAULT_HOST}; 0.0.0.0 exposes it on your network)
  --domain <name>     Name in the app's address (default ${DEFAULT_DOMAIN}; any *.localhost name
                      reaches this computer, as does 127.0.0.1)
  --database-url <u>  Use this Postgres instead of a Docker container (or set DATABASE_URL)
  --prod              Run production builds instead of watch mode
  --no-open           Don't open FlowAId's window once it is ready (it opens on a desktop, in an
                      app window of its own when Chrome, Edge, Brave or Chromium is installed)
  --no-tray           Don't show the menu bar (tray) icon that reopens the window or quits
  --verify            Run every CI gate (pnpm check) before starting
  --skip-install      Never install dependencies, even when they are missing or stale
  --pageindex         Also run the PageIndex service for PDF document indexes (needs Python 3.10+;
                      the first run installs its pinned packages into .flowaid/pageindex-venv)
  --pageindex-port <n> PageIndex service port (default 8765)
  --playground        Serve the @flowaid/ui component playground instead (port ${DEFAULT_PORT})
  -h, --help          Show this help

Provider keys (TYPESAFE_API_KEY, OPENAI_API_KEY, …) and any other setting from .env.example are
read from .env and .env.local. Generated local secrets live in .flowaid/dev.env.
`;

let parsed;
try {
  const argv = process.argv.slice(2);
  parsed = parseArgs({
    args: argv[0] === "--" ? argv.slice(1) : argv,
    options: {
      port: { type: "string" },
      "api-port": { type: "string" },
      host: { type: "string", default: DEFAULT_HOST },
      domain: { type: "string", default: DEFAULT_DOMAIN },
      "database-url": { type: "string" },
      prod: { type: "boolean", default: false },
      // unset: on a desktop (not CI, not over SSH); --open / --no-open decide
      open: { type: "boolean" },
      tray: { type: "boolean" },
      verify: { type: "boolean", default: false },
      "skip-install": { type: "boolean", default: false },
      playground: { type: "boolean", default: false },
      pageindex: { type: "boolean", default: false },
      "pageindex-port": { type: "string", default: "8765" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowNegative: true,
  });
} catch (error) {
  console.error(`${(error as Error).message}\n\n${HELP}`);
  process.exit(2);
}
const opts = parsed.values;
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}

function portOption(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65_535) {
    console.error(`${flag} must be an integer between 1 and 65535 (got ${value}).`);
    process.exit(2);
  }
  return n;
}
const host = opts.host;
const webRequested =
  opts.port !== undefined
    ? portOption(opts.port, "--port")
    : opts.playground
      ? DEFAULT_PORT
      : DEFAULT_WEB_PORT;
const apiRequested =
  opts["api-port"] !== undefined ? portOption(opts["api-port"], "--api-port") : DEFAULT_API_PORT;
if (
  !opts.playground &&
  opts.port !== undefined &&
  opts["api-port"] !== undefined &&
  webRequested === apiRequested
) {
  console.error(`--port and --api-port must differ (both are ${webRequested}).`);
  process.exit(2);
}
// Bound to loopback (or every interface), the app is addressed by its name: browsers and the OS
// resolve any *.localhost name to this computer (RFC 6761), so http://flowaid.localhost:3000
// needs no hosts-file entry. A specific interface address is used as given.
if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(opts.domain)) {
  console.error(`--domain: "${opts.domain}" is not a host name`);
  process.exit(2);
}
const loopbackBind = isLoopbackBind(host);
const exposed = !loopbackBind;
const browserHost = loopbackBind || host === "0.0.0.0" ? opts.domain : host;

const color = useColor();
const paint = (code: number, text: string) => (color ? `\u001b[${code}m${text}\u001b[0m` : text);
const ok = (text: string) => console.log(`${paint(32, "✓")} ${text}`);
const warn = (text: string) => console.log(`${paint(33, "!")} ${text}`);
const fail = (text: string): never => {
  console.error(`\n${paint(31, "✗")} ${text}`);
  process.exit(1);
};

const TOTAL = (opts.playground ? 4 : 6) + (opts.verify ? 1 : 0) + (opts.pageindex ? 1 : 0);
let step = 0;
const heading = (text: string) => {
  step += 1;
  console.log(`\n${paint(1, `[${step}/${TOTAL}] ${text}`)}`);
};

const WINDOWS = process.platform === "win32";

/**
 * A package's command as a script for this Node to run (`node …/next/dist/bin/next`), instead of
 * its node_modules/.bin shim: on Windows that shim is a .cmd file, which needs cmd.exe.
 */
const pkgBin = (dir: string, pkg: string, entry: string) =>
  join(ROOT, dir, "node_modules", pkg, entry);

/** An argument as cmd.exe must see it: quoted when it has spaces (C:\Users\Jane Doe\…). */
const cmdArg = (a: string) => (/[\s"]/.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a);

function run(command: string, args: readonly string[], env?: NodeJS.ProcessEnv): Promise<number> {
  // Windows finds pnpm, py and friends (.cmd, .exe) through a shell; a full path runs directly
  const shell = WINDOWS && !/[\\/]/.test(command);
  return new Promise((resolve) => {
    const child = spawn(command, shell ? args.map(cmdArg) : args, {
      cwd: ROOT,
      stdio: "inherit",
      shell,
      ...(env ? { env } : {}),
    });
    child.once("error", () => resolve(127));
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function mustRun(label: string, command: string, args: readonly string[]): Promise<void> {
  const started = performance.now();
  const code = await run(command, args);
  if (code !== 0) fail(`${label} failed (exit ${code}). Run pnpm preflight for help.`);
  ok(`${label} (${((performance.now() - started) / 1000).toFixed(1)} s)`);
}

// ─── configuration ───────────────────────────────────────────────────────────────────────────

function readEnvFile(path: string): Record<string, string> {
  return existsSync(path) ? (parseEnv(readFileSync(path, "utf8")) as Record<string, string>) : {};
}

/** Local secrets, generated once and kept in .flowaid/dev.env (gitignored). */
function localSecrets(): { values: Record<string, string>; created: boolean } {
  const dir = join(ROOT, ".flowaid");
  const file = join(dir, "dev.env");
  if (existsSync(file)) return { values: readEnvFile(file), created: false };
  mkdirSync(dir, { recursive: true });
  const values = {
    FLOWAID_MASTER_KEY: randomBytes(32).toString("base64"),
    FLOWAID_ADMIN_EMAIL: "owner@flowaid.local",
    FLOWAID_ADMIN_PASSWORD: `${randomBytes(12).toString("base64url")}-Aa9`,
    FLOWAID_DEV_DB_PASSWORD: randomBytes(16).toString("hex"),
  };
  const body = Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  writeFileSync(
    file,
    `# Generated by pnpm start for this checkout. Keep it: the master key encrypts every credential.\n${body}\n`,
    { mode: 0o600 },
  );
  return { values, created: true };
}

// ─── PageIndex ───────────────────────────────────────────────────────────────────────────────

const PAGEINDEX_DIR = join(ROOT, "apps/pageindex");

/**
 * A Python 3.10+ interpreter, as a command and its leading arguments: FLOWAID_PYTHON, else the
 * newest python3.x on PATH, or on Windows the `py` launcher and `python`.
 */
function findPython(): string[] | null {
  const candidates: string[][] = [
    ...(process.env.FLOWAID_PYTHON ? [[process.env.FLOWAID_PYTHON]] : []),
    ...(WINDOWS
      ? [["py", "-3"], ["python"], ["python3"]]
      : [["python3.13"], ["python3.12"], ["python3.11"], ["python3.10"], ["python3"]]),
  ];
  return (
    candidates.find(
      ([cmd, ...pre]) =>
        spawnSync(
          cmd as string,
          [...pre, "-c", "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"],
          { windowsHide: true },
        ).status === 0,
    ) ?? null
  );
}

/**
 * The service's virtualenv in .flowaid/pageindex-venv, (re)installed from the hash-locked
 * requirements when they change. Returns its python.
 */
async function ensurePageIndexVenv(): Promise<string> {
  const venv = join(ROOT, ".flowaid/pageindex-venv");
  const python = join(venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const lock = readFileSync(join(PAGEINDEX_DIR, "requirements.lock"));
  const stamp = join(venv, ".requirements.sha256");
  const want = createHash("sha256").update(lock).digest("hex");
  if (existsSync(python) && existsSync(stamp) && readFileSync(stamp, "utf8") === want) {
    ok("PageIndex packages up to date");
    return python;
  }
  const base = findPython();
  if (!base)
    return fail(
      WINDOWS
        ? "--pageindex needs Python 3.10 or newer (install it from python.org, which adds the py launcher, or set FLOWAID_PYTHON)"
        : "--pageindex needs Python 3.10 or newer (python3.10 … python3.13 on PATH, or set FLOWAID_PYTHON)",
    );
  const [pythonCmd, ...pythonPre] = base as [string, ...string[]];
  await mustRun("PageIndex virtualenv created", pythonCmd, [
    ...pythonPre,
    "-m",
    "venv",
    "--clear",
    venv,
  ]);
  await mustRun("PageIndex packages installed (pinned, hash-checked)", python, [
    "-m",
    "pip",
    "install",
    "--quiet",
    "--require-hashes",
    "--only-binary=:all:",
    "-r",
    join(PAGEINDEX_DIR, "requirements.lock"),
  ]);
  writeFileSync(stamp, want);
  return python;
}

/** The shared token, generated once into .flowaid/dev.env. */
function pageIndexToken(secrets: Record<string, string>): string {
  const existing = secrets.FLOWAID_PAGEINDEX_TOKEN;
  if (existing) return existing;
  const token = randomBytes(32).toString("hex");
  appendFileSync(join(ROOT, ".flowaid", "dev.env"), `FLOWAID_PAGEINDEX_TOKEN=${token}\n`);
  secrets.FLOWAID_PAGEINDEX_TOKEN = token;
  return token;
}

// ─── database ────────────────────────────────────────────────────────────────────────────────

const DB_CONTAINER = "flowaid-dev-db";
const DB_PORT = 54329;
// the same image compose pins (docker/compose.yml), with its digest
const DB_IMAGE =
  "pgvector/pgvector:0.8.6-pg16@sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b";

async function ensureDockerDatabase(password: string): Promise<string> {
  const state = probe("docker", ["inspect", "-f", "{{.State.Running}}", DB_CONTAINER]);
  if (state === null) {
    const created = spawnSync(
      "docker",
      [
        "run",
        "-d",
        "--name",
        DB_CONTAINER,
        "-e",
        "POSTGRES_USER=flowaid",
        "-e",
        `POSTGRES_PASSWORD=${password}`,
        "-e",
        "POSTGRES_DB=flowaid",
        "-p",
        `127.0.0.1:${DB_PORT}:5432`,
        "-v",
        "flowaid-dev-db:/var/lib/postgresql/data",
        DB_IMAGE,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    if (created.status !== 0)
      fail(`could not start Postgres in Docker: ${created.stderr.toString().trim()}`);
    ok(`started Postgres (${DB_CONTAINER}, 127.0.0.1:${DB_PORT})`);
  } else if (state !== "true") {
    if (spawnSync("docker", ["start", DB_CONTAINER], { stdio: "ignore" }).status !== 0)
      fail(`could not start the ${DB_CONTAINER} container`);
    ok(`restarted Postgres (${DB_CONTAINER})`);
  } else ok(`Postgres already running (${DB_CONTAINER})`);
  for (let i = 0; i < 60; i++) {
    const ready = spawnSync(
      "docker",
      ["exec", DB_CONTAINER, "pg_isready", "-U", "flowaid", "-d", "flowaid"],
      {
        stdio: "ignore",
      },
    );
    if (ready.status === 0) return `postgres://flowaid:${password}@127.0.0.1:${DB_PORT}/flowaid`;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return fail("Postgres did not become ready within a minute");
}

// ─── processes ───────────────────────────────────────────────────────────────────────────────

/** each process runs under a guard (scripts/guard.ts), which ends its tree with the launcher */
const guards: Guarded[] = [];
let stopping = false;
/** run before the processes stop: close the app window, remove the icon, stop the control channel */
const cleanups: (() => void)[] = [];

// .flowaid/launcher.json: this launcher and what it started (scripts/instance.ts)
const INSTANCE = join(ROOT, ".flowaid/launcher.json");
let instance: InstanceRecord | null = null;
function recordProcess(p: InstanceProcess): void {
  if (!instance || stopping) return;
  instance.processes.push(p);
  writeInstance(INSTANCE, instance);
}

function start(
  name: string,
  code: number,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  /** ipc: stop gracefully on Windows with the flowaid:shutdown message (the API and worker) */
  o: { ipc?: boolean } = {},
) {
  const g = spawnGuarded(command, args, { cwd, env, ipc: o.ipc === true && WINDOWS });
  const tag = paint(code, name.padEnd(6));
  const pipe = (stream: NodeJS.ReadableStream, out: NodeJS.WriteStream) => {
    let rest = "";
    stream.on("data", (chunk: Buffer) => {
      const lines = (rest + chunk.toString()).split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) out.write(`${tag} ${line}\n`);
    });
  };
  if (g.process.stdout) pipe(g.process.stdout, process.stdout);
  if (g.process.stderr) pipe(g.process.stderr, process.stderr);
  g.process.once("exit", (exitCode) => {
    if (stopping) return;
    console.error(
      `\n${paint(31, "✗")} ${name} exited (${exitCode ?? "signal"}); stopping the others.`,
    );
    shutdown(exitCode ?? 1);
  });
  guards.push(g);
  if (g.process.pid !== undefined)
    recordProcess({ name: `${name} guard`, pid: g.process.pid, match: "scripts/guard.ts" });
  // its own command line names its entry point (src/main.ts, dist/main.js, server.js, …)
  const match = args.find((a) => /(?:\.m?[jt]s|flowaid_pageindex)$/.test(a)) ?? command;
  void g.pid.then((pid) => {
    if (pid !== null) recordProcess({ name, pid, match });
  });
  return g;
}

function finish(code: number): never {
  if (instance) removeInstance(INSTANCE);
  process.exit(code);
}

function shutdown(code = 0) {
  if (stopping) {
    // a second Ctrl+C: don't wait for running steps to finish, but leave nothing behind
    for (const g of guards) g.kill();
    setTimeout(() => finish(code), 5000).unref();
    return;
  }
  stopping = true;
  for (const cleanup of cleanups.splice(0))
    try {
      cleanup();
    } catch {
      /* stopping anyway */
    }
  for (const g of guards) g.stop();
  // the worker lets running node executions finish for up to 30 s
  setTimeout(() => {
    for (const g of guards) g.kill();
  }, 32_000).unref();
  setTimeout(() => finish(code), 40_000).unref();
  let left = guards.filter((g) => g.process.exitCode === null).length;
  if (left === 0) finish(code);
  for (const g of guards)
    g.process.once("exit", () => {
      left -= 1;
      if (left <= 0) finish(code);
    });
}
// Ctrl+C, a kill, the terminal closing (SIGHUP; on Windows also the console window closing),
// and Ctrl+Break on Windows all stop FlowAId the same way
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", ...(WINDOWS ? ["SIGBREAK"] : [])] as const)
  process.on(signal as NodeJS.Signals, () => shutdown(0));

async function waitFor(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !stopping) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// ─── main ────────────────────────────────────────────────────────────────────────────────────

console.log(
  `\n${paint(1, "FlowAId")} · ${opts.playground ? "UI playground" : `local stack${opts.prod ? " (production builds)" : ""}`}`,
);

// One FlowAId per checkout: open the running one's window, or end what a crashed run left behind
if (!opts.playground) {
  const previous = readInstance(INSTANCE);
  const running = runningLauncher(previous);
  if (running) {
    console.log(`\n${paint(32, "→")} FlowAId is already running at ${paint(1, running.webUrl)}`);
    if (opts.open !== false) {
      try {
        const res = await fetch(`${running.control.url}/window/open`, {
          method: "POST",
          headers: { authorization: `Bearer ${running.control.token}` },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) ok("opened its window");
      } catch {
        warn(`its launcher (pid ${running.pid}) did not answer; open the address yourself`);
      }
    }
    console.log("  Quit it from its menu bar icon or in the app, then start it again.\n");
    process.exit(0);
  }
  if (previous) {
    const ended = endLeftovers(previous);
    if (ended.length > 0) warn(`stopped what an earlier FlowAId left running: ${ended.join(", ")}`);
    removeInstance(INSTANCE);
  }
}

heading("Preflight");
const fileEnv = { ...readEnvFile(join(ROOT, ".env")), ...readEnvFile(join(ROOT, ".env.local")) };
const databaseUrl = opts["database-url"] ?? process.env.DATABASE_URL ?? fileEnv.DATABASE_URL;
// a default port another app holds moves to the next free one; an explicit port must be free
const webCheck = await checkPort(host, webRequested, {
  name: opts.playground ? "Playground port" : "Web port",
  explicit: opts.port !== undefined,
  avoid: opts.playground || opts.port !== undefined ? [] : [apiRequested],
});
const apiCheck = opts.playground
  ? null
  : await checkPort(host, apiRequested, {
      name: "API port",
      flag: "--api-port",
      explicit: opts["api-port"] !== undefined,
      avoid: [webCheck.port],
    });
const webPort = webCheck.port;
const apiPort = apiCheck?.port ?? apiRequested;
const results: CheckResult[] = runPreflight({
  ports: apiCheck ? [webCheck, apiCheck] : [webCheck],
});
if (!opts.playground) {
  if (databaseUrl) {
    const i = results.findIndex((r) => r.name === "Docker");
    if (i >= 0) results[i] = { name: "Database", status: "ok", detail: "using DATABASE_URL" };
  } else if (probe("docker", ["info", "--format", "{{.ServerVersion}}"]) === null) {
    results.push({
      name: "Database",
      status: "fail",
      detail: "no DATABASE_URL and the Docker daemon is not running",
      fix: "start Docker Desktop, or pass --database-url postgres://… (Postgres 16 with pgvector)",
    });
  }
}
console.log(formatReport(results, color));
if (hasFailures(results)) fail("Fix the items marked ✗ and run pnpm start again.");
if (webPort !== webRequested)
  warn(
    `port ${webRequested} is in use (another app); FlowAId is on http://${browserHost}:${webPort} instead`,
  );
if (apiCheck && apiPort !== apiRequested)
  warn(`port ${apiRequested} is in use (another app); the API is on port ${apiPort} instead`);

heading("Dependencies");
const deps = results.find((r) => r.name === "Dependencies");
if (deps?.status === "ok") ok("already installed");
else if (opts["skip-install"]) warn(`${deps?.detail ?? "unknown"}; skipped (--skip-install)`);
else await mustRun("pnpm install", "pnpm", ["install", "--frozen-lockfile"]);

if (opts.verify) {
  heading("Verify (every CI gate)");
  await mustRun("pnpm check", "pnpm", ["check"]);
}

if (opts.playground) {
  heading("Build workspace packages");
  await mustRun("Workspace packages built", "pnpm", [
    "turbo",
    "run",
    "build",
    "--filter=@flowaid/ui^...",
    "--output-logs=errors-only",
  ]);
  if (opts.prod)
    await mustRun("Playground production build", "pnpm", [
      "--filter",
      "@flowaid/ui",
      "build:playground",
    ]);
  heading(opts.prod ? "Serve the production build" : "Start the dev server");
  const UI_DIR = join(ROOT, "packages/ui");
  const url = `http://${browserHost}:${webPort}`;
  console.log(`${paint(32, "→")} ${paint(1, url)}   (Ctrl+C to stop)\n`);
  start(
    "ui",
    36,
    process.execPath,
    [
      pkgBin("packages/ui", "vite", "bin/vite.js"),
      ...(opts.prod ? ["preview"] : []),
      "--config",
      "playground/vite.config.ts",
      "--host",
      host,
      "--port",
      String(webPort),
      "--strictPort",
      ...(opts.open === true ? ["--open"] : []),
    ],
    UI_DIR,
    process.env,
  );
} else {
  heading("Configuration");
  const secrets = localSecrets();
  ok(
    secrets.created
      ? "generated local secrets in .flowaid/dev.env"
      : "local secrets from .flowaid/dev.env",
  );
  // never local mode (no sign-in) where other computers can connect
  const bindAuth = authModeForBind(
    host,
    secrets.values.FLOWAID_AUTH_MODE ?? fileEnv.FLOWAID_AUTH_MODE ?? process.env.FLOWAID_AUTH_MODE,
  );
  if ("error" in bindAuth) fail(bindAuth.error);
  else if (bindAuth.forced)
    warn(`--host ${host} is reachable from your network: every browser signs in (password mode)`);
  const providers = [
    "TYPESAFE_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "OLLAMA_HOST",
  ].filter((k) => fileEnv[k] ?? process.env[k]);
  if (providers.length) ok(`provider keys: ${providers.join(", ")}`);
  else
    warn(
      "no provider keys in .env: decision and generation nodes need TYPESAFE_API_KEY (and OPENAI/ANTHROPIC for generation)",
    );

  heading("Database");
  const dbUrl =
    databaseUrl ??
    (await ensureDockerDatabase(secrets.values.FLOWAID_DEV_DB_PASSWORD ?? "flowaid"));
  if (databaseUrl) ok("using DATABASE_URL");

  heading("Build");
  await mustRun(opts.prod ? "API, worker and web built" : "Workspace packages built", "pnpm", [
    "turbo",
    "run",
    "build",
    ...(opts.prod
      ? ["--filter=@flowaid/api...", "--filter=@flowaid/worker...", "--filter=@flowaid/web..."]
      : ["--filter=@flowaid/api^...", "--filter=@flowaid/worker^...", "--filter=@flowaid/web^..."]),
    "--output-logs=errors-only",
  ]);

  // PageIndex (optional): the service runs from its own virtualenv; the api and worker find it
  // through FLOWAID_PAGEINDEX_URL/TOKEN unless .env already points at another instance.
  let pageIndexPython: string | null = null;
  if (opts.pageindex) {
    heading("PageIndex");
    pageIndexPython = await ensurePageIndexVenv();
  }

  heading("Start");
  const data = join(ROOT, ".flowaid");
  const pageIndexPort = portOption(opts["pageindex-port"], "--pageindex-port");
  const pageIndexEnv: Record<string, string> = pageIndexPython
    ? {
        FLOWAID_PAGEINDEX_URL: `http://127.0.0.1:${pageIndexPort}`,
        FLOWAID_PAGEINDEX_TOKEN: pageIndexToken(secrets.values),
      }
    : {};
  mkdirSync(join(data, "keys"), { recursive: true });
  const apiUrl = `http://${browserHost}:${apiPort}`;
  const webUrl = `http://${browserHost}:${webPort}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...fileEnv,
    // the generated PageIndex token only travels with --pageindex (which also sets its URL)
    ...Object.fromEntries(
      Object.entries(secrets.values).filter(([k]) => k !== "FLOWAID_PAGEINDEX_TOKEN"),
    ),
    NODE_ENV: opts.prod ? "production" : "development",
    DATABASE_URL: dbUrl,
    FLOWAID_MASTER_KEY_FILE: join(data, "master.key"),
    FLOWAID_JWT_KEYS_DIR: join(data, "keys"),
    // plain http on this machine: cookies without Secure
    FLOWAID_ALLOW_INSECURE_HTTP: "true",
    FLOWAID_BASE_URL: fileEnv.FLOWAID_BASE_URL ?? apiUrl,
    FLOWAID_WEB_URL: fileEnv.FLOWAID_WEB_URL ?? webUrl,
    FLOWAID_API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`,
    // the browser reaches the API through the web app's proxy; direct calls come from here
    CORS_ORIGINS: fileEnv.CORS_ORIGINS ?? webUrl,
    // the web app's proxy runs on this machine: trust its X-Forwarded-For (rate limits, audit)
    FLOWAID_TRUST_PROXY: fileEnv.FLOWAID_TRUST_PROXY ?? "loopback",
    ...("mode" in bindAuth && bindAuth.mode ? { FLOWAID_AUTH_MODE: bindAuth.mode } : {}),
    ...pageIndexEnv,
    LOG_LEVEL: process.env.LOG_LEVEL ?? fileEnv.LOG_LEVEL ?? "warn",
    // provider record/replay (P5-03): off | record | replay, fixtures at the repo root whatever the cwd
    FLOWAID_PROVIDER_FIXTURES:
      process.env.FLOWAID_PROVIDER_FIXTURES ?? fileEnv.FLOWAID_PROVIDER_FIXTURES ?? "off",
    FLOWAID_PROVIDER_FIXTURES_DIR: resolve(
      ROOT,
      process.env.FLOWAID_PROVIDER_FIXTURES_DIR ??
        fileEnv.FLOWAID_PROVIDER_FIXTURES_DIR ??
        "fixtures/providers",
    ),
  };
  const api = join(ROOT, "apps/api");
  const worker = join(ROOT, "apps/worker");
  const web = join(ROOT, "apps/web");
  // FlowAId's window and icon (on a desktop), and the channel through which the app's Close window
  // and Quit FlowAId reach this launcher: its URL and a token for this launch go to the API only
  const desktop = desktopAvailable(process.env, process.platform);
  const appWindow =
    (opts.open ?? desktop)
      ? new AppWindow({
          url: webUrl,
          browser: desktop ? findAppBrowser(process.env, process.platform) : null,
          profileDir: join(data, "window"),
          onStart: (guardPid, pid) => {
            recordProcess({ name: "window guard", pid: guardPid, match: "scripts/guard.ts" });
            recordProcess({ name: "window", pid, match: join(data, "window") });
          },
        })
      : null;
  let tray: Tray | null = null;
  // the latest background activity the API reported, for the icon (and approvals' notifications)
  let activity: Activity | null = null;
  const launcherToken = randomBytes(32).toString("hex");
  const control = await startControl({
    token: launcherToken,
    handlers: {
      status: () => ({
        window: appWindow?.kind ?? "none",
        tray: tray !== null,
        platform: platformName(process.platform),
      }),
      closeWindow: () => appWindow?.close() ?? false,
      openWindow: () => (appWindow ? appWindow.open() : openInDefaultBrowser(webUrl)),
      quit: () => {
        console.log(`\n${paint(1, "Quit FlowAId")}: stopping…`);
        shutdown(0);
      },
      activity: (next) => {
        // a new approval while FlowAId may be in the background (Windows: the icon's balloon);
        // not the ones already waiting when FlowAId started
        if (activity && next.approvals > activity.approvals && tray)
          notify("FlowAId", `${next.approvals} approval${next.approvals === 1 ? "" : "s"} waiting`);
        activity = next;
        tray?.update(next);
      },
    },
  });
  cleanups.push(() => void control.close());
  if (appWindow) cleanups.push(() => appWindow.close());
  instance = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    webUrl,
    apiUrl,
    control: { url: control.url, token: launcherToken },
    processes: [],
  };
  writeInstance(INSTANCE, instance);

  if (pageIndexPython) {
    // only what the service needs: never the master key, database or provider keys
    start("pidx", 35, pageIndexPython, ["-m", "flowaid_pageindex"], PAGEINDEX_DIR, {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      FLOWAID_PAGEINDEX_TOKEN: pageIndexEnv.FLOWAID_PAGEINDEX_TOKEN ?? "",
      FLOWAID_PAGEINDEX_HOST: "127.0.0.1",
      FLOWAID_PAGEINDEX_PORT: String(pageIndexPort),
      FLOWAID_PAGEINDEX_DATA_DIR: join(data, "pageindex"),
    });
    if (!(await waitFor(`http://127.0.0.1:${pageIndexPort}/readyz`, 60_000)))
      fail("the PageIndex service did not become ready (see the pidx lines above)");
    ok(`PageIndex service ready on http://127.0.0.1:${pageIndexPort}`);
  }
  // Windows has no SIGTERM: the API and worker run in one process each (no watcher), so their
  // guards can ask them to stop over IPC and they finish what they are doing
  const nodeApp = (dir: string): [string, string[]] =>
    opts.prod
      ? [process.execPath, ["dist/main.js"]]
      : WINDOWS
        ? [process.execPath, ["--conditions=development", "--import", "tsx", "src/main.ts"]]
        : [
            process.execPath,
            [
              pkgBin(dir, "tsx", "dist/cli.mjs"),
              "watch",
              "--conditions=development",
              "src/main.ts",
            ],
          ];
  const [apiCmd, apiArgs] = nodeApp("apps/api");
  start(
    "api",
    34,
    apiCmd,
    apiArgs,
    api,
    {
      ...env,
      HOST: host,
      PORT: String(apiPort),
      FLOWAID_LAUNCHER_URL: control.url,
      FLOWAID_LAUNCHER_TOKEN: launcherToken,
    },
    { ipc: true },
  );
  if (!(await waitFor(`http://127.0.0.1:${apiPort}/v1/ready`, 120_000)))
    fail("the API did not become ready (see the api lines above)");
  ok(`API ready on ${apiUrl}`);
  const [workerCmd, workerArgs] = nodeApp("apps/worker");
  start("worker", 33, workerCmd, workerArgs, worker, env, { ipc: true });
  if (opts.prod) {
    // the standalone server is what the Docker image runs; it serves static files from beside it
    const standalone = join(web, ".next/standalone/apps/web");
    cpSync(join(web, ".next/static"), join(standalone, ".next/static"), { recursive: true });
    cpSync(join(web, "public"), join(standalone, "public"), { recursive: true });
    start("web", 36, process.execPath, ["server.js"], standalone, {
      ...env,
      PORT: String(webPort),
      HOSTNAME: host,
    });
  } else
    start(
      "web",
      36,
      process.execPath,
      [
        pkgBin("apps/web", "next", "dist/bin/next"),
        "dev",
        "--port",
        String(webPort),
        "--hostname",
        host,
      ],
      web,
      {
        ...env,
        PORT: String(webPort),
        // the web app's proxy reads its bind address from here (src/server/proxy.ts)
        HOSTNAME: host,
      },
    );
  if (!(await waitFor(`http://127.0.0.1:${webPort}/login`, 180_000)))
    fail("the web app did not start (see the web lines above)");

  console.log(`\n${paint(32, "→")} ${paint(1, webUrl)}   (Quit FlowAId in the app, or Ctrl+C)`);
  // local mode (loopback URLs, the default): this computer opens the app without signing in
  const local = authModeOf(env) === "local";
  if (local) console.log("  opens without a sign-in on this computer");
  if ((!local || exposed) && (secrets.created || !existsSync(join(data, "signed-in"))))
    console.log(
      `  ${local ? "other computers sign in" : "sign in"} as ${paint(1, secrets.values.FLOWAID_ADMIN_EMAIL ?? "")} / ${paint(1, secrets.values.FLOWAID_ADMIN_PASSWORD ?? "")}   (also in .flowaid/dev.env)`,
    );
  console.log(`  API ${apiUrl} · docs ${apiUrl}/docs\n`);
  writeFileSync(join(data, "signed-in"), "");
  if (opts.tray ?? desktop) {
    const started = startTray({
      url: webUrl,
      cacheDir: join(data, "tray"),
      env: process.env,
      onCommand: (command) => {
        if (command === "quit") {
          console.log(`\n${paint(1, "Quit FlowAId")} (menu bar): stopping…`);
          shutdown(0);
        } else if (appWindow) appWindow.open();
        else openInDefaultBrowser(webUrl);
      },
    });
    if ("tray" in started) {
      tray = started.tray;
      const stop = started.tray;
      cleanups.push(() => stop.stop());
      if (activity) stop.update(activity);
      if (stop.pid !== undefined)
        recordProcess({
          name: "icon",
          pid: stop.pid,
          match: WINDOWS ? "tray-windows.ps1" : "flowaid-tray",
        });
      ok(
        process.platform === "darwin"
          ? "FlowAId is in the menu bar: reopen the window or quit from its icon"
          : "FlowAId is in the notification area: reopen the window or quit from its icon",
      );
    } else warn(`no menu bar icon: ${started.error}`);
  }
  if (appWindow) {
    appWindow.open();
    ok(
      appWindow.kind === "app"
        ? "opened FlowAId in its own window"
        : "opened FlowAId in your browser",
    );
  }
}

/** FLOWAID_AUTH_MODE as the api resolves it (`auto`: local when both URLs are loopback). */
function authModeOf(env: NodeJS.ProcessEnv): "local" | "password" {
  const mode = env.FLOWAID_AUTH_MODE;
  if (mode === "local" || mode === "password") return mode;
  const loopback = (u: string | undefined) => {
    try {
      const h = new URL(u ?? "http://localhost").hostname;
      return h === "localhost" || h.endsWith(".localhost") || h === "[::1]" || /^127\./.test(h);
    } catch {
      return false;
    }
  };
  return loopback(env.FLOWAID_BASE_URL) && loopback(env.FLOWAID_WEB_URL) ? "local" : "password";
}
