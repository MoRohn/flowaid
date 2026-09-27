/**
 * Package specs (`@acme/nodes-crm`, `@acme/nodes-crm@^1.2.0`, `flowaid-node-weather@2.0.1`) and
 * the allow-list (`FLOWAID_PLUGIN_ALLOWED_SCOPES`: npm scopes, exact names, or `*`).
 */
import { isValidRange } from "./semver.js";

const NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export interface PluginSpec {
  name: string;
  /** a semver range or exact version; `latest` when omitted */
  range: string;
}

export function isPackageName(name: string): boolean {
  return name.length <= 214 && NAME_RE.test(name);
}

/** Parses `name[@range]`; throws a message the user can act on. */
export function parsePluginSpec(spec: string): PluginSpec {
  const text = spec.trim();
  const at = text.lastIndexOf("@");
  const [name, range] = at > 0 ? [text.slice(0, at), text.slice(at + 1)] : [text, "latest"];
  if (!isPackageName(name)) throw new Error(`"${name}" is not an npm package name`);
  if (range !== "latest" && !isValidRange(range))
    throw new Error(`"${range}" is not a version or semver range`);
  return { name, range };
}

/** The npm scope of a package (`@acme`), or null for an unscoped name. */
export function scopeOf(name: string): string | null {
  return name.startsWith("@") ? name.slice(0, name.indexOf("/")) : null;
}

/** Whether the allow-list permits installing the package. */
export function isAllowed(name: string, allowList: readonly string[]): boolean {
  const scope = scopeOf(name);
  return allowList.some(
    (entry) => entry === "*" || entry === name || (scope !== null && entry === scope),
  );
}
