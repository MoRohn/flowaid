/**
 * Installed plugins (ARCHITECTURE.md §3.5): the `npm` and `local` rows of `plugins` that the api
 * recorded (verified integrity, manifests read as data). The worker never imports their code:
 *
 * 1. npm rows: download the tarball from FLOWAID_PLUGIN_REGISTRY, verify it against the recorded
 *    integrity, extract it path-safely into `<FLOWAID_PLUGIN_DIR>/<name>/<version>/` (an existing
 *    extraction is reused when its kept tarball still matches). Local rows load from the
 *    directory recorded at install (`location`).
 * 2. Dependencies are never installed and no package script ever runs: a plugin may depend on
 *    what the platform provides (`@flowaid/node-sdk`, `@flowaid/workflow-core`, `zod`, linked
 *    into its `node_modules` from the worker's own copies) and on packages it bundles
 *    (`bundleDependencies`); anything else is refused with E_PLUGIN_DEPENDENCIES.
 * 3. A PluginHost process per package loads the entry; the orchestrator gets node definitions
 *    built from the recorded manifests (JSON Schemas; the host re-validates with the package's
 *    own schemas) whose `execute` runs in the host.
 *
 * Failures are recorded on the row (`status = 'error'`, `error`) and do not stop the worker. The
 * node registry is immutable after boot, so installs take effect on the next worker start (the
 * api answers `workerRestartRequired`).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, symlink, writeFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { plugins, type Database } from "@flowaid/database";
import type { AnyNodeDefinition, NodePackage } from "@flowaid/node-sdk";
import { readTarball, verifyIntegrity, type RegistryClient } from "@flowaid/plugins";
import type { JsonObject, NodeManifest, PortSpec } from "@flowaid/workflow-core";
import type { WorkerLogger } from "../worker.js";
import { PROVIDED_PACKAGES, PluginHost } from "./host.js";

/** Packages the platform provides to every plugin (linked, never installed). */
export const PROVIDED_DEPENDENCIES: readonly string[] = PROVIDED_PACKAGES;

export class PluginLoadError extends Error {
  constructor(
    readonly code: "E_PLUGIN_INTEGRITY" | "E_PLUGIN_DEPENDENCIES" | "E_PLUGIN_LOAD",
    message: string,
  ) {
    super(message);
    this.name = "PluginLoadError";
  }
}

type PluginRow = typeof plugins.$inferSelect;

interface PackageJson {
  name?: string;
  version?: string;
  main?: string;
  module?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  bundleDependencies?: string[] | boolean;
  bundledDependencies?: string[] | boolean;
}

export interface InstalledPluginsOptions {
  db: Database;
  registry: RegistryClient;
  /** FLOWAID_PLUGIN_DIR */
  pluginDir: string;
  log: WorkerLogger;
  /** the host processes' environment */
  env?: Record<string, string>;
}

export interface InstalledPlugins {
  packages: NodePackage[];
  hosts: PluginHost[];
}

/** Resolves the platform package directory the worker itself uses. */
function providedDir(name: string): string | null {
  const sdkEntry = fileURLToPath(import.meta.resolve("@flowaid/node-sdk"));
  let sdkDir = dirname(sdkEntry);
  while (!existsSync(join(sdkDir, "package.json"))) {
    const up = dirname(sdkDir);
    if (up === sdkDir) return null;
    sdkDir = up;
  }
  if (name === "@flowaid/node-sdk") return sdkDir;
  const dep = join(sdkDir, "node_modules", name);
  return existsSync(dep) ? dep : null;
}

function bundled(pkg: PackageJson): Set<string> {
  const b = pkg.bundleDependencies ?? pkg.bundledDependencies;
  if (b === true) return new Set(Object.keys(pkg.dependencies ?? {}));
  return new Set(Array.isArray(b) ? b : []);
}

/** The ESM entry of a package directory. */
function entryOf(dir: string, pkg: PackageJson): string {
  const exp = pkg.exports;
  const pick = (v: unknown): string | undefined => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return pick(o["."]) ?? pick(o.import) ?? pick(o.default) ?? pick(o.node);
    }
    return undefined;
  };
  const rel = pick(exp) ?? pkg.module ?? pkg.main ?? "index.js";
  const file = resolve(dir, rel);
  if (!file.startsWith(dir + sep))
    throw new PluginLoadError("E_PLUGIN_LOAD", "entry escapes the package");
  if (!existsSync(file)) throw new PluginLoadError("E_PLUGIN_LOAD", `entry ${rel} does not exist`);
  return file;
}

/** Checks the dependency policy and links the provided packages into `<dir>/node_modules`. */
async function prepareDependencies(dir: string, pkg: PackageJson, linkProvided: boolean) {
  const inTarball = bundled(pkg);
  const missing = Object.keys(pkg.dependencies ?? {}).filter(
    (d) => !PROVIDED_DEPENDENCIES.includes(d) && !inTarball.has(d),
  );
  if (missing.length)
    throw new PluginLoadError(
      "E_PLUGIN_DEPENDENCIES",
      `${pkg.name ?? "the package"} depends on ${missing.join(", ")}; the worker installs no dependencies — bundle them (bundleDependencies) or depend only on ${PROVIDED_DEPENDENCIES.join(", ")}`,
    );
  if (!linkProvided) return;
  for (const name of PROVIDED_DEPENDENCIES) {
    const target = providedDir(name);
    const link = join(dir, "node_modules", name);
    if (!target || existsSync(link)) continue;
    await mkdir(dirname(link), { recursive: true });
    await symlink(await realpath(target), link, "dir");
  }
}

const TARBALL = ".flowaid-package.tgz";

/** Downloads (or reuses), verifies and extracts an npm row into its version directory. */
async function materialize(row: PluginRow, o: InstalledPluginsOptions): Promise<string> {
  if (!row.integrity) throw new PluginLoadError("E_PLUGIN_INTEGRITY", "no recorded integrity");
  const root = resolve(o.pluginDir);
  const dir = resolve(root, row.packageName, row.version);
  if (!dir.startsWith(root + sep)) throw new PluginLoadError("E_PLUGIN_LOAD", "bad package path");
  const kept = join(dir, TARBALL);
  if (existsSync(kept) && verifyIntegrity(await readFile(kept), row.integrity)) return dir;

  const packument = await o.registry.packument(row.packageName);
  const meta = packument.versions[row.version];
  if (!meta) throw new PluginLoadError("E_PLUGIN_LOAD", `${row.version} is not in the registry`);
  const data = await o.registry.tarball(meta.dist.tarball);
  if (!verifyIntegrity(data, row.integrity))
    throw new PluginLoadError(
      "E_PLUGIN_INTEGRITY",
      `the tarball of ${row.packageName}@${row.version} does not match the integrity recorded at install`,
    );
  const files = readTarball(data);
  // extract next to the target, then swap it in (a crash never leaves a half-written package)
  const staging = `${dir}.staging-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true, mode: 0o755 });
  for (const f of files) {
    const path = resolve(staging, f.path);
    if (!path.startsWith(staging + sep))
      throw new PluginLoadError("E_PLUGIN_LOAD", `tarball entry ${f.path} escapes the package`);
    await mkdir(dirname(path), { recursive: true, mode: 0o755 });
    await writeFile(path, f.data, { mode: 0o644 });
  }
  await writeFile(join(staging, TARBALL), data, { mode: 0o644 });
  await rm(dir, { recursive: true, force: true });
  await mkdir(dirname(dir), { recursive: true });
  await rename(staging, dir);
  return dir;
}

/** zod from a JSON Schema, falling back to accepting anything (the host validates for real). */
function fromJson(schema: unknown): z.ZodType {
  try {
    return z.fromJSONSchema(schema as never);
  } catch {
    return z.unknown();
  }
}

function portsObject(ports: readonly PortSpec[]): z.ZodObject {
  return z.looseObject(
    Object.fromEntries(
      ports.map((p) => [p.name, p.required ? fromJson(p.schema) : fromJson(p.schema).optional()]),
    ),
  );
}

/** A node definition built from a recorded manifest whose execution happens in `host`. */
export function manifestDefinition(
  m: NodeManifest,
  host: PluginHost,
  pool: string,
): AnyNodeDefinition {
  const def = {
    id: m.id,
    version: m.version,
    metadata: m.metadata,
    configSchema: fromJson(m.configSchema) as unknown as z.ZodObject,
    inputSchema: portsObject(m.inputs),
    outputSchema: portsObject(m.outputs),
    controlPorts: m.controlPorts,
    portRules: m.portRules,
    credentials: m.credentials,
    capabilities: m.capabilities,
    idempotency: m.idempotency,
    pool,
    ...(m.decision ? { decision: m.decision } : {}),
    execute: (ctx, input) => host.execute(def, ctx as never, input as JsonObject),
  } as AnyNodeDefinition;
  return def;
}

async function recordFailure(db: Database, row: PluginRow, message: string): Promise<void> {
  await db.system((tx) =>
    tx
      .update(plugins)
      .set({ status: "error", error: message.slice(0, 2000) })
      .where(eq(plugins.id, row.id)),
  );
}

/** Loads every enabled npm/local plugin; failures are recorded on their rows. */
export async function loadInstalledPlugins(o: InstalledPluginsOptions): Promise<InstalledPlugins> {
  const rows = await o.db.system((tx) =>
    tx
      .select()
      .from(plugins)
      .where(and(eq(plugins.status, "enabled"), inArray(plugins.source, ["npm", "local"])))
      .orderBy(plugins.installedAt),
  );
  const packages: NodePackage[] = [];
  const hosts: PluginHost[] = [];
  const owner = new Map<string, string>(); // node key → package@version that provides it
  const byPackage = new Map<string, PluginHost>(); // package@version → host (shared by workspaces)
  for (const row of rows) {
    const label = `${row.packageName}@${row.version}`;
    try {
      const clash = row.manifests
        .map((m) => `${m.id}@${m.version}`)
        .find((k) => owner.has(k) && owner.get(k) !== label);
      if (clash)
        throw new PluginLoadError(
          "E_PLUGIN_LOAD",
          `node type ${clash} is already provided by ${owner.get(clash) ?? "another plugin"}`,
        );
      let host = byPackage.get(label);
      if (!host) {
        let dir: string;
        if (row.source === "local") {
          if (!row.location || !isAbsolute(row.location))
            throw new PluginLoadError(
              "E_PLUGIN_LOAD",
              "no recorded package directory; reinstall it",
            );
          dir = resolve(row.location);
        } else {
          dir = await materialize(row, o);
        }
        // the host reads (and the permission model checks) real paths
        dir = await realpath(dir);
        const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as PackageJson;
        if (pkg.name !== row.packageName)
          throw new PluginLoadError("E_PLUGIN_LOAD", `${dir} holds ${pkg.name ?? "no package"}`);
        // local directories are the operator's; only extracted packages get provided links
        await prepareDependencies(dir, pkg, row.source === "npm");
        host = new PluginHost({
          packageName: row.packageName,
          version: row.version,
          modulePath: entryOf(dir, pkg),
          packageDir: dir,
          log: o.log,
          ...(o.env ? { env: o.env } : {}),
        });
        await host.start();
        byPackage.set(label, host);
        hosts.push(host);
        const h = host;
        packages.push({
          name: row.packageName,
          version: row.version,
          sdk: "^1.0.0",
          nodes: row.manifests.map((m) => manifestDefinition(m, h, row.pool)),
        });
        for (const m of row.manifests) owner.set(`${m.id}@${m.version}`, label);
      }
      if (row.error)
        await o.db.system((tx) =>
          tx.update(plugins).set({ error: null }).where(eq(plugins.id, row.id)),
        );
      o.log.info({ plugin: label, nodes: row.manifests.length }, "installed plugin loaded");
    } catch (error) {
      const message =
        error instanceof PluginLoadError
          ? `${error.code}: ${error.message}`
          : `E_PLUGIN_LOAD: ${error instanceof Error ? error.message : String(error)}`;
      o.log.error({ plugin: label, err: message }, "installed plugin failed to load");
      await recordFailure(o.db, row, message);
    }
  }
  return { packages, hosts };
}
