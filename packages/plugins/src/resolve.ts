/**
 * Resolving an install request to something the platform can record (ARCHITECTURE.md §3.5):
 * the allow-list, the discovery contract (keyword `flowaid-node` and the `flowaid` package.json
 * field), the SDK range, the tarball integrity, and the node manifests the package ships as data
 * (`flowaid.manifest`, default `manifest.json`), validated and checked for the package's id prefix.
 * Plugin code is never loaded: the worker loads it later from the same, verified tarball.
 */
import { NodeManifestSchema, type NodeManifest } from "@flowaid/workflow-core";
import { DISCOVERY_KEYWORD, type PackumentVersion, type RegistryClient } from "./registry.js";
import { maxSatisfying, satisfies } from "./semver.js";
import { isAllowed, parsePluginSpec } from "./spec.js";
import { readTarball, verifyIntegrity, type TarEntry } from "./tarball.js";

/** The node SDK version this platform runs (`@flowaid/node-sdk`); a package's `flowaid.sdk` range must accept it. */
export const PLATFORM_SDK_VERSION = "0.8.0";

export type PluginProblemCode =
  | "E_PLUGIN_NOT_ALLOWED"
  | "E_PLUGIN_NOT_FOUND"
  | "E_PLUGIN_NOT_A_PLUGIN"
  | "E_PLUGIN_SDK_RANGE"
  | "E_PLUGIN_INTEGRITY"
  | "E_PLUGIN_MANIFEST"
  | "E_PLUGIN_ID_PREFIX"
  | "E_PLUGIN_LOCAL_DISABLED";

/** A resolution failure with a stable code (the API maps it onto 400/403/404/422). */
export class PluginProblem extends Error {
  constructor(
    readonly code: PluginProblemCode,
    message: string,
  ) {
    super(message);
    this.name = "PluginProblem";
  }
}

export interface ResolvedPlugin {
  name: string;
  version: string;
  description: string;
  /** SRI of the tarball the manifests were read from */
  integrity: string;
  tarball: string;
  sdk: string;
  manifests: NodeManifest[];
}

export interface ResolveOptions {
  registry: RegistryClient;
  allowList: readonly string[];
  /** `--frozen`: the exact integrity the caller pinned; a different tarball is refused */
  expectedIntegrity?: string;
}

/** The node type id prefix a package owns (mirrors `@flowaid/node-sdk` `idPrefixFor`). */
export function idPrefixFor(packageName: string): string {
  return packageName.startsWith("@flowaid/") ? "flowaid." : `${packageName}.`;
}

/** Reads and validates the manifests a package ships; checks the id prefix. */
export function manifestsFromFiles(
  name: string,
  files: readonly TarEntry[],
  manifestPath = "manifest.json",
): NodeManifest[] {
  const file = files.find((f) => f.path === manifestPath.replace(/^\.?\//, ""));
  if (!file)
    throw new PluginProblem(
      "E_PLUGIN_MANIFEST",
      `${name} has no ${manifestPath}: build it with toManifest (the create-flowaid-node scaffold does) and publish it`,
    );
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(file.data));
  } catch {
    throw new PluginProblem("E_PLUGIN_MANIFEST", `${manifestPath} of ${name} is not JSON`);
  }
  const list = Array.isArray(raw) ? raw : (raw as { nodes?: unknown }).nodes;
  if (!Array.isArray(list) || list.length === 0)
    throw new PluginProblem("E_PLUGIN_MANIFEST", `${manifestPath} of ${name} lists no nodes`);
  const prefix = idPrefixFor(name);
  const manifests: NodeManifest[] = [];
  for (const [i, entry] of list.entries()) {
    const parsed = NodeManifestSchema.safeParse(entry);
    if (!parsed.success)
      throw new PluginProblem(
        "E_PLUGIN_MANIFEST",
        `node ${i} of ${name}: ${parsed.error.issues[0]?.message ?? "invalid manifest"} at ${parsed.error.issues[0]?.path.join(".") ?? ""}`,
      );
    if (!parsed.data.id.startsWith(prefix))
      throw new PluginProblem(
        "E_PLUGIN_ID_PREFIX",
        `node type ${parsed.data.id} of ${name} must start with "${prefix}"`,
      );
    manifests.push(parsed.data);
  }
  return manifests;
}

/** Checks the discovery contract of a published version. */
export function checkPluginVersion(meta: PackumentVersion): { sdk: string; manifestPath: string } {
  if (!(meta.keywords ?? []).includes(DISCOVERY_KEYWORD) || !meta.flowaid)
    throw new PluginProblem(
      "E_PLUGIN_NOT_A_PLUGIN",
      `${meta.name}@${meta.version} is not a FlowAId node package: it needs the "${DISCOVERY_KEYWORD}" keyword and a "flowaid" field in package.json`,
    );
  const sdk = meta.flowaid.sdk ?? "^1.0.0";
  if (!satisfies(PLATFORM_SDK_VERSION, sdk))
    throw new PluginProblem(
      "E_PLUGIN_SDK_RANGE",
      `${meta.name}@${meta.version} targets node SDK ${sdk}; this platform runs ${PLATFORM_SDK_VERSION}`,
    );
  return { sdk, manifestPath: meta.flowaid.manifest ?? "manifest.json" };
}

/** Resolves `name[@range]` against the registry and reads the manifests from the verified tarball. */
export async function resolvePlugin(spec: string, o: ResolveOptions): Promise<ResolvedPlugin> {
  const { name, range } = parsePluginSpec(spec);
  if (!isAllowed(name, o.allowList))
    throw new PluginProblem(
      "E_PLUGIN_NOT_ALLOWED",
      `${name} is not on the plugin allow-list (FLOWAID_PLUGIN_ALLOWED_SCOPES: ${o.allowList.join(", ")})`,
    );
  let packument;
  try {
    packument = await o.registry.packument(name);
  } catch (error) {
    if ((error as { status?: number }).status === 404)
      throw new PluginProblem("E_PLUGIN_NOT_FOUND", `${name} is not in ${o.registry.registry}`);
    throw error;
  }
  const version =
    range === "latest"
      ? packument["dist-tags"].latest
      : (packument["dist-tags"][range] ?? maxSatisfying(Object.keys(packument.versions), range));
  const meta = version ? packument.versions[version] : undefined;
  if (!version || !meta)
    throw new PluginProblem("E_PLUGIN_NOT_FOUND", `no version of ${name} matches ${range}`);
  const { sdk, manifestPath } = checkPluginVersion(meta);
  const published = meta.dist.integrity;
  if (!published)
    throw new PluginProblem(
      "E_PLUGIN_INTEGRITY",
      `${name}@${version} publishes no sha512 integrity; republish it with a current npm`,
    );
  if (o.expectedIntegrity && o.expectedIntegrity !== published)
    throw new PluginProblem(
      "E_PLUGIN_INTEGRITY",
      `${name}@${version} integrity ${published} differs from the pinned ${o.expectedIntegrity}`,
    );
  const data = await o.registry.tarball(meta.dist.tarball);
  if (!verifyIntegrity(data, published))
    throw new PluginProblem(
      "E_PLUGIN_INTEGRITY",
      `the tarball of ${name}@${version} does not match its published integrity`,
    );
  let files: TarEntry[];
  try {
    files = readTarball(data);
  } catch (error) {
    throw new PluginProblem("E_PLUGIN_MANIFEST", `${name}@${version}: ${(error as Error).message}`);
  }
  return {
    name,
    version,
    description: meta.description ?? packument.description ?? "",
    integrity: published,
    tarball: meta.dist.tarball,
    sdk,
    manifests: manifestsFromFiles(name, files, manifestPath),
  };
}
