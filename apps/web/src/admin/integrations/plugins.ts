/** Plugin rows as the API returns them (`GET /v1/plugins`, `/v1/plugins/search`) and pure helpers. */
export interface PluginRow {
  id: string;
  packageName: string;
  version: string;
  source: "npm" | "local" | "bundled";
  integrity: string | null;
  status: "enabled" | "disabled" | "error";
  pool: string;
  error: string | null;
  scope: "global" | "workspace";
  nodes: { id: string; name: string; category: string; version: string }[];
  installedAt: string;
}

export interface PluginSearchRow {
  name: string;
  version: string;
  description: string;
  keywords: string[];
  publisher: string | null;
  date: string | null;
  links: { npm?: string; repository?: string; homepage?: string };
  score: number;
  allowed: boolean;
  installed: string | null;
}

/** Bundled plugins ship with the platform and are read-only here. */
export const isReadOnly = (p: PluginRow) => p.source === "bundled" || p.scope === "global";

/** `name[@range]` → the install body, or a message saying what is wrong. */
export function parseSpec(spec: string): { packageName: string; version: string } | string {
  const text = spec.trim();
  if (!text) return "Enter a package name";
  const at = text.lastIndexOf("@");
  const [name, version] = at > 0 ? [text.slice(0, at), text.slice(at + 1)] : [text, "latest"];
  if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name))
    return `"${name}" is not an npm package name`;
  if (!version) return "Enter a version after @, or leave it out for the latest";
  return { packageName: name, version };
}

/** What the install button says for a search result. */
export function searchAction(r: PluginSearchRow): {
  label: string;
  disabled: boolean;
  reason?: string;
} {
  if (r.installed === r.version) return { label: "Installed", disabled: true };
  if (!r.allowed)
    return { label: "Install", disabled: true, reason: "Not on the server's plugin allow-list" };
  return { label: r.installed ? `Upgrade to ${r.version}` : "Install", disabled: false };
}
