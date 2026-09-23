import { describe, expect, it } from "vitest";

import { SECRET_ENV_KEYS } from "./docs.js";
import {
  EnvError,
  REDACTED_PLACEHOLDER,
  deriveFlags,
  loadEnv,
  redactEnv,
  safeLoadEnv,
  secretEnvValues,
} from "./load.js";

const MINIMAL = { DATABASE_URL: "postgres://flowaid:flowaid@localhost:5432/flowaid" };

const MASTER_KEY = Buffer.alloc(32, 3).toString("hex");

/** Every secret variable set to a unique canary so a leak is greppable. */
const CANARIES: Record<string, string> = {
  DATABASE_URL: "postgres://flowaid:canary-db-pass@db.internal:5432/flowaid",
  DATABASE_ADMIN_URL: "postgres://postgres:canary-admin-pass@db.internal:5432/flowaid",
  REDIS_URL: "redis://:canary-redis-pass@redis.internal:6379",
  FLOWAID_MASTER_KEY: MASTER_KEY,
  FLOWAID_JWT_PRIVATE_KEY:
    "-----BEGIN PRIVATE KEY-----\ncanary-jwt-private\n-----END PRIVATE KEY-----",
  FLOWAID_JWT_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----\npublic-part\n-----END PUBLIC KEY-----",
  FLOWAID_ADMIN_EMAIL: "owner@example.com",
  FLOWAID_ADMIN_PASSWORD: "canary-admin-password",
  OIDC_ISSUER: "https://login.example.com",
  OIDC_CLIENT_ID: "flowaid",
  OIDC_CLIENT_SECRET: "canary-oidc-secret",
  S3_ENDPOINT: "http://minio:9000",
  S3_BUCKET: "flowaid",
  S3_ACCESS_KEY: "canary-s3-access",
  S3_SECRET_KEY: "canary-s3-secret",
  TYPESAFE_API_KEY: "canary-typesafe",
  OPENAI_API_KEY: "canary-openai",
  ANTHROPIC_API_KEY: "canary-anthropic",
  FLOWAID_SECRET_SLACK_TOKEN: "canary-slack-token",
  FLOWAID_SECRET_CRM_KEY: "canary-crm-key",
};

const CANARY_VALUES = [
  "canary-db-pass",
  "canary-admin-pass",
  "canary-redis-pass",
  MASTER_KEY,
  "canary-jwt-private",
  "canary-admin-password",
  "canary-oidc-secret",
  "canary-s3-access",
  "canary-s3-secret",
  "canary-typesafe",
  "canary-openai",
  "canary-anthropic",
  "canary-slack-token",
  "canary-crm-key",
];

describe("loadEnv", () => {
  it("returns a frozen Env with flags from a minimal source", () => {
    const env = loadEnv(MINIMAL);
    expect(env.DATABASE_URL).toBe(MINIMAL.DATABASE_URL);
    expect(env.PORT).toBe(3000);
    expect(Object.isFrozen(env)).toBe(true);
    expect(Object.isFrozen(env.flags)).toBe(true);
    expect(Object.isFrozen(env.secretRefs)).toBe(true);
    expect(env.secretRefs).toEqual({});
    expect(env.flags).toEqual({
      isProduction: false,
      isDevelopment: true,
      isTest: false,
      hasRedis: false,
      hasS3: false,
      hasTypeSafe: false,
      hasOpenAI: false,
      hasAnthropic: false,
      hasOllama: false,
      hasGenerationProvider: false,
      hasOtel: false,
      hasPrometheus: false,
      hasJwtKeys: false,
      hasMasterKeyInEnv: false,
      masterKeyAutogenerate: true,
      hasAdminBootstrap: false,
      hasOidc: false,
      hasDatabaseAdminUrl: false,
      providerFixturesEnabled: false,
      mcpStdioEnabled: false,
      sandboxIsContainer: false,
    });
  });

  it("does not read process.env when a source is given", () => {
    const env = loadEnv({ ...MINIMAL, PORT: "4100" });
    expect(env.PORT).toBe(4100);
  });

  it("treats empty and whitespace-only strings as unset", () => {
    const env = loadEnv({ ...MINIMAL, REDIS_URL: "", PORT: "   ", OPENAI_API_KEY: " " });
    expect(env.REDIS_URL).toBeUndefined();
    expect(env.PORT).toBe(3000);
    expect(env.flags.hasOpenAI).toBe(false);
  });

  it("fails on a missing required variable with a readable message", () => {
    let caught: unknown;
    try {
      loadEnv({});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EnvError);
    if (!(caught instanceof EnvError)) {
      return;
    }
    expect(caught.issues).toHaveLength(1);
    expect(caught.issues[0]?.variable).toBe("DATABASE_URL");
    expect(caught.issues[0]?.message).toMatch(/^is required: PostgreSQL 16 connection string/);
    expect(caught.issues[0]?.received).toBeUndefined();
    expect(caught.message).toBe(
      [
        "Invalid environment (1 problem):",
        `  - DATABASE_URL ${caught.issues[0]?.message ?? ""}`,
        "See packages/env/README.md or .env.example for every variable.",
      ].join("\n"),
    );
  });

  it("aggregates every problem into one error, echoing non-secret values only", () => {
    const result = safeLoadEnv({
      DATABASE_URL: "mysql://nope",
      PORT: "99999",
      NODE_ENV: "prod",
      REDIS_URL: "not a url",
      FLOWAID_ADMIN_EMAIL: "owner@example.com",
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const byVar = new Map(result.error.issues.map((i) => [i.variable, i]));
    expect([...byVar.keys()].sort()).toEqual(
      ["DATABASE_URL", "FLOWAID_ADMIN_PASSWORD", "NODE_ENV", "PORT", "REDIS_URL"].sort(),
    );
    expect(byVar.get("DATABASE_URL")?.received).toBeUndefined(); // secret: never echoed
    expect(byVar.get("REDIS_URL")?.received).toBeUndefined(); // secret: never echoed
    expect(byVar.get("PORT")?.received).toBe("99999");
    expect(byVar.get("NODE_ENV")?.received).toBe("prod");
    expect(byVar.get("PORT")?.message).toBe("must be at most 65535");
    expect(byVar.get("FLOWAID_ADMIN_PASSWORD")?.message).toContain("must be set together");
    expect(result.error.message).toContain("Invalid environment (5 problems):");
    expect(result.error.message).toContain('  - PORT must be at most 65535 (received "99999")');
    expect(result.error.message).not.toContain("mysql://nope");
  });

  it("reports production rules alongside per-variable problems in one pass", () => {
    const result = safeLoadEnv({
      ...MINIMAL,
      NODE_ENV: "production",
      PORT: "abc",
      CORS_ORIGINS: "*",
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const variables = result.error.issues.map((i) => i.variable);
    expect(variables).toContain("PORT");
    expect(variables).toContain("CORS_ORIGINS");
    expect(variables).toContain("FLOWAID_MASTER_KEY");
    expect(variables).toContain("FLOWAID_JWT_PRIVATE_KEY");
  });

  it("derives flags from presence", () => {
    const env = loadEnv({
      ...MINIMAL,
      NODE_ENV: "production",
      FLOWAID_BASE_URL: "https://api.example.com",
      FLOWAID_WEB_URL: "https://app.example.com",
      CORS_ORIGINS: "https://app.example.com",
      FLOWAID_JWT_KEYS_DIR: "/data/keys",
      REDIS_URL: "redis://redis:6379",
      S3_ENDPOINT: "http://minio:9000",
      S3_BUCKET: "flowaid",
      S3_ACCESS_KEY: "k",
      S3_SECRET_KEY: "s",
      TYPESAFE_API_KEY: "ts",
      ANTHROPIC_API_KEY: "a",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel:4318",
      PROMETHEUS_PORT: "9464",
      FLOWAID_MASTER_KEY: MASTER_KEY,
      FLOWAID_ADMIN_EMAIL: "owner@example.com",
      FLOWAID_ADMIN_PASSWORD: "correct-horse-battery",
      OIDC_ISSUER: "https://login.example.com",
      OIDC_CLIENT_ID: "flowaid",
      OIDC_CLIENT_SECRET: "s3cret",
      DATABASE_ADMIN_URL: "postgres://postgres:pw@localhost:5432/flowaid",
      FLOWAID_PROVIDER_FIXTURES: "replay",
      MCP_STDIO_ENABLED: "true",
      SANDBOX_MODE: "container",
    });
    expect(env.flags).toEqual({
      isProduction: true,
      isDevelopment: false,
      isTest: false,
      hasRedis: true,
      hasS3: true,
      hasTypeSafe: true,
      hasOpenAI: false,
      hasAnthropic: true,
      hasOllama: false,
      hasGenerationProvider: true,
      hasOtel: true,
      hasPrometheus: true,
      hasJwtKeys: false,
      hasMasterKeyInEnv: true,
      masterKeyAutogenerate: false,
      hasAdminBootstrap: true,
      hasOidc: true,
      hasDatabaseAdminUrl: true,
      providerFixturesEnabled: true,
      mcpStdioEnabled: true,
      sandboxIsContainer: true,
    });
  });

  it("masterKeyAutogenerate follows NODE_ENV and FLOWAID_MASTER_KEY_AUTOGENERATE", () => {
    const production = {
      ...MINIMAL,
      NODE_ENV: "production",
      FLOWAID_JWT_KEYS_DIR: "/data/keys",
      FLOWAID_MASTER_KEY_AUTOGENERATE: "true",
    };
    expect(loadEnv(production).flags.masterKeyAutogenerate).toBe(true);
    expect(loadEnv({ ...MINIMAL, NODE_ENV: "test" }).flags.masterKeyAutogenerate).toBe(true);
  });

  it("lets FLOWAID_MASTER_KEY take precedence over an explicit FLOWAID_MASTER_KEY_FILE", () => {
    // the compose stack always sets the file path and passes the variable through when present
    const both = loadEnv({
      ...MINIMAL,
      FLOWAID_MASTER_KEY: MASTER_KEY,
      FLOWAID_MASTER_KEY_FILE: "/data/master.key",
    });
    expect(both.flags.hasMasterKeyInEnv).toBe(true);
    expect(both.FLOWAID_MASTER_KEY).toBe(MASTER_KEY);
    expect(both.FLOWAID_MASTER_KEY_FILE).toBe("/data/master.key");

    const fileOnly = loadEnv({ ...MINIMAL, FLOWAID_MASTER_KEY_FILE: "/data/master.key" });
    expect(fileOnly.flags.hasMasterKeyInEnv).toBe(false);

    // an empty variable (an unset line in .env, or compose's `${FLOWAID_MASTER_KEY:-}`) is unset
    const empty = loadEnv({
      ...MINIMAL,
      FLOWAID_MASTER_KEY: "",
      FLOWAID_MASTER_KEY_FILE: "/data/master.key",
    });
    expect(empty.flags.hasMasterKeyInEnv).toBe(false);
    expect(empty.FLOWAID_MASTER_KEY).toBeUndefined();

    const production = safeLoadEnv({
      ...MINIMAL,
      NODE_ENV: "production",
      FLOWAID_JWT_KEYS_DIR: "/data/keys",
      FLOWAID_MASTER_KEY: MASTER_KEY,
      FLOWAID_MASTER_KEY_FILE: "/data/master.key",
    });
    expect(production.ok).toBe(true);
  });

  it("ignores compose-only variables", () => {
    const env = loadEnv({
      ...MINIMAL,
      POSTGRES_PASSWORD: "owner-secret",
      POSTGRES_CODE_PASSWORD: "code-secret",
      BIND_ADDRESS: "0.0.0.0",
    });
    expect("POSTGRES_PASSWORD" in env).toBe(false);
    expect("BIND_ADDRESS" in env).toBe(false);
    expect(JSON.stringify(env)).not.toContain("owner-secret");
  });

  it("deriveFlags is a pure function of the parsed variables", () => {
    const env = loadEnv({ ...MINIMAL, OLLAMA_HOST: "http://localhost:11434" });
    const flags = deriveFlags(env);
    expect(flags).toEqual(env.flags);
    expect(flags.hasOllama).toBe(true);
    expect(flags.hasGenerationProvider).toBe(true);
  });
});

describe("secret references (FLOWAID_SECRET_<NAME>)", () => {
  it("are collected by full name and kept out of the schema fields", () => {
    const env = loadEnv({ ...MINIMAL, ...CANARIES });
    expect(env.secretRefs).toEqual({
      FLOWAID_SECRET_CRM_KEY: "canary-crm-key",
      FLOWAID_SECRET_SLACK_TOKEN: "canary-slack-token",
    });
    expect("FLOWAID_SECRET_SLACK_TOKEN" in env).toBe(false);
  });

  it("reject names that do not match the family pattern", () => {
    const result = safeLoadEnv({
      ...MINIMAL,
      "FLOWAID_SECRET_bad-name": "x",
      FLOWAID_SECRET_: "y",
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.map((i) => i.variable).sort()).toEqual([
      "FLOWAID_SECRET_",
      "FLOWAID_SECRET_bad-name",
    ]);
    expect(result.error.message).not.toContain("received");
  });
});

describe("secret-safe serialisation", () => {
  it("SECRET_ENV_KEYS lists every documented secret and nothing else", () => {
    expect([...SECRET_ENV_KEYS].sort()).toEqual(
      [
        "DATABASE_URL",
        "DATABASE_ADMIN_URL",
        "REDIS_URL",
        "FLOWAID_MASTER_KEY",
        "FLOWAID_JWT_PRIVATE_KEY",
        "FLOWAID_ADMIN_PASSWORD",
        "OIDC_CLIENT_SECRET",
        "S3_ACCESS_KEY",
        "S3_SECRET_KEY",
        "TYPESAFE_API_KEY",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
      ].sort(),
    );
  });

  it("JSON.stringify(loadEnv(...)) contains no secret value", () => {
    const env = loadEnv({ ...MINIMAL, ...CANARIES });
    const json = JSON.stringify(env);
    for (const canary of CANARY_VALUES) {
      expect(json, canary).not.toContain(canary);
    }
    expect(json).not.toContain("BEGIN PRIVATE KEY");
    const parsed: unknown = JSON.parse(json);
    expect(parsed).toMatchObject({
      DATABASE_URL: REDACTED_PLACEHOLDER,
      FLOWAID_MASTER_KEY: REDACTED_PLACEHOLDER,
      FLOWAID_SECRET_SLACK_TOKEN: REDACTED_PLACEHOLDER,
      FLOWAID_ADMIN_EMAIL: "owner@example.com",
      PORT: "3000",
      CORS_ORIGINS: "http://localhost:3001",
    });
    expect(JSON.stringify({ env })).not.toContain("canary");
    expect(JSON.stringify([env])).not.toContain("canary");
  });

  it("redactEnv omits unset variables and flags, and stringifies typed values", () => {
    const redacted = redactEnv(loadEnv({ ...MINIMAL, WORKER_POOLS: "general,code", DB_RLS: "on" }));
    expect(redacted.DATABASE_URL).toBe(REDACTED_PLACEHOLDER);
    expect(redacted.WORKER_POOLS).toBe("general,code");
    expect(redacted.DB_RLS).toBe("true");
    expect(redacted.FLOWAID_TRUST_PROXY).toBe("false");
    expect("REDIS_URL" in redacted).toBe(false);
    expect("flags" in redacted).toBe(false);
    expect("secretRefs" in redacted).toBe(false);
    expect(Object.keys(redacted)[0]).toBe("NODE_ENV");
  });

  it("secretEnvValues returns every secret, URL passwords and secret references", () => {
    const values = secretEnvValues(loadEnv({ ...MINIMAL, ...CANARIES }));
    for (const canary of CANARY_VALUES) {
      // URL passwords are extracted as their own entries; the PEM key is one multi-line value
      expect(
        values.some((value) => value.includes(canary)),
        `${canary} is learnable`,
      ).toBe(true);
    }
    expect(values).toContain("canary-db-pass");
    expect(values).toContain("canary-redis-pass");
    expect(values).toContain(CANARIES.FLOWAID_JWT_PRIVATE_KEY);
    expect(values).toContain(CANARIES.DATABASE_URL);
    expect(values).not.toContain("owner@example.com");
    expect(values).not.toContain(CANARIES.FLOWAID_JWT_PUBLIC_KEY);
    expect(new Set(values).size).toBe(values.length);
    expect(secretEnvValues(loadEnv(MINIMAL))).toEqual([MINIMAL.DATABASE_URL, "flowaid"]);
  });
});
