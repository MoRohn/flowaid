/**
 * `pnpm start`: one command from a fresh clone to a running FlowAId UI.
 *
 * 1. Preflight: Node.js, pnpm, dependencies and the port (the same checks as `pnpm preflight`).
 * 2. Installs dependencies when they are missing or older than pnpm-lock.yaml.
 * 3. Builds the workspace packages the UI depends on.
 * 4. Serves the UI playground: the Vite dev server, or with --prod an optimised build.
 *
 * Runs on plain Node (native type stripping) so it works before `pnpm install`. The API,
 * worker and web app are not built yet; when they are, this command will start them too.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  ROOT,
  formatReport,
  hasFailures,
  runPreflight,
  useColor,
} from "./preflight.ts";

const HELP = `Usage: pnpm start [options]

Start the FlowAId UI playground from a fresh clone.

Options
  --port <n>        Port to serve on (default ${DEFAULT_PORT})
  --host <address>  Interface to bind (default ${DEFAULT_HOST}; 0.0.0.0 exposes it on your network)
  --open            Open the browser once the server is ready
  --prod            Serve an optimised production build instead of the dev server
  --verify          Run every CI gate (pnpm check) before starting
  --skip-install    Never install dependencies, even when they are missing or stale
  -h, --help        Show this help
`;

let parsed;
try {
  // `pnpm start -- --help` passes the separator through; drop it.
  const argv = process.argv.slice(2);
  parsed = parseArgs({
    args: argv[0] === "--" ? argv.slice(1) : argv,
    options: {
      port: { type: "string", default: String(DEFAULT_PORT) },
      host: { type: "string", default: DEFAULT_HOST },
      open: { type: "boolean", default: false },
      prod: { type: "boolean", default: false },
      verify: { type: "boolean", default: false },
      "skip-install": { type: "boolean", default: false },
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

const port = Number(opts.port);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error(`--port must be an integer between 1 and 65535 (got ${opts.port}).`);
  process.exit(2);
}
const host = opts.host;

const color = useColor();
const paint = (code: number, text: string) => (color ? `\u001b[${code}m${text}\u001b[0m` : text);
const TOTAL_STEPS = opts.verify ? 5 : 4;
let step = 0;
const heading = (text: string) => {
  step += 1;
  console.log(`\n${paint(1, `[${step}/${TOTAL_STEPS}] ${text}`)}`);
};

/** Runs a command with inherited stdio; resolves with its exit code. */
function run(command: string, args: readonly string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", () => resolve(127));
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function mustRun(label: string, command: string, args: readonly string[]): Promise<void> {
  const started = performance.now();
  const code = await run(command, args);
  if (code !== 0) {
    console.error(
      `\n${paint(31, "✗")} ${label} failed (exit ${code}). Run pnpm preflight for help.`,
    );
    process.exit(code);
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`${paint(32, "✓")} ${label} (${seconds} s)`);
}

console.log(
  `\n${paint(1, "FlowAId")} · starting the UI playground${opts.prod ? " (production build)" : ""}`,
);

heading("Preflight");
const results = await runPreflight({ host, port });
console.log(formatReport(results, color));
if (hasFailures(results)) {
  console.error(`\n${paint(31, "✗")} Fix the items marked ✗ and run pnpm start again.`);
  process.exit(1);
}

heading("Dependencies");
const deps = results.find((r) => r.name === "Dependencies");
if (deps?.status === "ok") {
  console.log(`${paint(32, "✓")} already installed`);
} else if (opts["skip-install"]) {
  console.log(`${paint(33, "!")} ${deps?.detail ?? "unknown"}; skipped (--skip-install)`);
} else {
  await mustRun("pnpm install", "pnpm", ["install", "--frozen-lockfile"]);
}

if (opts.verify) {
  heading("Verify (every CI gate)");
  await mustRun("pnpm check", "pnpm", ["check"]);
}

heading("Build workspace packages");
await mustRun("Workspace packages built", "pnpm", [
  "turbo",
  "run",
  "build",
  "--filter=@flowaid/ui^...",
  "--output-logs=errors-only",
]);
if (opts.prod) {
  await mustRun("Playground production build", "pnpm", [
    "--filter",
    "@flowaid/ui",
    "build:playground",
  ]);
}

heading(opts.prod ? "Serve the production build" : "Start the dev server");
const url = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`;
if (host === "0.0.0.0") {
  console.log(
    `${paint(33, "!")} bound to 0.0.0.0: anyone on your network can reach the playground`,
  );
}
console.log(`${paint(32, "→")} ${paint(1, url)}   (Ctrl+C to stop)\n`);

// Vite runs directly (not through `pnpm exec`) so a stop is clean and its output is its own.
const UI_DIR = join(ROOT, "packages/ui");
const vite = join(UI_DIR, "node_modules/.bin", process.platform === "win32" ? "vite.cmd" : "vite");
const viteArgs = [
  ...(opts.prod ? ["preview"] : []),
  "--config",
  "playground/vite.config.ts",
  "--host",
  host,
  "--port",
  String(port),
  "--strictPort",
  ...(opts.open ? ["--open"] : []),
];
const server = spawn(vite, viteArgs, {
  cwd: UI_DIR,
  stdio: "inherit",
  shell: process.platform === "win32",
});

// Forward stop signals so the server also stops when only this process is signalled (a
// supervisor, or kill), then exit with the server's code once it has shut down.
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    server.kill(signal);
  });
}
server.once("exit", (code) => {
  // A requested stop is a clean exit even though pnpm reports its killed child as a failure.
  process.exit(stopping ? 0 : (code ?? 1));
});
