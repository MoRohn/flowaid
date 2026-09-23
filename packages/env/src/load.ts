/**
 * `loadEnv()`: parse an environment into a typed {@link Env} or fail with one readable
 * error that lists every missing or invalid variable.
 */

import { err, ok, type Result } from "@flowaid/shared";

import {
  ENV_VAR_DOCS,
  SECRET_ENV_KEYS,
  SECRET_REF_NAME_RE,
  SECRET_REF_PREFIX,
  type EnvVarName,
} from "./docs.js";
import { EnvSchema, crossFieldIssues, type EnvVars } from "./schema.js";

/** Feature flags derived from which optional variables are present. */
export interface EnvFlags {
  /** `NODE_ENV === "production"`. */
  readonly isProduction: boolean;
  /** `NODE_ENV === "development"`. */
  readonly isDevelopment: boolean;
  /** `NODE_ENV === "test"`. */
  readonly isTest: boolean;
  /** `REDIS_URL` is set: BullMQ queues, Redis event bus and shared rate limits. */
  readonly hasRedis: boolean;
  /** All four S3 variables are set: artifacts go to object storage. */
  readonly hasS3: boolean;
  /** `TYPESAFE_API_KEY` is set: the TypeSafe decision provider is available. */
  readonly hasTypeSafe: boolean;
  /** `OPENAI_API_KEY` is set. */
  readonly hasOpenAI: boolean;
  /** `ANTHROPIC_API_KEY` is set. */
  readonly hasAnthropic: boolean;
  /** `OLLAMA_HOST` is set. */
  readonly hasOllama: boolean;
  /** At least one generation provider (OpenAI, Anthropic or Ollama) is configured. */
  readonly hasGenerationProvider: boolean;
  /** `OTEL_EXPORTER_OTLP_ENDPOINT` is set: spans and metrics are exported. */
  readonly hasOtel: boolean;
  /** `PROMETHEUS_PORT` is set: the `/metrics` listener is started. */
  readonly hasPrometheus: boolean;
  /** Explicit ES256 JWT keys are configured (otherwise a pair is generated). */
  readonly hasJwtKeys: boolean;
  /** The master key comes from `FLOWAID_MASTER_KEY` rather than the key file. */
  readonly hasMasterKeyInEnv: boolean;
  /**
   * The file master-key provider may create a missing `FLOWAID_MASTER_KEY_FILE`: always
   * outside production, in production only with `FLOWAID_MASTER_KEY_AUTOGENERATE=true`.
   */
  readonly masterKeyAutogenerate: boolean;
  /** First-boot owner credentials are configured. */
  readonly hasAdminBootstrap: boolean;
  /** `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` are set: single sign-on is on. */
  readonly hasOidc: boolean;
  /** `DATABASE_ADMIN_URL` is set: migrations use the owner connection. */
  readonly hasDatabaseAdminUrl: boolean;
  /** `FLOWAID_PROVIDER_FIXTURES` is `record` or `replay`. */
  readonly providerFixturesEnabled: boolean;
  /** `MCP_STDIO_ENABLED` is true. */
  readonly mcpStdioEnabled: boolean;
  /** `SANDBOX_MODE === "container"`. */
  readonly sandboxIsContainer: boolean;
}

/** Values of the `FLOWAID_SECRET_<NAME>` family, keyed by full variable name. */
export type SecretRefs = Readonly<Record<string, string>>;

/**
 * The typed environment: every variable, the `FLOWAID_SECRET_<NAME>` values and the derived
 * {@link EnvFlags}. `JSON.stringify(env)` yields {@link redactEnv} so an accidental
 * serialisation never prints a secret.
 */
export type Env = Readonly<EnvVars> & {
  readonly flags: EnvFlags;
  readonly secretRefs: SecretRefs;
  readonly toJSON: () => Record<string, string>;
};

/** What `loadEnv` reads: any string map, usually `process.env`. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** One problem found while loading the environment. */
export interface EnvIssue {
  /** Variable name, e.g. `DATABASE_URL`. */
  readonly variable: string;
  /** What is wrong, in a sentence that reads after the variable name. */
  readonly message: string;
  /** The raw value that was rejected; omitted for secrets and for missing variables. */
  readonly received?: string;
}

/**
 * Thrown by {@link loadEnv} when the environment is missing or invalid. `message` lists every
 * issue on its own line; `issues` carries them structured for programmatic use.
 */
export class EnvError extends Error {
  override readonly name = "EnvError";

  constructor(readonly issues: readonly EnvIssue[]) {
    super(formatIssues(issues));
  }
}

function formatIssues(issues: readonly EnvIssue[]): string {
  const count = issues.length;
  const lines = issues.map((issue) => {
    const received =
      issue.received === undefined ? "" : ` (received ${JSON.stringify(issue.received)})`;
    return `  - ${issue.variable} ${issue.message}${received}`;
  });
  return [
    `Invalid environment (${String(count)} problem${count === 1 ? "" : "s"}):`,
    ...lines,
    "See packages/env/README.md or .env.example for every variable.",
  ].join("\n");
}

function isEnvVarName(name: string): name is EnvVarName {
  return Object.prototype.hasOwnProperty.call(ENV_VAR_DOCS, name);
}

/**
 * Drops empty strings (an unset line in a `.env` file arrives as `""`) and non-string
 * values so that "unset" means the same thing whatever the source.
 */
function clean(source: EnvSource): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" && value.trim() !== "") {
      out[key] = value;
    }
  }
  return out;
}

/** Collects the `FLOWAID_SECRET_<NAME>` family, reporting names that do not fit the pattern. */
function collectSecretRefs(raw: Record<string, string>): {
  refs: Record<string, string>;
  issues: EnvIssue[];
} {
  const refs: Record<string, string> = {};
  const issues: EnvIssue[] = [];
  for (const name of Object.keys(raw).sort()) {
    if (!name.startsWith(SECRET_REF_PREFIX)) {
      continue;
    }
    if (!SECRET_REF_NAME_RE.test(name)) {
      issues.push({
        variable: name,
        message: `is not a valid secret reference name (must match ${SECRET_REF_NAME_RE.source})`,
      });
      continue;
    }
    const value = raw[name];
    if (value !== undefined) {
      refs[name] = value;
    }
  }
  return { refs, issues };
}

/** Computes the {@link EnvFlags} for parsed variables. */
export function deriveFlags(vars: EnvVars): EnvFlags {
  const hasOpenAI = vars.OPENAI_API_KEY !== undefined;
  const hasAnthropic = vars.ANTHROPIC_API_KEY !== undefined;
  const hasOllama = vars.OLLAMA_HOST !== undefined;
  const isProduction = vars.NODE_ENV === "production";
  return {
    isProduction,
    isDevelopment: vars.NODE_ENV === "development",
    isTest: vars.NODE_ENV === "test",
    hasRedis: vars.REDIS_URL !== undefined,
    hasS3:
      vars.S3_ENDPOINT !== undefined &&
      vars.S3_BUCKET !== undefined &&
      vars.S3_ACCESS_KEY !== undefined &&
      vars.S3_SECRET_KEY !== undefined,
    hasTypeSafe: vars.TYPESAFE_API_KEY !== undefined,
    hasOpenAI,
    hasAnthropic,
    hasOllama,
    hasGenerationProvider: hasOpenAI || hasAnthropic || hasOllama,
    hasOtel: vars.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined,
    hasPrometheus: vars.PROMETHEUS_PORT !== undefined,
    hasJwtKeys:
      vars.FLOWAID_JWT_PRIVATE_KEY !== undefined && vars.FLOWAID_JWT_PUBLIC_KEY !== undefined,
    hasMasterKeyInEnv: vars.FLOWAID_MASTER_KEY !== undefined,
    masterKeyAutogenerate: !isProduction || vars.FLOWAID_MASTER_KEY_AUTOGENERATE,
    hasAdminBootstrap:
      vars.FLOWAID_ADMIN_EMAIL !== undefined && vars.FLOWAID_ADMIN_PASSWORD !== undefined,
    hasOidc:
      vars.OIDC_ISSUER !== undefined &&
      vars.OIDC_CLIENT_ID !== undefined &&
      vars.OIDC_CLIENT_SECRET !== undefined,
    hasDatabaseAdminUrl: vars.DATABASE_ADMIN_URL !== undefined,
    providerFixturesEnabled: vars.FLOWAID_PROVIDER_FIXTURES !== "off",
    mcpStdioEnabled: vars.MCP_STDIO_ENABLED,
    sandboxIsContainer: vars.SANDBOX_MODE === "container",
  };
}

/** Placeholder written in place of a secret value by {@link redactEnv}. */
export const REDACTED_PLACEHOLDER = "<set>";

function stringifyValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyValue(item) ?? "").join(",");
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  if (typeof value === "bigint" || typeof value === "symbol") {
    return value.toString();
  }
  return typeof value;
}

/**
 * The environment as a string map that is safe to log: every set variable in schema order,
 * with the value of each secret (and of every `FLOWAID_SECRET_<NAME>`) replaced by
 * {@link REDACTED_PLACEHOLDER}. Unset variables are omitted; `flags` are not variables and
 * are omitted too.
 */
export function redactEnv(
  env: Readonly<EnvVars> & { readonly secretRefs?: SecretRefs },
): Record<string, string> {
  const schemaKeys = new Set<string>(Object.keys(EnvSchema.shape));
  const secretNames = new Set<string>(SECRET_ENV_KEYS);
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(env)) {
    if (!schemaKeys.has(key)) {
      continue;
    }
    const value = stringifyValue(raw);
    if (value === undefined) {
      continue;
    }
    out[key] = secretNames.has(key) ? REDACTED_PLACEHOLDER : value;
  }
  for (const name of Object.keys(env.secretRefs ?? {})) {
    out[name] = REDACTED_PLACEHOLDER;
  }
  return out;
}

/**
 * Every secret value present in the environment (the variables documented as secrets and
 * the `FLOWAID_SECRET_<NAME>` family), plus the password component of secret URLs, so a
 * `Redactor` can learn them all. Deduplicated; order is not significant.
 */
export function secretEnvValues(
  env: Readonly<EnvVars> & { readonly secretRefs?: SecretRefs },
): string[] {
  const values = new Set<string>();
  const add = (value: string): void => {
    if (value !== "") {
      values.add(value);
    }
  };
  const secretNames = new Set<string>(SECRET_ENV_KEYS);
  for (const [key, value] of Object.entries(env)) {
    if (!secretNames.has(key) || typeof value !== "string") {
      continue;
    }
    add(value);
    try {
      const url = new URL(value);
      if (url.password !== "") {
        add(url.password);
        add(decodeURIComponent(url.password));
      }
    } catch {
      // not a URL: the whole value is the secret
    }
  }
  for (const value of Object.values(env.secretRefs ?? {})) {
    add(value);
  }
  return [...values];
}

/**
 * Parses `source` without throwing. Returns every problem at once so an operator can fix a
 * misconfigured deployment in one pass instead of one variable per restart.
 */
export function safeLoadEnv(source: EnvSource = process.env): Result<Env, EnvError> {
  const raw = clean(source);
  const parsed = EnvSchema.safeParse(raw);
  const refs = collectSecretRefs(raw);
  if (parsed.success && refs.issues.length === 0) {
    const vars: EnvVars = parsed.data;
    const secretRefs: SecretRefs = Object.freeze(refs.refs);
    const flags = Object.freeze(deriveFlags(vars));
    const env: Env = Object.freeze({
      ...vars,
      secretRefs,
      flags,
      toJSON(): Record<string, string> {
        return redactEnv({ ...vars, secretRefs });
      },
    });
    return ok(env);
  }
  const issues: EnvIssue[] = parsed.success
    ? []
    : parsed.error.issues.map((issue): EnvIssue => {
        const first = issue.path[0];
        const variable = typeof first === "string" ? first : "(environment)";
        const received = raw[variable];
        const doc = isEnvVarName(variable) ? ENV_VAR_DOCS[variable] : undefined;
        if (received === undefined && doc?.required === true && issue.code === "invalid_type") {
          return {
            variable,
            message: `is required: ${doc.description} (example: ${doc.example})`,
          };
        }
        const message = issue.message.startsWith("Invalid input")
          ? `is invalid: ${issue.message}`
          : issue.message;
        if (received !== undefined && doc?.secret === false) {
          return { variable, message, received };
        }
        return { variable, message };
      });
  if (!parsed.success) {
    // Zod skips object-level checks when a field failed; run the cross-field rules on the
    // raw source as well so every problem is reported in one pass.
    for (const issue of crossFieldIssues(raw)) {
      issues.push({ variable: issue.path, message: issue.message });
    }
  }
  issues.push(...refs.issues);
  return err(new EnvError(dedupe(issues)));
}

function dedupe(issues: readonly EnvIssue[]): EnvIssue[] {
  const seen = new Set<string>();
  const out: EnvIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.variable}\u0000${issue.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(issue);
    }
  }
  return out;
}

/**
 * Parses `source` (default `process.env`) into a typed, frozen {@link Env}. Throws
 * {@link EnvError} whose message lists every missing or invalid variable. This is the only
 * sanctioned way to read configuration: no other package touches `process.env`.
 */
export function loadEnv(source: EnvSource = process.env): Env {
  const result = safeLoadEnv(source);
  if (result.ok) {
    return result.value;
  }
  throw result.error;
}
