/**
 * Zod 4 schema for the flowaid environment.
 *
 * Every field is built from its entry in {@link ENV_VAR_DOCS}: the documented default is the
 * parsed default, the documented `values` are the accepted values and a documented
 * `required: true` is a required field. A mismatch between the builder used here and the
 * documentation (for example a default on a variable documented as required) throws at
 * module load, which the test suite turns into a failing test.
 */

import { isIP } from "node:net";

import { z } from "zod";

import {
  ENV_PARSED_VAR_NAMES,
  ENV_VAR_DOCS,
  EXPORT_MODES,
  FEATURE_KEYS,
  LOG_LEVELS,
  NODE_ENVS,
  PROVIDER_FIXTURE_MODES,
  SANDBOX_MODES,
  WORKER_POOLS,
  type EnvVarDoc,
  type EnvVarName,
} from "./docs.js";

class EnvSchemaDefinitionError extends Error {
  override readonly name = "EnvSchemaDefinitionError";
}

function docOf(name: EnvVarName): EnvVarDoc {
  const doc = ENV_VAR_DOCS[name];
  if (doc.pattern === true) {
    throw new EnvSchemaDefinitionError(`${name} is a documented family, not a schema field`);
  }
  if (doc.composeOnly === true) {
    throw new EnvSchemaDefinitionError(
      `${name} is read by docker compose only, not a schema field`,
    );
  }
  return doc;
}

function requireDefault(name: EnvVarName): string {
  const doc = docOf(name);
  if (doc.required || doc.default === undefined) {
    throw new EnvSchemaDefinitionError(
      `${name} is built with a default but documented without one`,
    );
  }
  return doc.default;
}

function requireOptional(name: EnvVarName): void {
  const doc = docOf(name);
  if (doc.required || doc.default !== undefined) {
    throw new EnvSchemaDefinitionError(
      `${name} is built as optional but documented as required or defaulted`,
    );
  }
}

function requireRequired(name: EnvVarName): void {
  const doc = docOf(name);
  if (!doc.required || doc.default !== undefined) {
    throw new EnvSchemaDefinitionError(`${name} is built as required but documented otherwise`);
  }
}

/** A non-empty, trimmed string. */
const nonEmpty = z.string().trim().min(1, "must not be empty");

// ── strings ───────────────────────────────────────────────────────────────────────

function stringWithDefault(name: EnvVarName): z.ZodType<string> {
  return nonEmpty.default(nonEmpty.parse(requireDefault(name)));
}

function optionalString(name: EnvVarName): z.ZodType<string | undefined> {
  requireOptional(name);
  return nonEmpty.optional();
}

// ── integers ──────────────────────────────────────────────────────────────────────

interface IntRange {
  readonly min: number;
  readonly max: number;
}

function intSchema({ min, max }: IntRange): z.ZodType<number, string> {
  return z
    .string()
    .trim()
    .regex(/^-?\d+$/, `must be an integer between ${String(min)} and ${String(max)}`)
    .transform(Number)
    .pipe(
      z
        .int()
        .min(min, `must be at least ${String(min)}`)
        .max(max, `must be at most ${String(max)}`),
    );
}

function intWithDefault(name: EnvVarName, range: IntRange): z.ZodType<number> {
  const schema = intSchema(range);
  return schema.default(schema.parse(requireDefault(name)));
}

function optionalInt(name: EnvVarName, range: IntRange): z.ZodType<number | undefined> {
  requireOptional(name);
  return intSchema(range).optional();
}

const PORT_RANGE: IntRange = { min: 1, max: 65_535 };

// ── booleans ──────────────────────────────────────────────────────────────────────

const BOOL_ERROR = "must be one of true, false, 1, 0, yes, no, on, off";

const boolSchema = z.stringbool({
  truthy: ["true", "1", "yes", "on"],
  falsy: ["false", "0", "no", "off"],
  error: BOOL_ERROR,
});

function boolWithDefault(name: EnvVarName): z.ZodType<boolean> {
  return boolSchema.default(boolSchema.parse(requireDefault(name)));
}

// ── enums ─────────────────────────────────────────────────────────────────────────

type EnumValues = readonly [string, ...string[]];

function enumSchema<const T extends EnumValues>(
  name: EnvVarName,
  values: T,
): z.ZodEnum<{ [K in T[number]]: K }> {
  const documented = docOf(name).values;
  if (documented === undefined || documented.join(",") !== values.join(",")) {
    throw new EnvSchemaDefinitionError(`${name}: schema values differ from the documented values`);
  }
  return z.enum(values, { error: `must be one of ${values.join(", ")}` });
}

function enumWithDefault<const T extends EnumValues>(
  name: EnvVarName,
  values: T,
): z.ZodType<T[number]> {
  const schema = enumSchema(name, values);
  return schema.default(schema.parse(requireDefault(name)));
}

// ── lists ─────────────────────────────────────────────────────────────────────────

function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function enumListWithDefault<const T extends EnumValues>(
  name: EnvVarName,
  values: T,
): z.ZodType<T[number][]> {
  const item = enumSchema(name, values);
  const schema = z
    .string()
    .transform(splitList)
    .pipe(z.array(item).min(1, "must list at least one value"));
  return schema.default(schema.parse(requireDefault(name)));
}

/** An optional comma list of enum values; unset parses to `[]`. */
function optionalEnumList<const T extends EnumValues>(
  name: EnvVarName,
  values: T,
): z.ZodType<T[number][], string | undefined> {
  requireOptional(name);
  const item = enumSchema(name, values);
  return z
    .string()
    .optional()
    .transform((raw) => (raw === undefined ? [] : splitList(raw)))
    .pipe(z.array(item));
}

/** An optional comma list whose items match `item`; unset parses to `[]`. */
function optionalList(
  name: EnvVarName,
  item: z.ZodType<string, string>,
): z.ZodType<string[], string | undefined> {
  requireOptional(name);
  return z
    .string()
    .optional()
    .transform((raw) => (raw === undefined ? [] : splitList(raw)))
    .pipe(z.array(item));
}

/** A comma list of non-empty items with a documented default. */
function listWithDefault(
  name: EnvVarName,
  item: z.ZodType<string, string>,
): z.ZodType<string[], string | undefined> {
  const schema = z
    .string()
    .transform(splitList)
    .pipe(z.array(item).min(1, "must list at least one value"));
  return schema.default(schema.parse(requireDefault(name)));
}

/** An npm package name (`name` or `@scope/name`). */
const packageNameSchema = z
  .string()
  .regex(
    /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/,
    "must be an npm package name such as @flowaid/nodes-langchain",
  );

/** An environment variable name. */
const envNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be an environment variable name such as PATH");

function parseOrigin(value: string): string | undefined {
  if (value === "*") {
    return value;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const isHttp = url.protocol === "http:" || url.protocol === "https:";
  const bare = url.pathname === "/" && url.search === "" && url.hash === "" && !value.endsWith("?");
  return isHttp && bare && !value.slice(url.origin.length).includes("/", 1)
    ? url.origin
    : undefined;
}

/** A browser origin (`scheme://host[:port]`, no path) or `*`. */
const originSchema = z
  .string()
  .refine(
    (value) => parseOrigin(value) !== undefined,
    "must be an http(s) origin without path, query or fragment (for example https://app.example.com) or *",
  )
  .transform((value) => parseOrigin(value) ?? value);

function originListWithDefault(name: EnvVarName): z.ZodType<string[]> {
  const schema = z
    .string()
    .transform(splitList)
    .pipe(z.array(originSchema).min(1, "must list at least one origin"));
  return schema.default(schema.parse(requireDefault(name)));
}

// ── URLs ──────────────────────────────────────────────────────────────────────────

function urlSchema(protocol: RegExp, hint: string): z.ZodType<string, string> {
  return z.url({ protocol, error: `must be a URL starting with ${hint}` });
}

function urlWithDefault(name: EnvVarName, protocol: RegExp, hint: string): z.ZodType<string> {
  const schema = urlSchema(protocol, hint);
  return schema.default(schema.parse(requireDefault(name)));
}

function optionalUrl(
  name: EnvVarName,
  protocol: RegExp,
  hint: string,
): z.ZodType<string | undefined> {
  requireOptional(name);
  return urlSchema(protocol, hint).optional();
}

function requiredUrl(name: EnvVarName, protocol: RegExp, hint: string): z.ZodType<string> {
  requireRequired(name);
  return urlSchema(protocol, hint);
}

// ── keys ──────────────────────────────────────────────────────────────────────────

const BASE64_32_RE = /^[A-Za-z0-9+/]{43}=$/;
const HEX_32_RE = /^[0-9a-fA-F]{64}$/;

/** 32 random bytes as base64 (44 chars) or hex (64 chars). Kept as the raw string. */
function optionalMasterKey(name: EnvVarName): z.ZodType<string | undefined> {
  requireOptional(name);
  return z
    .string()
    .trim()
    .refine(
      (value) => BASE64_32_RE.test(value) || HEX_32_RE.test(value),
      "must be 32 bytes encoded as base64 (44 characters) or hex (64 characters); generate with `openssl rand -base64 32`",
    )
    .optional();
}

function pemSchema(kind: "PRIVATE" | "PUBLIC"): z.ZodType<string, string> {
  const re = new RegExp(
    `^-----BEGIN (EC )?${kind} KEY-----\\n[\\s\\S]+\\n-----END (EC )?${kind} KEY-----$`,
  );
  return z
    .string()
    .transform((value) => value.replace(/\\n/g, "\n").trim())
    .pipe(
      z
        .string()
        .regex(
          re,
          `must be a PEM-encoded ${kind.toLowerCase()} key (newlines may be written as \\n)`,
        ),
    );
}

function optionalPem(name: EnvVarName, kind: "PRIVATE" | "PUBLIC"): z.ZodType<string | undefined> {
  requireOptional(name);
  return pemSchema(kind).optional();
}

function optionalEmail(name: EnvVarName): z.ZodType<string | undefined> {
  requireOptional(name);
  return z.email({ error: "must be an email address" }).optional();
}

/** Bounds of `FLOWAID_ADMIN_PASSWORD`: argon2 input, so bounded above as well. */
export const ADMIN_PASSWORD_MIN_LENGTH = 12;
export const ADMIN_PASSWORD_MAX_LENGTH = 256;

/**
 * Passwords of at least {@link ADMIN_PASSWORD_MIN_LENGTH} characters that are still guessable.
 * Compared case-insensitively; rejected in production together with the documented values.
 */
export const ADMIN_PASSWORD_DENY_LIST: readonly string[] = [
  "password1234",
  "password12345",
  "passwordpassword",
  "changemeplease",
  "change-me-please",
  "changemechangeme",
  "administrator",
  "adminadmin123",
  "admin12345678",
  "123456789012",
  "1234567890123",
  "qwertyuiop12",
  "qwertyuiopas",
  "letmein12345",
  "welcome12345",
  "iloveyou1234",
  "abcdefghijkl",
  "flowaidflowaid",
  "flowaid12345",
  "correcthorsebatterystaple",
];

function optionalPassword(name: EnvVarName): z.ZodType<string | undefined> {
  requireOptional(name);
  return z
    .string()
    .min(
      ADMIN_PASSWORD_MIN_LENGTH,
      `must be at least ${String(ADMIN_PASSWORD_MIN_LENGTH)} characters`,
    )
    .max(
      ADMIN_PASSWORD_MAX_LENGTH,
      `must be at most ${String(ADMIN_PASSWORD_MAX_LENGTH)} characters`,
    )
    .optional();
}

// ── trust proxy ───────────────────────────────────────────────────────────────────

/** Named address ranges `proxy-addr` (Fastify `trustProxy`) understands. */
const TRUST_PROXY_NAMES = ["loopback", "linklocal", "uniquelocal"] as const;

function isIpOrCidr(value: string): boolean {
  const slash = value.indexOf("/");
  const address = slash === -1 ? value : value.slice(0, slash);
  const family = isIP(address);
  if (family === 0) {
    return false;
  }
  if (slash === -1) {
    return true;
  }
  const bits = value.slice(slash + 1);
  if (!/^\d{1,3}$/.test(bits)) {
    return false;
  }
  return Number(bits) <= (family === 4 ? 32 : 128);
}

/** `false | true | readonly string[]` (IPs, CIDRs or the named ranges). */
export type TrustProxy = boolean | readonly string[];

const trustProxyEntry = z
  .string()
  .refine(
    (value) => isIpOrCidr(value) || TRUST_PROXY_NAMES.some((named) => named === value),
    `must be an IP address, a CIDR range or one of ${TRUST_PROXY_NAMES.join(", ")}`,
  );

function trustProxyWithDefault(name: EnvVarName): z.ZodType<TrustProxy, string | undefined> {
  const schema = z.string().transform((raw, ctx): TrustProxy => {
    const bool = boolSchema.safeParse(raw);
    if (bool.success) {
      return bool.data;
    }
    const entries = splitList(raw);
    if (entries.length === 0) {
      ctx.addIssue({ code: "custom", message: `${BOOL_ERROR}, or a list of IPs/CIDRs` });
      return z.NEVER;
    }
    const parsed = z.array(trustProxyEntry).safeParse(entries);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ code: "custom", message: issue.message });
      }
      return z.NEVER;
    }
    return parsed.data;
  });
  return schema.default(schema.parse(requireDefault(name)));
}

// ── cron ──────────────────────────────────────────────────────────────────────────

const CRON_FIELD_RE = /^(\*|\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)?$/;

function cronWithDefault(name: EnvVarName): z.ZodType<string> {
  const schema = z
    .string()
    .trim()
    .refine((value) => {
      const fields = value.split(/\s+/);
      return fields.length === 5 && fields.every((field) => CRON_FIELD_RE.test(field));
    }, "must be a five-field cron expression such as `0 3 * * *`");
  return schema.default(schema.parse(requireDefault(name)));
}

// ── stdio command allow-list ──────────────────────────────────────────────────────

/** One entry of `FLOWAID_MCP_STDIO_ALLOWED_COMMANDS`. */
export interface StdioCommandRule {
  /** Absolute path of the executable. */
  readonly command: string;
  /** Regex source the space-joined arguments must match; absent means any arguments. */
  readonly argsPattern?: string;
}

const stdioCommandRule = z.string().transform((entry, ctx): StdioCommandRule => {
  const eq = entry.indexOf("=");
  const command = eq === -1 ? entry : entry.slice(0, eq);
  if (!command.startsWith("/") || command.includes("..")) {
    ctx.addIssue({
      code: "custom",
      message: `command ${JSON.stringify(command)} must be an absolute path`,
    });
    return z.NEVER;
  }
  if (eq === -1) {
    return { command };
  }
  const argsPattern = entry.slice(eq + 1);
  try {
    new RegExp(argsPattern);
  } catch {
    ctx.addIssue({
      code: "custom",
      message: `arguments pattern for ${command} is not a valid regular expression`,
    });
    return z.NEVER;
  }
  return { command, argsPattern };
});

function optionalStdioCommands(
  name: EnvVarName,
): z.ZodType<StdioCommandRule[], string | undefined> {
  requireOptional(name);
  return z
    .string()
    .optional()
    .transform((raw) => (raw === undefined ? [] : splitList(raw)))
    .pipe(z.array(stdioCommandRule));
}

// ── cross-field rules ─────────────────────────────────────────────────────────────

const S3_VARS = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;
const OIDC_VARS = ["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"] as const;

/** One cross-variable problem. */
export interface CrossFieldIssue {
  readonly path: EnvVarName;
  readonly message: string;
}

/** Reads a boolean field from raw (`"true"`) or parsed (`true`) values; unset means the default. */
function boolOf(value: unknown, name: EnvVarName): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = boolSchema.safeParse(value.trim());
    if (parsed.success) {
      return parsed.data;
    }
  }
  return boolSchema.parse(requireDefault(name));
}

/** Reads a list field from raw (csv) or parsed (array) values. */
function listOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  return typeof value === "string" ? splitList(value) : [];
}

function urlOf(value: unknown): URL | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    return new URL(value.trim());
  } catch {
    return undefined;
  }
}

/** Whether a URL hostname is the local machine (`localhost`, `*.localhost`, `127/8`, `::1`). */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    host === "[::1]" ||
    host === "::1"
  );
}

/**
 * Registrable domain of a hostname, approximated as its last two labels (`app.example.com`
 * → `example.com`). IP literals and single-label hosts are their own site. The
 * approximation errs on the side of accepting (`a.co.uk` and `b.co.uk` count as one site).
 */
function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase();
  if (host.startsWith("[") || isIP(host) !== 0) {
    return host;
  }
  const labels = host.split(".");
  return labels.length <= 2 ? host : labels.slice(-2).join(".");
}

/** Schemeful site of a URL: scheme plus registrable domain. */
export function siteOf(url: URL): string {
  return `${url.protocol}//${registrableDomain(url.hostname)}`;
}

/**
 * Rules that involve more than one variable. They look at presence, raw equality and a few
 * parsed shapes, so they can run on parsed values (inside {@link EnvSchema}) and on the raw
 * source (from `loadEnv`, so that these problems are reported alongside per-variable ones
 * instead of only after those are fixed).
 *
 * The production rules (`NODE_ENV=production`) refuse configurations that are unsafe on a
 * public host: `CORS_ORIGINS=*`, `http:` public URLs, the documented admin password, generated
 * JWT keys in an unnamed directory, an unnamed master key source and cross-site origins,
 * each with its documented override. A worker serving only the `code` pool is exempt from the
 * key requirements and must not hold a master key.
 */
export function crossFieldIssues(vars: Partial<Record<EnvVarName, unknown>>): CrossFieldIssue[] {
  const issues: CrossFieldIssue[] = [];
  const has = (name: EnvVarName): boolean => vars[name] !== undefined;
  const str = (name: EnvVarName): string => String(vars[name]).trim();
  const isDefault = (name: EnvVarName): boolean =>
    !has(name) || str(name) === ENV_VAR_DOCS[name].default;

  // FLOWAID_MASTER_KEY and FLOWAID_MASTER_KEY_FILE may both be set: the variable takes
  // precedence and the file is ignored (the compose stack always sets the file path).
  if (has("FLOWAID_JWT_PRIVATE_KEY") !== has("FLOWAID_JWT_PUBLIC_KEY")) {
    issues.push({
      path: has("FLOWAID_JWT_PRIVATE_KEY") ? "FLOWAID_JWT_PUBLIC_KEY" : "FLOWAID_JWT_PRIVATE_KEY",
      message: "FLOWAID_JWT_PRIVATE_KEY and FLOWAID_JWT_PUBLIC_KEY must be set together",
    });
  }
  const s3Set = S3_VARS.filter((key) => has(key));
  if (s3Set.length > 0 && s3Set.length < S3_VARS.length) {
    for (const key of S3_VARS) {
      if (!has(key)) {
        issues.push({
          path: key,
          message: `is required when ${s3Set.join(", ")} ${s3Set.length === 1 ? "is" : "are"} set (object storage needs all of ${S3_VARS.join(", ")})`,
        });
      }
    }
  }
  const oidcSet = OIDC_VARS.filter((key) => has(key));
  if (oidcSet.length > 0 && oidcSet.length < OIDC_VARS.length) {
    for (const key of OIDC_VARS) {
      if (!has(key)) {
        issues.push({
          path: key,
          message: `is required when ${oidcSet.join(", ")} ${oidcSet.length === 1 ? "is" : "are"} set (OIDC needs all of ${OIDC_VARS.join(", ")})`,
        });
      }
    }
  }
  if (has("OIDC_ROLE_CLAIM") && !has("OIDC_ISSUER")) {
    issues.push({ path: "OIDC_ROLE_CLAIM", message: "has no effect without OIDC_ISSUER" });
  }
  if (has("FLOWAID_ADMIN_EMAIL") !== has("FLOWAID_ADMIN_PASSWORD")) {
    issues.push({
      path: has("FLOWAID_ADMIN_EMAIL") ? "FLOWAID_ADMIN_PASSWORD" : "FLOWAID_ADMIN_EMAIL",
      message: "FLOWAID_ADMIN_EMAIL and FLOWAID_ADMIN_PASSWORD must be set together",
    });
  }
  if (has("PROMETHEUS_PORT") && has("PORT") && str("PROMETHEUS_PORT") === str("PORT")) {
    issues.push({ path: "PROMETHEUS_PORT", message: "must differ from PORT" });
  }

  const nodeEnv = has("NODE_ENV") ? str("NODE_ENV") : ENV_VAR_DOCS.NODE_ENV.default;
  if (nodeEnv !== "production") {
    return issues;
  }

  // ── production only ──
  const pools = has("WORKER_POOLS")
    ? listOf(vars.WORKER_POOLS)
    : listOf(ENV_VAR_DOCS.WORKER_POOLS.default);
  // A process serving only the `code` pool is a sandbox host (compose `worker-code`,
  // ARCHITECTURE.md §10.7): it never signs sessions or unwraps credentials, so it needs
  // neither JWT keys nor a master key and must not hold one.
  const sandboxOnly = pools.length === 1 && pools[0] === "code";
  const allowInsecureHttp = boolOf(vars.FLOWAID_ALLOW_INSECURE_HTTP, "FLOWAID_ALLOW_INSECURE_HTTP");
  const allowCrossSite = boolOf(vars.FLOWAID_ALLOW_CROSS_SITE, "FLOWAID_ALLOW_CROSS_SITE");
  const autogenerate = boolOf(
    vars.FLOWAID_MASTER_KEY_AUTOGENERATE,
    "FLOWAID_MASTER_KEY_AUTOGENERATE",
  );

  const origins = has("CORS_ORIGINS") ? listOf(vars.CORS_ORIGINS) : [];
  if (origins.includes("*")) {
    issues.push({
      path: "CORS_ORIGINS",
      message: "must not contain * in production (list the web app's origin instead)",
    });
  }

  for (const name of ["FLOWAID_BASE_URL", "FLOWAID_WEB_URL", "OIDC_ISSUER"] as const) {
    if (name === "OIDC_ISSUER" && !has(name)) {
      continue;
    }
    const url = urlOf(has(name) ? vars[name] : ENV_VAR_DOCS[name].default);
    if (url !== undefined && url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
      if (!allowInsecureHttp) {
        issues.push({
          path: name,
          message:
            "must be https:// in production (session cookies are Secure); set FLOWAID_ALLOW_INSECURE_HTTP=true only for an isolated lab deployment",
        });
      }
    }
  }

  if (has("FLOWAID_ADMIN_PASSWORD")) {
    const password = String(vars.FLOWAID_ADMIN_PASSWORD);
    const doc = ENV_VAR_DOCS.FLOWAID_ADMIN_PASSWORD;
    const documented = [doc.example, doc.quickstart].filter((v): v is string => v !== undefined);
    if (documented.includes(password)) {
      issues.push({
        path: "FLOWAID_ADMIN_PASSWORD",
        message: "must not be the documented example password in production",
      });
    } else if (ADMIN_PASSWORD_DENY_LIST.includes(password.toLowerCase())) {
      issues.push({
        path: "FLOWAID_ADMIN_PASSWORD",
        message: "is a commonly guessed password and is rejected in production",
      });
    }
  }

  if (sandboxOnly) {
    for (const name of ["FLOWAID_MASTER_KEY", "FLOWAID_MASTER_KEY_FILE"] as const) {
      if (has(name) && !isDefault(name)) {
        issues.push({
          path: name,
          message:
            "must not be set on a worker that serves only the code pool: the sandbox host never holds a master key (ARCHITECTURE.md §10.7)",
        });
      }
    }
  }

  if (!sandboxOnly && !has("FLOWAID_JWT_PRIVATE_KEY") && !has("FLOWAID_JWT_PUBLIC_KEY")) {
    if (isDefault("FLOWAID_JWT_KEYS_DIR")) {
      issues.push({
        path: "FLOWAID_JWT_PRIVATE_KEY",
        message:
          "and FLOWAID_JWT_PUBLIC_KEY are required in production, or set FLOWAID_JWT_KEYS_DIR explicitly to a persistent directory shared by every api replica to run on generated keys",
      });
    }
  }

  if (
    !sandboxOnly &&
    !has("FLOWAID_MASTER_KEY") &&
    isDefault("FLOWAID_MASTER_KEY_FILE") &&
    !autogenerate
  ) {
    issues.push({
      path: "FLOWAID_MASTER_KEY",
      message:
        "or an explicit FLOWAID_MASTER_KEY_FILE is required in production; a key file is only created on first boot with FLOWAID_MASTER_KEY_AUTOGENERATE=true",
    });
  }

  const base = urlOf(
    has("FLOWAID_BASE_URL") ? vars.FLOWAID_BASE_URL : ENV_VAR_DOCS.FLOWAID_BASE_URL.default,
  );
  if (base !== undefined && !allowCrossSite) {
    const baseSite = siteOf(base);
    const crossSite = origins.filter((origin) => {
      const url = urlOf(origin);
      return origin !== "*" && url !== undefined && siteOf(url) !== baseSite;
    });
    if (crossSite.length > 0) {
      issues.push({
        path: "CORS_ORIGINS",
        message: `${crossSite.join(", ")} ${crossSite.length === 1 ? "is" : "are"} cross-site with FLOWAID_BASE_URL (session cookies are SameSite); set FLOWAID_ALLOW_CROSS_SITE=true to accept this`,
      });
    }
  }

  return issues;
}

/**
 * Object schema of every variable. Input is the raw string environment; output is typed
 * ({@link EnvVars}). Cross-field consistency rules are attached as a check so that a
 * schema-only consumer gets them too.
 */
export const EnvSchema = z
  .object({
    NODE_ENV: enumWithDefault("NODE_ENV", NODE_ENVS),
    LOG_LEVEL: enumWithDefault("LOG_LEVEL", LOG_LEVELS),
    HOST: stringWithDefault("HOST"),
    PORT: intWithDefault("PORT", PORT_RANGE),
    FLOWAID_BASE_URL: urlWithDefault("FLOWAID_BASE_URL", /^https?$/, "http:// or https://"),
    FLOWAID_WEB_URL: urlWithDefault("FLOWAID_WEB_URL", /^https?$/, "http:// or https://"),
    CORS_ORIGINS: originListWithDefault("CORS_ORIGINS"),
    RATE_LIMIT_MAX: intWithDefault("RATE_LIMIT_MAX", { min: 1, max: 1_000_000 }),
    FLOWAID_API_INTERNAL_URL: optionalUrl(
      "FLOWAID_API_INTERNAL_URL",
      /^https?$/,
      "http:// or https://",
    ),
    FLOWAID_TRUST_PROXY: trustProxyWithDefault("FLOWAID_TRUST_PROXY"),
    FLOWAID_SSE_MAX_STREAMS_PER_PRINCIPAL: intWithDefault("FLOWAID_SSE_MAX_STREAMS_PER_PRINCIPAL", {
      min: 1,
      max: 10_000,
    }),
    FLOWAID_FEATURES_DISABLED: optionalEnumList("FLOWAID_FEATURES_DISABLED", FEATURE_KEYS),

    DATABASE_URL: requiredUrl("DATABASE_URL", /^postgres(ql)?$/, "postgres:// or postgresql://"),
    DB_RLS: boolWithDefault("DB_RLS"),
    RUN_EVENTS_PARTITIONED: boolWithDefault("RUN_EVENTS_PARTITIONED"),
    DATABASE_ADMIN_URL: optionalUrl(
      "DATABASE_ADMIN_URL",
      /^postgres(ql)?$/,
      "postgres:// or postgresql://",
    ),
    RETENTION_SWEEP_CRON: cronWithDefault("RETENTION_SWEEP_CRON"),

    REDIS_URL: optionalUrl("REDIS_URL", /^rediss?$/, "redis:// or rediss://"),
    WORKER_POOLS: enumListWithDefault("WORKER_POOLS", WORKER_POOLS),
    WORKER_CONCURRENCY: intWithDefault("WORKER_CONCURRENCY", { min: 1, max: 1_000 }),
    FLOWAID_QUEUE_UI: boolWithDefault("FLOWAID_QUEUE_UI"),

    FLOWAID_MASTER_KEY: optionalMasterKey("FLOWAID_MASTER_KEY"),
    FLOWAID_MASTER_KEY_FILE: stringWithDefault("FLOWAID_MASTER_KEY_FILE"),
    FLOWAID_JWT_PRIVATE_KEY: optionalPem("FLOWAID_JWT_PRIVATE_KEY", "PRIVATE"),
    FLOWAID_JWT_PUBLIC_KEY: optionalPem("FLOWAID_JWT_PUBLIC_KEY", "PUBLIC"),
    FLOWAID_JWT_KEYS_DIR: stringWithDefault("FLOWAID_JWT_KEYS_DIR"),
    FLOWAID_ADMIN_EMAIL: optionalEmail("FLOWAID_ADMIN_EMAIL"),
    FLOWAID_ADMIN_PASSWORD: optionalPassword("FLOWAID_ADMIN_PASSWORD"),
    FLOWAID_ALLOW_INSECURE_HTTP: boolWithDefault("FLOWAID_ALLOW_INSECURE_HTTP"),
    FLOWAID_ALLOW_CROSS_SITE: boolWithDefault("FLOWAID_ALLOW_CROSS_SITE"),
    FLOWAID_MASTER_KEY_AUTOGENERATE: boolWithDefault("FLOWAID_MASTER_KEY_AUTOGENERATE"),

    OIDC_ISSUER: optionalUrl("OIDC_ISSUER", /^https?$/, "http:// or https://"),
    OIDC_CLIENT_ID: optionalString("OIDC_CLIENT_ID"),
    OIDC_CLIENT_SECRET: optionalString("OIDC_CLIENT_SECRET"),
    OIDC_ROLE_CLAIM: optionalString("OIDC_ROLE_CLAIM"),

    SANDBOX_MODE: enumWithDefault("SANDBOX_MODE", SANDBOX_MODES),
    MCP_STDIO_ENABLED: boolWithDefault("MCP_STDIO_ENABLED"),
    FLOWAID_PLUGIN_DIR: stringWithDefault("FLOWAID_PLUGIN_DIR"),
    FLOWAID_BUNDLED_PLUGINS: listWithDefault("FLOWAID_BUNDLED_PLUGINS", packageNameSchema),
    FLOWAID_PLUGIN_ALLOW_LOCAL: boolWithDefault("FLOWAID_PLUGIN_ALLOW_LOCAL"),
    FLOWAID_MCP_STDIO_ALLOWED_COMMANDS: optionalStdioCommands("FLOWAID_MCP_STDIO_ALLOWED_COMMANDS"),
    FLOWAID_MCP_STDIO_ENV_ALLOWLIST: optionalList("FLOWAID_MCP_STDIO_ENV_ALLOWLIST", envNameSchema),
    FLOWAID_EXPORT_MODE: enumWithDefault("FLOWAID_EXPORT_MODE", EXPORT_MODES),
    FLOWAID_VENDOR_DIR: stringWithDefault("FLOWAID_VENDOR_DIR"),

    S3_ENDPOINT: optionalUrl("S3_ENDPOINT", /^https?$/, "http:// or https://"),
    S3_BUCKET: optionalString("S3_BUCKET"),
    S3_ACCESS_KEY: optionalString("S3_ACCESS_KEY"),
    S3_SECRET_KEY: optionalString("S3_SECRET_KEY"),
    S3_REGION: stringWithDefault("S3_REGION"),
    S3_FORCE_PATH_STYLE: boolWithDefault("S3_FORCE_PATH_STYLE"),

    TYPESAFE_API_KEY: optionalString("TYPESAFE_API_KEY"),
    OPENAI_API_KEY: optionalString("OPENAI_API_KEY"),
    ANTHROPIC_API_KEY: optionalString("ANTHROPIC_API_KEY"),
    OLLAMA_HOST: optionalUrl("OLLAMA_HOST", /^https?$/, "http:// or https://"),
    FLOWAID_PROVIDER_FIXTURES: enumWithDefault("FLOWAID_PROVIDER_FIXTURES", PROVIDER_FIXTURE_MODES),
    FLOWAID_PROVIDER_FIXTURES_DIR: stringWithDefault("FLOWAID_PROVIDER_FIXTURES_DIR"),

    OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl(
      "OTEL_EXPORTER_OTLP_ENDPOINT",
      /^https?$/,
      "http:// or https://",
    ),
    PROMETHEUS_PORT: optionalInt("PROMETHEUS_PORT", PORT_RANGE),
  })
  .superRefine((vars, ctx) => {
    for (const issue of crossFieldIssues(vars)) {
      ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message });
    }
  });

/** The parsed, typed environment variables (output of {@link EnvSchema}). */
export type EnvVars = z.output<typeof EnvSchema>;

/** Names of the fields of {@link EnvSchema}, in schema order. */
export const ENV_SCHEMA_KEYS: readonly string[] = Object.keys(EnvSchema.shape);

{
  const documented = ENV_PARSED_VAR_NAMES.join(",");
  const built = ENV_SCHEMA_KEYS.join(",");
  if (documented !== built) {
    throw new EnvSchemaDefinitionError(
      `EnvSchema fields differ from the documented variables:\n  documented: ${documented}\n  built:      ${built}`,
    );
  }
}
