/** The package manifest file (`manifest.json`): every node manifest with a stable key order. */
import { toManifest } from "@flowaid/node-sdk";
import type { NodeManifest } from "@flowaid/workflow-core";
import { LANGCHAIN_NODES, PACKAGE_VERSION, nodePackage } from "./index.js";

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

export function langchainManifests(): NodeManifest[] {
  return LANGCHAIN_NODES.map((def) => toManifest(def)).sort((a, b) => a.id.localeCompare(b.id));
}

/** Provider descriptors the API serves from the bundled plugin row (`GET /v1/providers`). */
export function providerDescriptors(): {
  id: string;
  kind: string;
  credentialType: string | null;
}[] {
  return (nodePackage.providers ?? [])
    .map((p) => ({ id: p.id, kind: p.kind, credentialType: p.credentialType ?? null }))
    .sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
}

export function buildManifest(): string {
  return `${JSON.stringify(
    sortKeys({
      package: "@flowaid/nodes-langchain",
      version: PACKAGE_VERSION,
      nodes: langchainManifests(),
      providers: providerDescriptors(),
    }),
    null,
    2,
  )}\n`;
}
