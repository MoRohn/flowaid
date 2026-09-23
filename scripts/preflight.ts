/**
 * Preflight checks shared by `pnpm preflight` and `pnpm start`. They run on plain Node (native
 * type stripping) before dependencies are installed, so this file imports only `node:`
 * built-ins and uses only erasable TypeScript syntax.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Where the UI playground listens unless told otherwise (packages/ui/playground/vite.config.ts). */
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 5178;

/** `info` never blocks; `warn` is fixable later or automatically; `fail` stops `pnpm start`. */
export type CheckStatus = "ok" | "info" | "warn" | "fail";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

export type Version = readonly [major: number, minor: number, patch: number];

export function parseVersion(text: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/** The lower bound of an `engines` range such as `>=24.0.0` or `^24.1`; null when there is none. */
export function minimumFromRange(range: string): Version | null {
  const m = /(?:>=|\^|~)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(range);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

const formatVersion = (v: Version) => v.join(".");

export interface RootManifest {
  engines?: { node?: string };
  packageManager?: string;
}

export function readManifest(root: string = ROOT): RootManifest {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as RootManifest;
}

export function checkNode(current: string, range: string | undefined): CheckResult {
  const name = "Node.js";
  const found = parseVersion(current);
  const min = range ? minimumFromRange(range) : null;
  if (!found) return { name, status: "fail", detail: `unrecognised version ${current}` };
  if (min && compareVersions(found, min) < 0) {
    return {
      name,
      status: "fail",
      detail: `v${formatVersion(found)} is older than the required ${range}`,
      fix: `install Node.js ${min[0]} or newer (the repository pins it in .nvmrc: nvm install)`,
    };
  }
  return {
    name,
    status: "ok",
    detail: `v${formatVersion(found)}${range ? ` (requires ${range})` : ""}`,
  };
}

/** `found` is the output of `pnpm --version`, or null when pnpm is not on the PATH. */
export function checkPnpm(found: string | null, packageManager: string | undefined): CheckResult {
  const name = "pnpm";
  const expectedText = packageManager?.startsWith("pnpm@") ? packageManager.slice(5) : undefined;
  const expected = expectedText ? parseVersion(expectedText) : null;
  const install = expectedText
    ? `corepack enable && corepack prepare pnpm@${expectedText} --activate`
    : "corepack enable";
  if (found === null) {
    return { name, status: "fail", detail: "not found on PATH", fix: install };
  }
  const version = parseVersion(found);
  if (!version)
    return { name, status: "fail", detail: `unrecognised version ${found}`, fix: install };
  if (!expected) return { name, status: "ok", detail: formatVersion(version) };
  if (version[0] !== expected[0]) {
    return {
      name,
      status: "fail",
      detail: `${formatVersion(version)}, but the repository uses pnpm ${formatVersion(expected)}`,
      fix: install,
    };
  }
  if (compareVersions(version, expected) !== 0) {
    return {
      name,
      status: "warn",
      detail: `${formatVersion(version)} (the repository pins ${formatVersion(expected)})`,
      fix: install,
    };
  }
  return { name, status: "ok", detail: formatVersion(version) };
}

function mtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Installed dependencies are current when pnpm's install snapshot (`node_modules/.pnpm/lock.yaml`)
 * is at least as new as `pnpm-lock.yaml`; a pull that changes the lockfile makes it stale.
 */
export function checkDependencies(root: string = ROOT): CheckResult {
  const name = "Dependencies";
  const installed = mtime(join(root, "node_modules/.pnpm/lock.yaml"));
  const lockfile = mtime(join(root, "pnpm-lock.yaml"));
  if (installed === null) {
    return { name, status: "warn", detail: "not installed", fix: "pnpm install" };
  }
  if (lockfile !== null && lockfile > installed) {
    return {
      name,
      status: "warn",
      detail: "out of date with pnpm-lock.yaml",
      fix: "pnpm install",
    };
  }
  return { name, status: "ok", detail: "installed and in sync with pnpm-lock.yaml" };
}

/** Resolves true when nothing is listening on host:port. */
export function portIsFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function checkPort(host: string, port: number): Promise<CheckResult> {
  const name = "Playground port";
  if (await portIsFree(host, port)) {
    return { name, status: "ok", detail: `${host}:${port} is free` };
  }
  return {
    name,
    status: "fail",
    detail: `${host}:${port} is already in use`,
    fix: `stop the process using it, or run pnpm start --port ${port + 1}`,
  };
}

/** Runs a command and returns its trimmed stdout, or null when it is missing or fails. */
export function probe(command: string, args: readonly string[]): string | null {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 15_000,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Docker is optional today: only the application stack (not built yet) needs it. */
export function checkDocker(compose: string | null, daemonUp: boolean): CheckResult {
  const name = "Docker";
  if (compose === null) {
    return {
      name,
      status: "info",
      detail: "not found; optional until the API, worker and web apps ship (docker compose)",
    };
  }
  return {
    name,
    status: "info",
    detail: daemonUp
      ? `${compose}; daemon running`
      : `${compose}; daemon not running (optional for now)`,
  };
}

export interface PreflightOptions {
  host?: string;
  port?: number;
  /** Skip the port check (for example when only building). */
  checkPortFree?: boolean;
}

export async function runPreflight(options: PreflightOptions = {}): Promise<CheckResult[]> {
  const manifest = readManifest();
  const results: CheckResult[] = [
    checkNode(process.versions.node, manifest.engines?.node),
    checkPnpm(probe("pnpm", ["--version"]), manifest.packageManager),
    checkDependencies(),
  ];
  if (options.checkPortFree !== false) {
    results.push(await checkPort(options.host ?? DEFAULT_HOST, options.port ?? DEFAULT_PORT));
  }
  if (!existsSync(join(ROOT, ".git"))) {
    results.push({ name: "Git", status: "info", detail: "not a git checkout" });
  }
  const compose = probe("docker", ["compose", "version", "--short"]);
  results.push(
    checkDocker(
      compose === null ? null : `Compose ${compose}`,
      compose !== null && probe("docker", ["info", "--format", "{{.ServerVersion}}"]) !== null,
    ),
  );
  return results;
}

export const hasFailures = (results: readonly CheckResult[]) =>
  results.some((r) => r.status === "fail");

const SYMBOL: Record<CheckStatus, string> = { ok: "✓", info: "·", warn: "!", fail: "✗" };
const COLOR: Record<CheckStatus, number> = { ok: 32, info: 90, warn: 33, fail: 31 };

/** A padded, optionally coloured report: one line per check, with the fix under it. */
export function formatReport(results: readonly CheckResult[], color = false): string {
  const paint = (status: CheckStatus, text: string) =>
    color ? `\u001b[${COLOR[status]}m${text}\u001b[0m` : text;
  const width = Math.max(...results.map((r) => r.name.length));
  const lines: string[] = [];
  for (const r of results) {
    lines.push(`  ${paint(r.status, SYMBOL[r.status])} ${r.name.padEnd(width)}  ${r.detail}`);
    if (r.fix && r.status !== "ok") {
      lines.push(`    ${" ".repeat(width)}  ${paint(r.status, "→")} ${r.fix}`);
    }
  }
  return lines.join("\n");
}

/** True when stdout is a terminal that accepts colour (honours NO_COLOR and FORCE_COLOR). */
export const useColor = (): boolean =>
  Boolean(process.stdout.isTTY && process.stdout.hasColors?.());
