/**
 * Plugin loading (ARCHITECTURE.md §3.5). A package module may export a `nodePackage`
 * (`definePackage(...)`), a single `node`, or a `nodes` array; the last two are wrapped into a
 * NodePackage named after `package.json.name`. Node type ids must carry the package's prefix:
 * `@community/slack` owns `@community/slack.*`, and `flowaid.*` belongs to `@flowaid/*` packages.
 */
import type { Diagnostic } from "@flowaid/workflow-core";
import type { AnyNodeDefinition, NodePackage } from "./types.js";

export interface PackageJsonInfo {
  name: string;
  version: string;
}

export type NormalizeResult =
  { ok: true; package: NodePackage } | { ok: false; diagnostics: Diagnostic[] };

const DEFAULT_SDK_RANGE = "^1.0.0";

function isDefinition(value: unknown): value is AnyNodeDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { execute?: unknown }).execute === "function"
  );
}

function isPackage(value: unknown): value is NodePackage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { name?: unknown }).name === "string" &&
    Array.isArray((value as { nodes?: unknown }).nodes)
  );
}

/** The node type id prefix a package owns. */
export function idPrefixFor(packageName: string): string {
  return packageName.startsWith("@flowaid/") ? "flowaid." : `${packageName}.`;
}

export function normalizePackage(
  moduleExports: Record<string, unknown>,
  pkg: PackageJsonInfo,
): NormalizeResult {
  let nodePackage: NodePackage;
  if (isPackage(moduleExports.nodePackage)) {
    nodePackage = moduleExports.nodePackage;
  } else if (isDefinition(moduleExports.node)) {
    nodePackage = {
      name: pkg.name,
      version: pkg.version,
      nodes: [moduleExports.node],
      sdk: DEFAULT_SDK_RANGE,
    };
  } else if (Array.isArray(moduleExports.nodes) && moduleExports.nodes.every(isDefinition)) {
    nodePackage = {
      name: pkg.name,
      version: pkg.version,
      nodes: moduleExports.nodes,
      sdk: DEFAULT_SDK_RANGE,
    };
  } else {
    return {
      ok: false,
      diagnostics: [
        {
          code: "E_SCHEMA",
          severity: "error",
          message: `${pkg.name} exports none of nodePackage, node or nodes`,
          location: {},
        },
      ],
    };
  }
  const prefix = idPrefixFor(nodePackage.name);
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const node of nodePackage.nodes) {
    if (!node.id.startsWith(prefix)) {
      diagnostics.push({
        code: "E_PLUGIN_ID_PREFIX",
        severity: "error",
        message: `Node type '${node.id}' in ${nodePackage.name} must start with '${prefix}'`,
        location: {},
      });
    }
    const key = `${node.id}@${node.version}`;
    if (seen.has(key)) {
      diagnostics.push({
        code: "E_DUPLICATE_NODE_ID",
        severity: "error",
        message: `${nodePackage.name} defines ${key} twice`,
        location: {},
      });
    }
    seen.add(key);
  }
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, package: nodePackage };
}
