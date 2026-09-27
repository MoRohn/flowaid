/**
 * Bundled plugins (ARCHITECTURE.md §3.5, LANGCHAIN.md §3): node packages that ship inside the worker
 * image (`FLOWAID_BUNDLED_PLUGINS`, default `@flowaid/nodes-langchain`) and are registered at boot
 * without an install step. Each package is resolved from an allow-list (never an arbitrary
 * specifier), validated with `normalizePackage` (plugin id prefixes, duplicates), and upserted into
 * a global `plugins` row (`source = 'bundled'`, `integrity` = package version) so the API can serve
 * its manifests and `langchain:<vendor>` provider descriptors. An administrator's `disabled` status
 * on that row survives restarts: a disabled bundled plugin is recorded but not loaded.
 */
import { sql } from "drizzle-orm";
import { seedTemplates, type BuiltInTemplate, type Database } from "@flowaid/database";
import { normalizePackage, toManifest, type NodePackage } from "@flowaid/node-sdk";
import type { ProviderRegistry } from "@flowaid/providers";
import { uuidv7 } from "@flowaid/shared";
import type { WorkerLogger } from "../worker.js";

type Loader = () => Promise<{ module: Record<string, unknown>; version: string }>;

/** The packages the worker image bundles; anything else in FLOWAID_BUNDLED_PLUGINS is refused. */
export const BUNDLED_LOADERS: Readonly<Record<string, Loader>> = {
  "@flowaid/nodes-langchain": async () => {
    const module = (await import("@flowaid/nodes-langchain")) as unknown as Record<string, unknown>;
    const version = typeof module.PACKAGE_VERSION === "string" ? module.PACKAGE_VERSION : "0.0.0";
    return { module, version };
  },
};

interface PluginTemplate {
  id: string;
  category: string;
  definition: unknown;
  requiredResources: readonly unknown[];
}

/** Built-in templates a bundled package ships (seeded as global templates while it is enabled). */
export const BUNDLED_TEMPLATES: Readonly<Record<string, () => Promise<readonly PluginTemplate[]>>> =
  {
    "@flowaid/nodes-langchain": async () =>
      (await import("@flowaid/nodes-langchain/manifest")).langchainTemplates,
  };

function toBuiltIn(t: PluginTemplate): BuiltInTemplate {
  const resources = t.requiredResources as {
    kind: string;
    key: string;
    description: string;
    tools?: { name: string }[];
  }[];
  return {
    slug: t.id,
    category: t.category,
    definition: t.definition as never,
    requiredResources: {
      mcpServers: resources
        .filter((r) => r.kind === "mcp")
        .map((r) => ({
          key: r.key,
          description: r.description,
          requiredTools: (r.tools ?? []).map((x) => x.name),
        })),
      knowledgeSources: resources
        .filter((r) => r.kind === "knowledge")
        .map((r) => ({ key: r.key, description: r.description })),
    },
  };
}

export interface BundledResult {
  packages: NodePackage[];
  skipped: { name: string; reason: string }[];
}

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

async function recordRow(
  db: Database,
  pkg: NodePackage,
): Promise<"enabled" | "disabled" | "error"> {
  const manifests = pkg.nodes.map((n) => toManifest(n));
  const rows = await db.system((tx) =>
    tx.execute<{ status: "enabled" | "disabled" | "error" }>(sql`
      insert into plugins (id, workspace_id, package_name, version, source, integrity, manifests, status, pool)
      values (${uuidv7()}, null, ${pkg.name}, ${pkg.version}, 'bundled', ${pkg.version},
              ${JSON.stringify(manifests)}::jsonb, 'enabled', 'general')
      on conflict (coalesce(workspace_id, ${ZERO_UUID}::uuid), package_name) do update
        set version = excluded.version,
            integrity = excluded.integrity,
            manifests = excluded.manifests,
            source = 'bundled',
            error = null,
            status = case when plugins.status = 'disabled' then 'disabled' else 'enabled' end
      returning status`),
  );
  return [...rows][0]?.status ?? "enabled";
}

/**
 * Loads the named bundled packages. With `db`, each one is recorded in `plugins` first and only
 * loaded while its row is enabled.
 */
export async function loadBundledPlugins(
  names: readonly string[],
  opts: { db?: Database; log?: WorkerLogger } = {},
): Promise<BundledResult> {
  const out: BundledResult = { packages: [], skipped: [] };
  for (const name of names) {
    const loader = BUNDLED_LOADERS[name];
    if (!loader) {
      out.skipped.push({ name, reason: "not bundled in this worker image" });
      opts.log?.warn({ plugin: name }, "unknown bundled plugin ignored");
      continue;
    }
    const { module, version } = await loader();
    const normalized = normalizePackage(module, { name, version });
    if (!normalized.ok) {
      const reason = normalized.diagnostics.map((d) => d.message).join("; ");
      out.skipped.push({ name, reason });
      opts.log?.error({ plugin: name, reason }, "bundled plugin failed validation");
      continue;
    }
    const status = opts.db ? await recordRow(opts.db, normalized.package) : "enabled";
    if (status !== "enabled") {
      out.skipped.push({ name, reason: `plugin row is ${status}` });
      opts.log?.info({ plugin: name, status }, "bundled plugin not loaded");
      continue;
    }
    out.packages.push(normalized.package);
    const templates = BUNDLED_TEMPLATES[name];
    if (opts.db && templates) {
      const list = (await templates()).map(toBuiltIn);
      await opts.db.system((tx) => seedTemplates(tx, list));
    }
    opts.log?.info(
      { plugin: name, version, nodes: normalized.package.nodes.length },
      "bundled plugin loaded",
    );
  }
  return out;
}

/** Registers the packages' provider factories (`langchain:<vendor>`) with the registry. */
export function registerPluginProviders(
  registry: ProviderRegistry,
  packages: readonly NodePackage[],
): void {
  const known = new Set(registry.list().map((f) => `${f.kind}:${f.id}`));
  for (const pkg of packages)
    for (const factory of pkg.providers ?? []) {
      if (known.has(`${factory.kind}:${factory.id}`)) continue;
      registry.register(factory);
      known.add(`${factory.kind}:${factory.id}`);
    }
}
