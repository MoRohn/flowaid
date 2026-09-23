/**
 * `@flowaid/env` — the typed runtime configuration of flowaid.
 *
 * The only package that reads `process.env`. Call {@link loadEnv} once at process start;
 * pass the resulting {@link Env} (or the slices a component needs) down explicitly.
 */

export {
  ENV_COMPOSE_ONLY_VAR_NAMES,
  ENV_COMPOSE_REQUIRED_VAR_NAMES,
  ENV_GROUPS,
  ENV_GROUP_TITLES,
  ENV_PARSED_VAR_NAMES,
  ENV_VAR_DOCS,
  ENV_VAR_NAMES,
  EXPORT_MODES,
  FEATURE_KEYS,
  LOG_LEVELS,
  NODE_ENVS,
  PROVIDER_FIXTURE_MODES,
  SANDBOX_MODES,
  SECRET_ENV_KEYS,
  SECRET_REF_NAME_RE,
  SECRET_REF_PREFIX,
  WORKER_POOLS,
  envVarDoc,
  isDocumentedEnvName,
} from "./docs.js";
export type { EnvGroup, EnvVarDoc, EnvVarName, FeatureKey } from "./docs.js";

export {
  ADMIN_PASSWORD_DENY_LIST,
  ADMIN_PASSWORD_MAX_LENGTH,
  ADMIN_PASSWORD_MIN_LENGTH,
  ENV_SCHEMA_KEYS,
  EnvSchema,
  crossFieldIssues,
  isLoopbackHost,
  siteOf,
} from "./schema.js";
export type { CrossFieldIssue, EnvVars, StdioCommandRule, TrustProxy } from "./schema.js";

export {
  EnvError,
  REDACTED_PLACEHOLDER,
  deriveFlags,
  loadEnv,
  redactEnv,
  safeLoadEnv,
  secretEnvValues,
} from "./load.js";
export type { Env, EnvFlags, EnvIssue, EnvSource, SecretRefs } from "./load.js";

export {
  README_TABLE_END,
  README_TABLE_START,
  injectReadmeTable,
  renderEnvExample,
  renderReadmeTable,
} from "./render.js";
