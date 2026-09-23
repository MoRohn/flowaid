/** Test helpers: fixture loading and a catalog over the workflow-core fixture manifests. */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeManifestSchema, type NodeCatalog, type NodeManifest } from "@flowaid/workflow-core";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CORE_FIXTURES = join(HERE, "../../../workflow-core/fixtures");

export function readJson(...parts: string[]): unknown {
  return JSON.parse(readFileSync(join(CORE_FIXTURES, ...parts), "utf8"));
}

export function catalogOf(manifests: readonly NodeManifest[]): NodeCatalog {
  const latest = (id: string) =>
    manifests.filter((m) => m.id === id).sort((a, b) => (a.version < b.version ? 1 : -1))[0];
  return {
    get: (id, version) =>
      version ? manifests.find((m) => m.id === id && m.version === version) : latest(id),
    list: () => [...manifests],
  };
}

export const FIXTURE_MANIFESTS: NodeManifest[] = readdirSync(join(CORE_FIXTURES, "manifests"))
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => NodeManifestSchema.parse(readJson("manifests", f)));

export const fixtureCatalog = (): NodeCatalog => catalogOf(FIXTURE_MANIFESTS);

/** Paths where two JSON values differ (for readable golden failures). */
export function jsonDiff(a: unknown, b: unknown, path = ""): string[] {
  if (a === b) return [];
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    return [
      `${path || "/"}: ${JSON.stringify(a)?.slice(0, 160)} ≠ ${JSON.stringify(b)?.slice(0, 160)}`,
    ];
  }
  if (Array.isArray(a) !== Array.isArray(b)) return [`${path}: array vs object`];
  const keys = new Set([...Object.keys(a), ...Object.keys(b as object)]);
  const out: string[] = [];
  for (const key of keys) {
    out.push(
      ...jsonDiff(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        `${path}/${key}`,
      ),
    );
  }
  return out;
}
