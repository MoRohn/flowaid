/**
 * `GET /v1/me.features` (API.md §7): what this release ships, minus FLOWAID_FEATURES_DISABLED, then
 * runtime conditions. Keys flip to true as their packages land.
 */
import { FEATURE_KEYS } from "@flowaid/env";
import type { ApiConfig } from "../context.js";
import type { FeatureKey } from "../dto/common.js";

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
]);

export function featuresFor(config: ApiConfig): Record<FeatureKey, boolean> {
  const disabled = new Set(config.featuresDisabled);
  const out = {} as Record<FeatureKey, boolean>;
  for (const key of FEATURE_KEYS) out[key] = FEATURES_SHIPPED.has(key) && !disabled.has(key);
  out.oidc = config.hasOidc && !disabled.has("oidc");
  return out;
}
