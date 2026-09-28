/**
 * `pnpm start`: one command from a fresh clone to a running FlowAId — database, API, worker and
 * web app — on this machine.
 *
 * 1. Preflight: Node.js, pnpm, dependencies, free ports, and Docker when no database is given.
 * 2. Installs dependencies when they are missing or older than pnpm-lock.yaml.
 * 3. Configuration: `.env` and `.env.local` (provider keys and overrides), plus local secrets
 *    generated once into `.flowaid/dev.env` (master key, owner password) and printed once.
 * 4. Database: DATABASE_URL when set, otherwise a pgvector Postgres container (`flowaid-dev-db`,
 *    loopback only, data in the `flowaid-dev-db` volume).
 * 5. Builds what the apps import, then starts the API, the worker and the web app with prefixed
 *    logs, waits for /v1/ready and prints where to sign in. Ctrl+C stops everything.
 *
 * `--prod` runs the production builds (Next's standalone server, compiled API and worker) instead of watch
 * mode; `--playground` serves the @flowaid/ui component playground instead of the stack.
 *
 * Runs on plain Node (native type stripping) so it works before `pnpm install`.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
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

const HELP = `Usage: pnpm start [options]

Start FlowAId locally: Postgres, the API, the worker and the web app.

Options
  --port <n>          Web app port (default 3001)
  --api-port <n>      API port (default 3000)
  --host <address>    Interface to bind (default ${DEFAULT_HOST}; 0.0.0.0 exposes it on your network)
  --domain <name>     Name in the app's address (default ${DEFAULT_DOMAIN}; any *.localhost name
                      reaches this computer, as does 127.0.0.1)
  --database-url <u>  Use this Postgres instead of a Docker container (or set DATABASE_URL)
  --prod              Run production builds instead of watch mode
  --open              Open the browser once the web app is ready
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
      "api-port": { type: "string", default: "3000" },
      host: { type: "string", default: DEFAULT_HOST },
      domain: { type: "string", default: DEFAULT_DOMAIN },
      "database-url": { type: "string" },
      prod: { type: "boolean", default: false },
      open: { type: "boolean", default: false },
      verify: { type: "boolean", default: false },
      "skip-install": { type: "boolean", default: false },
      playground: { type: "boolean", default: false },
      pageindex: { type: "boolean", default: false },
      "pageindex-port": { type: "string", default: "8765" },
      help: { type: "boolean", short: "h", default: false },
    },
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
const webPort = portOption(opts.port ?? String(opts.playground ? DEFAULT_PORT : 3001), "--port");
const apiPort = portOption(opts["api-port"], "--api-port");
// Bound to loopback (or every interface), the app is addressed by its name: browsers and the OS
// resolve any *.localhost name to this computer (RFC 6761), so http://flowaid.localhost:3001
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

function run(command: string, args: readonly string[], env?: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
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

/** A Python 3.10+ interpreter: FLOWAID_PYTHON, else the newest python3.x on PATH. */
function findPython(): string | null {
  const candidates = [
    process.env.FLOWAID_PYTHON,
    "python3.13",
    "python3.12",
    "python3.11",
    "python3.10",
    "python3",
  ].filter((c): c is string => Boolean(c));
  return (
    candidates.find(
      (cmd) =>
        spawnSync(cmd, ["-c", "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"])
          .status === 0,
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
    fail(
      "--pageindex needs Python 3.10 or newer (python3.10 … python3.13 on PATH, or set FLOWAID_PYTHON)",
    );
  await mustRun("PageIndex virtualenv created", base as string, ["-m", "venv", "--clear", venv]);
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

const children: ChildProcess[] = [];
let stopping = false;

function start(
  name: string,
  code: number,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const tag = paint(code, name.padEnd(6));
  const pipe = (stream: NodeJS.ReadableStream, out: NodeJS.WriteStream) => {
    let rest = "";
    stream.on("data", (chunk: Buffer) => {
      const lines = (rest + chunk.toString()).split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) out.write(`${tag} ${line}\n`);
    });
  };
  if (child.stdout) pipe(child.stdout, process.stdout);
  if (child.stderr) pipe(child.stderr, process.stderr);
  child.once("exit", (exitCode) => {
    if (stopping) return;
    console.error(
      `\n${paint(31, "✗")} ${name} exited (${exitCode ?? "signal"}); stopping the others.`,
    );
    shutdown(exitCode ?? 1);
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill("SIGTERM");
  const hard = setTimeout(() => {
    for (const c of children) c.kill("SIGKILL");
    process.exit(code);
  }, 10_000);
  hard.unref();
  let left = children.filter((c) => c.exitCode === null).length;
  if (left === 0) process.exit(code);
  for (const c of children)
    c.once("exit", () => {
      left -= 1;
      if (left <= 0) process.exit(code);
    });
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => shutdown(0));

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

function openBrowser(url: string) {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], {
    stdio: "ignore",
    detached: true,
    shell: process.platform === "win32",
  }).unref();
}

// ─── main ────────────────────────────────────────────────────────────────────────────────────

console.log(
  `\n${paint(1, "FlowAId")} · ${opts.playground ? "UI playground" : `local stack${opts.prod ? " (production builds)" : ""}`}`,
);

heading("Preflight");
const fileEnv = { ...readEnvFile(join(ROOT, ".env")), ...readEnvFile(join(ROOT, ".env.local")) };
const databaseUrl = opts["database-url"] ?? process.env.DATABASE_URL ?? fileEnv.DATABASE_URL;
const results: CheckResult[] = await runPreflight({ host, port: webPort });
if (!opts.playground) {
  const api = await checkPort(host, apiPort);
  results.push({
    ...api,
    name: "API port",
    ...(api.fix ? { fix: `${api.fix} (or pass --api-port)` } : {}),
  });
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
  const web = results.findIndex((r) => r.name === "Playground port");
  if (web >= 0) results[web] = { ...(results[web] as CheckResult), name: "Web port" };
}
console.log(formatReport(results, color));
if (hasFailures(results)) fail("Fix the items marked ✗ and run pnpm start again.");

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
  const vite = join(
    UI_DIR,
    "node_modules/.bin",
    process.platform === "win32" ? "vite.cmd" : "vite",
  );
  const url = `http://${browserHost}:${webPort}`;
  console.log(`${paint(32, "→")} ${paint(1, url)}   (Ctrl+C to stop)\n`);
  start(
    "ui",
    36,
    vite,
    [
      ...(opts.prod ? ["preview"] : []),
      "--config",
      "playground/vite.config.ts",
      "--host",
      host,
      "--port",
      String(webPort),
      "--strictPort",
      ...(opts.open ? ["--open"] : []),
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
    ...secrets.values,
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
  const bin = (dir: string, name: string) =>
    join(ROOT, dir, "node_modules/.bin", process.platform === "win32" ? `${name}.cmd` : name);
  const api = join(ROOT, "apps/api");
  const worker = join(ROOT, "apps/worker");
  const web = join(ROOT, "apps/web");
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
  start(
    "api",
    34,
    opts.prod ? process.execPath : bin("apps/api", "tsx"),
    opts.prod ? ["dist/main.js"] : ["watch", "--conditions=development", "src/main.ts"],
    api,
    { ...env, HOST: host, PORT: String(apiPort) },
  );
  if (!(await waitFor(`http://127.0.0.1:${apiPort}/v1/ready`, 120_000)))
    fail("the API did not become ready (see the api lines above)");
  ok(`API ready on ${apiUrl}`);
  start(
    "worker",
    33,
    opts.prod ? process.execPath : bin("apps/worker", "tsx"),
    opts.prod ? ["dist/main.js"] : ["watch", "--conditions=development", "src/main.ts"],
    worker,
    env,
  );
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
      bin("apps/web", "next"),
      ["dev", "--port", String(webPort), "--hostname", host],
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

  console.log(`\n${paint(32, "→")} ${paint(1, webUrl)}   (Ctrl+C to stop)`);
  // local mode (loopback URLs, the default): this computer opens the app without signing in
  const local = authModeOf(env) === "local";
  if (local) console.log("  opens without a sign-in on this computer");
  if ((!local || exposed) && (secrets.created || !existsSync(join(data, "signed-in"))))
    console.log(
      `  ${local ? "other computers sign in" : "sign in"} as ${paint(1, secrets.values.FLOWAID_ADMIN_EMAIL ?? "")} / ${paint(1, secrets.values.FLOWAID_ADMIN_PASSWORD ?? "")}   (also in .flowaid/dev.env)`,
    );
  console.log(`  API ${apiUrl} · docs ${apiUrl}/docs\n`);
  writeFileSync(join(data, "signed-in"), "");
  if (opts.open) openBrowser(webUrl);
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
