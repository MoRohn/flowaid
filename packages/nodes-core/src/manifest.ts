/** The package manifest file (`dist/manifest.json`): all core node manifests with a stable key order. */
import { toManifest } from "@flowaid/node-sdk";
import type { NodeManifest } from "@flowaid/workflow-core";
import { CORE_NODES } from "./index.js";

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  return value;
}

export function coreManifests(): NodeManifest[] {
  return CORE_NODES.map((def) => toManifest(def)).sort((a, b) => a.id.localeCompare(b.id));
}

export function buildManifest(): string {
  return `${JSON.stringify(sortKeys({ package: "@flowaid/nodes-core", version: "0.1.0", nodes: coreManifests() }), null, 2)}\n`;
}
