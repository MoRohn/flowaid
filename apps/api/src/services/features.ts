/**
 * `GET /v1/me.features` (API.md §7): what this release ships, minus FLOWAID_FEATURES_DISABLED, then
 * runtime conditions. Keys flip to true as their packages land.
 */
import { FEATURE_KEYS } from "@flowaid/env";
import type { ApiConfig } from "../context.js";
import type { FeatureKey } from "../dto/common.js";
import type { EnabledPlugins } from "./plugins.js";

export const FEATURES_SHIPPED: ReadonlySet<FeatureKey> = new Set<FeatureKey>([
  "workflows",
  "runs",
  "human_tasks",
  "templates",
  "integrations_mcp",
  "integrations_openapi",
  "integrations_providers",
  "evaluations",
  "credentials",
  "settings_audit",
  "schedules",
  "mcp_exposures",
]);

export function featuresFor(
  config: ApiConfig,
  plugins: Pick<EnabledPlugins, "packages"> = { packages: [] },
): Record<FeatureKey, boolean> {
  const disabled = new Set(config.featuresDisabled);
  const out = {} as Record<FeatureKey, boolean>;
  for (const key of FEATURE_KEYS) out[key] = FEATURES_SHIPPED.has(key) && !disabled.has(key);
  out.oidc = config.hasOidc && !disabled.has("oidc");
  // LangChain nodes exist when the worker has registered its bundled package and it is enabled
  out.langchain =
    !disabled.has("langchain") &&
    plugins.packages.some((p) => p.name === "@flowaid/nodes-langchain");
  // Code export works in npm mode, or vendored with the packed runtime packages present.
  out.code_export =
    (config.exportMode === "npm" || config.vendorAvailable) && !disabled.has("code_export");
  return out;
}
