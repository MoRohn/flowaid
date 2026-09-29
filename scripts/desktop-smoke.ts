/**
 * `pnpm smoke:desktop [-- <./flowaid options>]`: FlowAId's lifecycle, end to end, on this
 * computer. CI runs it on macOS and Windows (.github/workflows/desktop.yml). It starts the real
 * stack with `scripts/start.ts --no-open --no-tray --skip-install` and checks that nothing is ever
 * left running:
 *
 * 1. A second launch finds the running FlowAId and leaves it alone (one per checkout).
 * 2. Quit FlowAId (`POST /v1/desktop/quit`, what the app's menu and the icon do) stops everything.
 * 3. A launcher killed outright (a crash, `kill -9`, End task) takes its processes with it: their
 *    guards notice and stop them.
 * 4. Killed together with its guards, the next start ends what they left behind.
 *
 * "Left running": a process whose command line names this checkout, or a listener on its ports.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const INSTANCE = join(ROOT, ".flowaid/launcher.json");
const WINDOWS = process.platform === "win32";
const argv = process.argv.slice(2);
const extra = argv[0] === "--" ? argv.slice(1) : argv;
const ARGS = ["--no-open", "--no-tray", "--skip-install", ...extra];

interface Rec {
  pid: number;
  webUrl: string;
  apiUrl: string;
  control: { url: string; token: string };
  processes: { name: string; pid: number }[];
}

const step = (text: string) => console.log(`\n\u001b[1m▸ ${text}\u001b[0m`);
const ok = (text: string) => console.log(`\u001b[32m✓\u001b[0m ${text}`);
function fail(text: string): never {
  console.error(`\n\u001b[31m✗ ${text}\u001b[0m`);
  for (const l of launches) l.child.kill();
  process.exit(1);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── the launcher ────────────────────────────────────────────────────────────────────────────

interface Launch {
  child: ChildProcess;
  output: () => string;
  exited: Promise<number | null>;
}
const launches: Launch[] = [];

function launch(label: string): Launch {
  const child = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", join(ROOT, "scripts/start.ts"), ...ARGS],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  let out = "";
  const take = (chunk: Buffer) => {
    const text = chunk.toString();
    out += text;
    for (const line of text.split("\n")) if (line.trim()) console.log(`  [${label}] ${line}`);
  };
  child.stdout?.on("data", take);
  child.stderr?.on("data", take);
  const exited = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
  const l = { child, output: () => out, exited };
  launches.push(l);
  return l;
}

const readRec = (): Rec | null => {
  try {
    return JSON.parse(readFileSync(INSTANCE, "utf8")) as Rec;
  } catch {
    return null;
  }
};

/** The address with 127.0.0.1 for its host: Node on Windows does not resolve *.localhost. */
const loopback = (url: string) => {
  const u = new URL(url);
  u.hostname = "127.0.0.1";
  return u.origin;
};

async function ok200(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(10_000) })).ok;
  } catch {
    return false;
  }
}

/** Waits for the stack of `l` to answer: its record, the API and the web app. */
async function ready(l: Launch, label: string): Promise<Rec> {
  const deadline = Date.now() + 20 * 60_000;
  let exited = false;
  void l.exited.then(() => (exited = true));
  while (Date.now() < deadline) {
    if (exited) fail(`${label}: the launcher exited before FlowAId was ready`);
    const rec = readRec();
    if (
      rec &&
      rec.pid === l.child.pid &&
      l.output().includes("(Quit FlowAId in the app, or Ctrl+C)") &&
      (await ok200(`${loopback(rec.apiUrl)}/v1/ready`)) &&
      (await ok200(`${loopback(rec.webUrl)}/login`))
    )
      return rec;
    await sleep(2000);
  }
  return fail(`${label}: FlowAId was not ready within 20 minutes`);
}

// ─── what is left ────────────────────────────────────────────────────────────────────────────

const norm = (s: string) => (WINDOWS ? s.replaceAll("\\", "/").toLowerCase() : s);

/** Processes whose command line names this checkout (other than this script). */
function leftovers(): string[] {
  const table = WINDOWS
    ? spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }',
        ],
        { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
      ).stdout
    : spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
        .stdout;
  const root = norm(ROOT);
  return table
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      const m = /^(\d+)\s+(.*)$/.exec(line);
      if (!m) return false;
      const pid = Number(m[1]);
      const cmd = norm(m[2] ?? "");
      return pid !== process.pid && cmd.includes(root) && !cmd.includes("desktop-smoke");
    });
}

function listening(url: string): Promise<boolean> {
  const port = Number(new URL(url).port);
  return new Promise((r) => {
    const s = connect({ host: "127.0.0.1", port }, () => {
      s.destroy();
      r(true);
    });
    s.on("error", () => r(false));
    s.setTimeout(2000, () => {
      s.destroy();
      r(false);
    });
  });
}

async function nothingLeft(rec: Rec, label: string, withinMs: number): Promise<void> {
  const deadline = Date.now() + withinMs;
  let left: string[] = [];
  let ports: string[] = [];
  while (Date.now() < deadline) {
    left = leftovers();
    ports = [];
    for (const url of [rec.apiUrl, rec.webUrl]) if (await listening(url)) ports.push(url);
    if (left.length === 0 && ports.length === 0) {
      ok(`${label}: no FlowAId process or port left`);
      return;
    }
    await sleep(1000);
  }
  fail(
    `${label}: still running after ${withinMs / 1000} s:\n  ${[...left, ...ports.map((p) => `listening: ${p}`)].join("\n  ")}`,
  );
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Ends one process without its tree: what a crash or End task does. */
function hardKill(pid: number): void {
  if (WINDOWS) spawnSync("taskkill", ["/pid", String(pid), "/F"], { stdio: "ignore" });
  else process.kill(pid, "SIGKILL");
}

// ─── the app, as its menu and icon use it ────────────────────────────────────────────────────

async function signIn(rec: Rec): Promise<(path: string, method?: string) => Promise<Response>> {
  const api = loopback(rec.apiUrl);
  const res = await fetch(`${api}/v1/auth/local`, {
    method: "POST",
    headers: { "x-requested-with": "flowaid" },
  });
  if (!res.ok) fail(`local sign-in answered ${res.status}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return (path, method = "GET") =>
    fetch(`${api}${path}`, {
      method,
      headers: { cookie, "x-requested-with": "flowaid", "x-workspace": "default" },
    });
}

// ─── the checks ──────────────────────────────────────────────────────────────────────────────

if (existsSync(INSTANCE) && readRec() && alive(readRec()?.pid ?? 0))
  fail("FlowAId is already running from this checkout; quit it first");

step("1. Start FlowAId, then start it again");
const first = launch("first");
let rec = await ready(first, "first start");
ok(`ready at ${rec.webUrl} (API ${rec.apiUrl}), ${rec.processes.length} processes recorded`);
const second = launch("second");
const secondCode = await Promise.race([second.exited, sleep(60_000).then(() => "timeout")]);
if (secondCode !== 0 || !second.output().includes("FlowAId is already running"))
  fail(`the second launch did not defer to the running FlowAId (exit ${String(secondCode)})`);
if (readRec()?.pid !== first.child.pid) fail("the second launch replaced the record");
ok("the second launch found the running FlowAId and left it alone");

step("2. Quit FlowAId from the app");
const api = await signIn(rec);
const me = (await (await api("/v1/me")).json()) as { features: Record<string, boolean> };
if (me.features.desktop !== true) fail("features.desktop is not on under ./flowaid");
const status = await api("/v1/desktop");
const body = (await status.json()) as { activity?: { runs: number; approvals: number } };
if (!status.ok || typeof body.activity?.runs !== "number")
  fail(`GET /v1/desktop answered ${status.status}: ${JSON.stringify(body)}`);
ok(`the app sees its launcher (activity: ${JSON.stringify(body.activity)})`);
const quit = await api("/v1/desktop/quit", "POST");
if (quit.status !== 202) fail(`POST /v1/desktop/quit answered ${quit.status}`);
const quitCode = await Promise.race([first.exited, sleep(60_000).then(() => "timeout")]);
if (quitCode !== 0) fail(`the launcher did not exit cleanly after Quit (${String(quitCode)})`);
ok("the launcher stopped (exit 0)");
await nothingLeft(rec, "after Quit", 20_000);
if (existsSync(INSTANCE)) fail("the launcher record is still there after Quit");
ok("the launcher record is gone");

step("3. Kill the launcher outright");
const third = launch("third");
rec = await ready(third, "third start");
hardKill(rec.pid);
await third.exited;
ok(`killed the launcher (pid ${rec.pid}) without letting it clean up`);
await nothingLeft(rec, "after the launcher was killed", 60_000);

step("4. Kill the launcher and its guards; the next start ends the orphans");
const fourth = launch("fourth");
rec = await ready(fourth, "fourth start");
const guards = rec.processes.filter((p) => p.name.endsWith(" guard"));
hardKill(rec.pid);
for (const g of guards) hardKill(g.pid);
await fourth.exited;
await sleep(2000);
const orphans = rec.processes.filter((p) => !p.name.endsWith(" guard") && alive(p.pid));
if (orphans.length === 0) fail("expected orphans after killing the guards; none were left");
ok(`left orphans on purpose: ${orphans.map((p) => p.name).join(", ")}`);
const fifth = launch("fifth");
const fresh = await ready(fifth, "fifth start");
if (!fifth.output().includes("stopped what an earlier FlowAId left running"))
  fail("the next start did not report ending the orphans");
for (const o of orphans) if (alive(o.pid)) fail(`${o.name} (pid ${o.pid}) survived the next start`);
ok("the next start ended every orphan and started cleanly");
// quit through the launcher's control channel: what the menu bar icon's Quit does
await fetch(`${fresh.control.url}/quit`, {
  method: "POST",
  headers: { authorization: `Bearer ${fresh.control.token}` },
});
const fifthCode = await Promise.race([fifth.exited, sleep(60_000).then(() => "timeout")]);
if (fifthCode !== 0) fail(`the launcher did not exit cleanly (${String(fifthCode)})`);
await nothingLeft(fresh, "after the icon's Quit", 20_000);

console.log(
  "\n\u001b[32mFlowAId starts, quits and cleans up after itself on this computer.\u001b[0m",
);
process.exit(0);
