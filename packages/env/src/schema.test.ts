import { describe, expect, it } from "vitest";

import { ENV_PARSED_VAR_NAMES, ENV_VAR_DOCS, ENV_VAR_NAMES, FEATURE_KEYS } from "./docs.js";
import {
  ADMIN_PASSWORD_DENY_LIST,
  ENV_SCHEMA_KEYS,
  EnvSchema,
  crossFieldIssues,
  isLoopbackHost,
  siteOf,
} from "./schema.js";

const MINIMAL = { DATABASE_URL: "postgres://flowaid:flowaid@localhost:5432/flowaid" };

const PRIVATE_PEM =
  "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg\n-----END PRIVATE KEY-----";
const PUBLIC_PEM =
  "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE\n-----END PUBLIC KEY-----";

/** A production environment that passes every production rule. */
const PRODUCTION = {
  ...MINIMAL,
  NODE_ENV: "production",
  FLOWAID_BASE_URL: "https://api.example.com",
  FLOWAID_WEB_URL: "https://app.example.com",
  CORS_ORIGINS: "https://app.example.com",
  FLOWAID_MASTER_KEY: Buffer.alloc(32, 5).toString("base64"),
  FLOWAID_JWT_PRIVATE_KEY: PRIVATE_PEM,
  FLOWAID_JWT_PUBLIC_KEY: PUBLIC_PEM,
};

function issuesFor(input: Record<string, string>): Map<string, string[]> {
  const result = EnvSchema.safeParse(input);
  const map = new Map<string, string[]>();
  if (result.success) {
    return map;
  }
  for (const issue of result.error.issues) {
    const key = String(issue.path[0]);
    map.set(key, [...(map.get(key) ?? []), issue.message]);
  }
  return map;
}

function firstIssue(input: Record<string, string>, variable: string): string | undefined {
  return issuesFor(input).get(variable)?.[0];
}

describe("EnvSchema", () => {
  it("has exactly the documented (non-family) variables, in the documented order", () => {
    expect(ENV_SCHEMA_KEYS).toEqual(ENV_PARSED_VAR_NAMES);
    expect(ENV_VAR_NAMES).toContain("FLOWAID_SECRET_<NAME>");
    expect(ENV_SCHEMA_KEYS).not.toContain("FLOWAID_SECRET_<NAME>");
  });

  it("parses the minimal environment with every documented default", () => {
    const env = EnvSchema.parse(MINIMAL);
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.HOST).toBe("127.0.0.1");
    expect(env.PORT).toBe(3000);
    expect(env.FLOWAID_BASE_URL).toBe("http://localhost:3000");
    expect(env.FLOWAID_WEB_URL).toBe("http://localhost:3001");
    expect(env.CORS_ORIGINS).toEqual(["http://localhost:3001"]);
    expect(env.RATE_LIMIT_MAX).toBe(600);
    expect(env.FLOWAID_API_INTERNAL_URL).toBeUndefined();
    expect(env.FLOWAID_TRUST_PROXY).toBe(false);
    expect(env.FLOWAID_SSE_MAX_STREAMS_PER_PRINCIPAL).toBe(20);
    expect(env.FLOWAID_FEATURES_DISABLED).toEqual([]);
    expect(env.DB_RLS).toBe(false);
    expect(env.RUN_EVENTS_PARTITIONED).toBe(false);
    expect(env.DATABASE_ADMIN_URL).toBeUndefined();
    expect(env.RETENTION_SWEEP_CRON).toBe("0 3 * * *");
    expect(env.REDIS_URL).toBeUndefined();
    expect(env.WORKER_POOLS).toEqual(["general"]);
    expect(env.WORKER_CONCURRENCY).toBe(10);
    expect(env.FLOWAID_QUEUE_UI).toBe(false);
    expect(env.FLOWAID_MASTER_KEY).toBeUndefined();
    expect(env.FLOWAID_MASTER_KEY_FILE).toBe(".flowaid/master.key");
    expect(env.FLOWAID_JWT_KEYS_DIR).toBe(".flowaid/keys");
    expect(env.FLOWAID_ALLOW_INSECURE_HTTP).toBe(false);
    expect(env.FLOWAID_ALLOW_CROSS_SITE).toBe(false);
    expect(env.FLOWAID_MASTER_KEY_AUTOGENERATE).toBe(false);
    expect(env.OIDC_ISSUER).toBeUndefined();
    expect(env.SANDBOX_MODE).toBe("isolated-vm");
    expect(env.MCP_STDIO_ENABLED).toBe(false);
    expect(env.FLOWAID_PLUGIN_DIR).toBe(".flowaid/plugins");
    expect(env.FLOWAID_BUNDLED_PLUGINS).toEqual(["@flowaid/nodes-langchain"]);
    expect(env.FLOWAID_PLUGIN_ALLOW_LOCAL).toBe(false);
    expect(env.FLOWAID_MCP_STDIO_ALLOWED_COMMANDS).toEqual([]);
    expect(env.FLOWAID_MCP_STDIO_ENV_ALLOWLIST).toEqual([]);
    expect(env.FLOWAID_EXPORT_MODE).toBe("vendored");
    expect(env.FLOWAID_VENDOR_DIR).toBe("/opt/flowaid/vendor");
    expect(env.S3_REGION).toBe("us-east-1");
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.FLOWAID_PROVIDER_FIXTURES).toBe("off");
    expect(env.FLOWAID_PROVIDER_FIXTURES_DIR).toBe("fixtures/providers");
    expect(env.PROMETHEUS_PORT).toBeUndefined();
  });

  it("documented defaults are the schema defaults for every defaulted variable", () => {
    const env = EnvSchema.parse(MINIMAL);
    for (const name of ENV_PARSED_VAR_NAMES) {
      const doc = ENV_VAR_DOCS[name];
      if (doc.default === undefined) {
        continue;
      }
      const explicit = EnvSchema.parse({ ...MINIMAL, [name]: doc.default });
      expect(explicit[name as keyof typeof explicit], name).toEqual(env[name as keyof typeof env]);
    }
  });

  it("every documented example and quick-start value is accepted by the schema", () => {
    for (const name of ENV_PARSED_VAR_NAMES) {
      if (name === "FLOWAID_MASTER_KEY") {
        continue; // the example is an instruction, not a value
      }
      const doc = ENV_VAR_DOCS[name];
      const values = [doc.example, ...(doc.quickstart === undefined ? [] : [doc.quickstart])];
      for (const value of values) {
        const input: Record<string, string> = { ...MINIMAL, [name]: value };
        if (name === "FLOWAID_JWT_PRIVATE_KEY") {
          input.FLOWAID_JWT_PUBLIC_KEY = ENV_VAR_DOCS.FLOWAID_JWT_PUBLIC_KEY.example;
        }
        if (name === "FLOWAID_JWT_PUBLIC_KEY") {
          input.FLOWAID_JWT_PRIVATE_KEY = ENV_VAR_DOCS.FLOWAID_JWT_PRIVATE_KEY.example;
        }
        if (name === "FLOWAID_ADMIN_EMAIL") {
          input.FLOWAID_ADMIN_PASSWORD = ENV_VAR_DOCS.FLOWAID_ADMIN_PASSWORD.example;
        }
        if (name === "FLOWAID_ADMIN_PASSWORD") {
          input.FLOWAID_ADMIN_EMAIL = ENV_VAR_DOCS.FLOWAID_ADMIN_EMAIL.example;
        }
        if (name.startsWith("S3_") && !["S3_REGION", "S3_FORCE_PATH_STYLE"].includes(name)) {
          for (const key of [
            "S3_ENDPOINT",
            "S3_BUCKET",
            "S3_ACCESS_KEY",
            "S3_SECRET_KEY",
          ] as const) {
            input[key] = ENV_VAR_DOCS[key].example;
          }
        }
        if (name.startsWith("OIDC_")) {
          for (const key of ["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"] as const) {
            input[key] = ENV_VAR_DOCS[key].example;
          }
        }
        const result = EnvSchema.safeParse(input);
        expect(
          result.success,
          `${name}=${value}: ${result.success ? "" : JSON.stringify(result.error.issues)}`,
        ).toBe(true);
      }
    }
  });

  it("coerces integers, booleans, enums and lists", () => {
    const env = EnvSchema.parse({
      ...MINIMAL,
      PORT: " 8080 ",
      DB_RLS: "YES",
      MCP_STDIO_ENABLED: "1",
      S3_FORCE_PATH_STYLE: "off",
      LOG_LEVEL: "debug",
      WORKER_POOLS: "general, code ,retrieval",
      CORS_ORIGINS: "https://app.example.com/, http://localhost:3001",
      PROMETHEUS_PORT: "9464",
      FLOWAID_FEATURES_DISABLED: "agents, ai_builder",
      FLOWAID_BUNDLED_PLUGINS: "@flowaid/nodes-langchain,@acme/nodes-crm",
      FLOWAID_MCP_STDIO_ENV_ALLOWLIST: "PATH, HOME",
    });
    expect(env.PORT).toBe(8080);
    expect(env.DB_RLS).toBe(true);
    expect(env.MCP_STDIO_ENABLED).toBe(true);
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
    expect(env.LOG_LEVEL).toBe("debug");
    expect(env.WORKER_POOLS).toEqual(["general", "code", "retrieval"]);
    expect(env.CORS_ORIGINS).toEqual(["https://app.example.com", "http://localhost:3001"]);
    expect(env.PROMETHEUS_PORT).toBe(9464);
    expect(env.FLOWAID_FEATURES_DISABLED).toEqual(["agents", "ai_builder"]);
    expect(env.FLOWAID_BUNDLED_PLUGINS).toEqual(["@flowaid/nodes-langchain", "@acme/nodes-crm"]);
    expect(env.FLOWAID_MCP_STDIO_ENV_ALLOWLIST).toEqual(["PATH", "HOME"]);
  });

  it("rejects invalid scalars with messages naming the constraint", () => {
    const issues = issuesFor({
      ...MINIMAL,
      PORT: "abc",
      RATE_LIMIT_MAX: "0",
      NODE_ENV: "staging",
      DB_RLS: "maybe",
      WORKER_POOLS: "general,warp",
      WORKER_CONCURRENCY: "5000",
      CORS_ORIGINS: "https://app.example.com/path",
      FLOWAID_BASE_URL: "ftp://x",
      FLOWAID_ADMIN_EMAIL: "not-an-email",
      FLOWAID_ADMIN_PASSWORD: "short",
      FLOWAID_FEATURES_DISABLED: "agents,teleport",
      FLOWAID_SSE_MAX_STREAMS_PER_PRINCIPAL: "0",
      FLOWAID_EXPORT_MODE: "tarball",
      FLOWAID_PROVIDER_FIXTURES: "cache",
      RETENTION_SWEEP_CRON: "every night",
      FLOWAID_BUNDLED_PLUGINS: "Not A Package",
      FLOWAID_MCP_STDIO_ENV_ALLOWLIST: "PATH,9LIVES",
    });
    expect(issues.get("PORT")?.[0]).toContain("integer between 1 and 65535");
    expect(issues.get("RATE_LIMIT_MAX")?.[0]).toContain("at least 1");
    expect(issues.get("NODE_ENV")?.[0]).toContain("development, test, production");
    expect(issues.get("DB_RLS")?.[0]).toContain("true, false");
    expect(issues.get("WORKER_POOLS")?.[0]).toContain("general, code, browser");
    expect(issues.get("WORKER_CONCURRENCY")?.[0]).toContain("at most 1000");
    expect(issues.get("CORS_ORIGINS")?.[0]).toContain("origin without path");
    expect(issues.get("FLOWAID_BASE_URL")?.[0]).toContain("http:// or https://");
    expect(issues.get("FLOWAID_ADMIN_EMAIL")?.[0]).toContain("email");
    expect(issues.get("FLOWAID_ADMIN_PASSWORD")?.[0]).toContain("12 characters");
    expect(issues.get("FLOWAID_FEATURES_DISABLED")?.[0]).toContain(FEATURE_KEYS.join(", "));
    expect(issues.get("FLOWAID_SSE_MAX_STREAMS_PER_PRINCIPAL")?.[0]).toContain("at least 1");
    expect(issues.get("FLOWAID_EXPORT_MODE")?.[0]).toContain("npm, vendored");
    expect(issues.get("FLOWAID_PROVIDER_FIXTURES")?.[0]).toContain("off, record, replay");
    expect(issues.get("RETENTION_SWEEP_CRON")?.[0]).toContain("five-field cron");
    expect(issues.get("FLOWAID_BUNDLED_PLUGINS")?.[0]).toContain("npm package name");
    expect(issues.get("FLOWAID_MCP_STDIO_ENV_ALLOWLIST")?.[0]).toContain("variable name");
  });

  it("bounds the admin password at 256 characters", () => {
    const base = { ...MINIMAL, FLOWAID_ADMIN_EMAIL: "owner@example.com" };
    expect(issuesFor({ ...base, FLOWAID_ADMIN_PASSWORD: "x".repeat(256) }).size).toBe(0);
    expect(
      firstIssue({ ...base, FLOWAID_ADMIN_PASSWORD: "x".repeat(257) }, "FLOWAID_ADMIN_PASSWORD"),
    ).toContain("at most 256");
  });

  it("validates URL protocols per variable", () => {
    expect(issuesFor({ DATABASE_URL: "mysql://x" }).get("DATABASE_URL")?.[0]).toContain(
      "postgres://",
    );
    expect(issuesFor({ ...MINIMAL, REDIS_URL: "http://x" }).get("REDIS_URL")?.[0]).toContain(
      "redis://",
    );
    expect(
      issuesFor({ ...MINIMAL, DATABASE_ADMIN_URL: "mysql://x" }).get("DATABASE_ADMIN_URL")?.[0],
    ).toContain("postgres://");
    expect(issuesFor({ ...MINIMAL, REDIS_URL: "rediss://user:pw@host:6380/1" }).size).toBe(0);
    expect(issuesFor({ DATABASE_URL: "postgresql://u:p@h/db?sslmode=require" }).size).toBe(0);
  });

  it("parses FLOWAID_TRUST_PROXY as a boolean or an address list", () => {
    expect(EnvSchema.parse({ ...MINIMAL, FLOWAID_TRUST_PROXY: "yes" }).FLOWAID_TRUST_PROXY).toBe(
      true,
    );
    expect(EnvSchema.parse({ ...MINIMAL, FLOWAID_TRUST_PROXY: "0" }).FLOWAID_TRUST_PROXY).toBe(
      false,
    );
    expect(
      EnvSchema.parse({ ...MINIMAL, FLOWAID_TRUST_PROXY: "10.0.0.0/8, loopback,fd00::/8" })
        .FLOWAID_TRUST_PROXY,
    ).toEqual(["10.0.0.0/8", "loopback", "fd00::/8"]);
    expect(
      firstIssue({ ...MINIMAL, FLOWAID_TRUST_PROXY: "10.0.0.0/33" }, "FLOWAID_TRUST_PROXY"),
    ).toContain("CIDR");
    expect(
      firstIssue({ ...MINIMAL, FLOWAID_TRUST_PROXY: "proxy.internal" }, "FLOWAID_TRUST_PROXY"),
    ).toContain("IP address");
  });

  it("parses the stdio command allow-list with optional argument patterns", () => {
    const env = EnvSchema.parse({
      ...MINIMAL,
      FLOWAID_MCP_STDIO_ALLOWED_COMMANDS: "/usr/local/bin/mcp-fs=^/srv/data(/|$),/usr/bin/mcp-git",
    });
    expect(env.FLOWAID_MCP_STDIO_ALLOWED_COMMANDS).toEqual([
      { command: "/usr/local/bin/mcp-fs", argsPattern: "^/srv/data(/|$)" },
      { command: "/usr/bin/mcp-git" },
    ]);
    expect(
      firstIssue(
        { ...MINIMAL, FLOWAID_MCP_STDIO_ALLOWED_COMMANDS: "mcp-fs" },
        "FLOWAID_MCP_STDIO_ALLOWED_COMMANDS",
      ),
    ).toContain("absolute path");
    expect(
      firstIssue(
        { ...MINIMAL, FLOWAID_MCP_STDIO_ALLOWED_COMMANDS: "/usr/bin/x=(" },
        "FLOWAID_MCP_STDIO_ALLOWED_COMMANDS",
      ),
    ).toContain("regular expression");
  });

  it("validates the master key encoding", () => {
    const base64 = Buffer.alloc(32, 7).toString("base64");
    const hex = Buffer.alloc(32, 7).toString("hex");
    expect(issuesFor({ ...MINIMAL, FLOWAID_MASTER_KEY: base64 }).size).toBe(0);
    expect(issuesFor({ ...MINIMAL, FLOWAID_MASTER_KEY: hex }).size).toBe(0);
    expect(
      issuesFor({ ...MINIMAL, FLOWAID_MASTER_KEY: "too-short" }).get("FLOWAID_MASTER_KEY")?.[0],
    ).toContain("32 bytes");
    expect(
      issuesFor({ ...MINIMAL, FLOWAID_MASTER_KEY: Buffer.alloc(16).toString("base64") }).size,
    ).toBe(1);
  });

  it("accepts PEM keys with literal or escaped newlines and rejects other text", () => {
    const pub = PUBLIC_PEM.replace(/\n/g, "\\n");
    const env = EnvSchema.parse({
      ...MINIMAL,
      FLOWAID_JWT_PRIVATE_KEY: PRIVATE_PEM,
      FLOWAID_JWT_PUBLIC_KEY: pub,
    });
    expect(env.FLOWAID_JWT_PUBLIC_KEY).toBe(PUBLIC_PEM);
    expect(env.FLOWAID_JWT_PRIVATE_KEY).toBe(PRIVATE_PEM);
    const bad = issuesFor({
      ...MINIMAL,
      FLOWAID_JWT_PRIVATE_KEY: "nope",
      FLOWAID_JWT_PUBLIC_KEY: pub,
    });
    expect(bad.get("FLOWAID_JWT_PRIVATE_KEY")?.[0]).toContain("PEM");
  });

  it("enforces cross-variable rules", () => {
    const jwt = issuesFor({ ...MINIMAL, FLOWAID_JWT_PUBLIC_KEY: PUBLIC_PEM });
    expect(jwt.get("FLOWAID_JWT_PRIVATE_KEY")?.[0]).toContain("must be set together");

    const admin = issuesFor({ ...MINIMAL, FLOWAID_ADMIN_EMAIL: "a@b.co" });
    expect(admin.get("FLOWAID_ADMIN_PASSWORD")?.[0]).toContain("must be set together");

    const s3 = issuesFor({ ...MINIMAL, S3_ENDPOINT: "http://minio:9000", S3_BUCKET: "b" });
    expect(s3.get("S3_ACCESS_KEY")?.[0]).toContain("required when S3_ENDPOINT, S3_BUCKET are set");
    expect(s3.get("S3_SECRET_KEY")?.[0]).toContain("S3_SECRET_KEY");
    expect(s3.has("S3_ENDPOINT")).toBe(false);

    const oidc = issuesFor({ ...MINIMAL, OIDC_ISSUER: "https://login.example.com" });
    expect(oidc.get("OIDC_CLIENT_ID")?.[0]).toContain("required when OIDC_ISSUER is set");
    expect(oidc.get("OIDC_CLIENT_SECRET")?.[0]).toContain("OIDC needs all of");
    const claim = issuesFor({ ...MINIMAL, OIDC_ROLE_CLAIM: "roles" });
    expect(claim.get("OIDC_ROLE_CLAIM")?.[0]).toContain("without OIDC_ISSUER");

    // Both master key sources may be set: the variable wins and the file path is ignored
    // (compose always sets the file path and passes FLOWAID_MASTER_KEY through when present).
    const master = issuesFor({
      ...MINIMAL,
      FLOWAID_MASTER_KEY: Buffer.alloc(32, 1).toString("base64"),
      FLOWAID_MASTER_KEY_FILE: "/etc/flowaid/master.key",
    });
    expect(master.size).toBe(0);

    const prom = issuesFor({ ...MINIMAL, PORT: "9000", PROMETHEUS_PORT: "9000" });
    expect(prom.get("PROMETHEUS_PORT")?.[0]).toContain("differ from PORT");
  });

  it("strips unknown variables instead of failing on them", () => {
    const env = EnvSchema.parse({ ...MINIMAL, PATH: "/usr/bin", HOME: "/root" });
    expect("PATH" in env).toBe(false);
  });
});

describe("production rules", () => {
  it("accept a complete production configuration", () => {
    expect(issuesFor(PRODUCTION).size).toBe(0);
  });

  it("do not apply in development or test", () => {
    for (const NODE_ENV of ["development", "test"]) {
      const issues = issuesFor({
        ...MINIMAL,
        NODE_ENV,
        CORS_ORIGINS: "*",
        FLOWAID_BASE_URL: "http://api.example.com",
        FLOWAID_ADMIN_EMAIL: "owner@example.com",
        FLOWAID_ADMIN_PASSWORD: ENV_VAR_DOCS.FLOWAID_ADMIN_PASSWORD.example,
      });
      expect(issues.size, NODE_ENV).toBe(0);
    }
  });

  it("refuse the minimal environment in production and name every problem", () => {
    const issues = issuesFor({ ...MINIMAL, NODE_ENV: "production" });
    expect(issues.get("FLOWAID_JWT_PRIVATE_KEY")?.[0]).toContain("required in production");
    expect(issues.get("FLOWAID_MASTER_KEY")?.[0]).toContain("required in production");
    // loopback defaults are allowed over http
    expect(issues.has("FLOWAID_BASE_URL")).toBe(false);
    expect(issues.has("FLOWAID_WEB_URL")).toBe(false);
    expect(issues.has("CORS_ORIGINS")).toBe(false);
  });

  it("reject CORS_ORIGINS=* with no override", () => {
    expect(firstIssue({ ...PRODUCTION, CORS_ORIGINS: "*" }, "CORS_ORIGINS")).toContain(
      "must not contain *",
    );
    expect(
      firstIssue({ ...PRODUCTION, CORS_ORIGINS: "https://app.example.com,*" }, "CORS_ORIGINS"),
    ).toContain("must not contain *");
  });

  it("require https public URLs unless loopback or FLOWAID_ALLOW_INSECURE_HTTP", () => {
    for (const name of ["FLOWAID_BASE_URL", "FLOWAID_WEB_URL"] as const) {
      const insecure = { ...PRODUCTION, [name]: "http://api.example.com" };
      expect(firstIssue(insecure, name)).toContain("must be https://");
      expect(issuesFor({ ...insecure, FLOWAID_ALLOW_INSECURE_HTTP: "true" }).has(name)).toBe(false);
      for (const loopback of [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://[::1]:3000",
      ]) {
        const input = { ...PRODUCTION, [name]: loopback, CORS_ORIGINS: "https://app.example.com" };
        expect(issuesFor({ ...input, FLOWAID_ALLOW_CROSS_SITE: "true" }).has(name), loopback).toBe(
          false,
        );
      }
    }
    const oidc = {
      ...PRODUCTION,
      OIDC_ISSUER: "http://login.example.com",
      OIDC_CLIENT_ID: "flowaid",
      OIDC_CLIENT_SECRET: "s3cret",
    };
    expect(firstIssue(oidc, "OIDC_ISSUER")).toContain("must be https://");
    expect(issuesFor({ ...oidc, FLOWAID_ALLOW_INSECURE_HTTP: "1" }).size).toBe(0);
  });

  it("reject the documented, quick-start and commonly guessed admin passwords", () => {
    const doc = ENV_VAR_DOCS.FLOWAID_ADMIN_PASSWORD;
    const withPassword = (password: string): Record<string, string> => ({
      ...PRODUCTION,
      FLOWAID_ADMIN_EMAIL: "owner@example.com",
      FLOWAID_ADMIN_PASSWORD: password,
    });
    expect(firstIssue(withPassword(doc.example), "FLOWAID_ADMIN_PASSWORD")).toContain(
      "documented example",
    );
    expect(doc.quickstart).toBeDefined();
    expect(firstIssue(withPassword(doc.quickstart ?? ""), "FLOWAID_ADMIN_PASSWORD")).toContain(
      "documented example",
    );
    expect(ADMIN_PASSWORD_DENY_LIST).toHaveLength(20);
    for (const weak of ADMIN_PASSWORD_DENY_LIST) {
      expect(weak.length, weak).toBeGreaterThanOrEqual(12);
      expect(
        firstIssue(withPassword(weak.toUpperCase()), "FLOWAID_ADMIN_PASSWORD"),
        weak,
      ).toContain("commonly guessed");
    }
    expect(issuesFor(withPassword("9f2c-Tk8!wq-Lm4z-Vb7p")).size).toBe(0);
  });

  it("require JWT keys unless FLOWAID_JWT_KEYS_DIR is set explicitly", () => {
    const { FLOWAID_JWT_PRIVATE_KEY: _priv, FLOWAID_JWT_PUBLIC_KEY: _pub, ...noKeys } = PRODUCTION;
    expect(firstIssue(noKeys, "FLOWAID_JWT_PRIVATE_KEY")).toContain("FLOWAID_JWT_KEYS_DIR");
    expect(issuesFor({ ...noKeys, FLOWAID_JWT_KEYS_DIR: "/var/lib/flowaid/keys" }).size).toBe(0);
    // the documented default written out explicitly is not an explicit choice
    expect(
      issuesFor({
        ...noKeys,
        FLOWAID_JWT_KEYS_DIR: ENV_VAR_DOCS.FLOWAID_JWT_KEYS_DIR.default ?? "",
      }).size,
    ).toBe(1);
  });

  it("require a master key source unless FLOWAID_MASTER_KEY_AUTOGENERATE is set", () => {
    const { FLOWAID_MASTER_KEY: _key, ...noKey } = PRODUCTION;
    expect(firstIssue(noKey, "FLOWAID_MASTER_KEY")).toContain("FLOWAID_MASTER_KEY_AUTOGENERATE");
    expect(issuesFor({ ...noKey, FLOWAID_MASTER_KEY_FILE: "/data/master.key" }).size).toBe(0);
    expect(issuesFor({ ...noKey, FLOWAID_MASTER_KEY_AUTOGENERATE: "true" }).size).toBe(0);
  });

  it("exempt a code-only worker from the key requirements and refuse a master key on it", () => {
    const { FLOWAID_MASTER_KEY: _key, FLOWAID_JWT_PRIVATE_KEY: _priv, ...noKeys } = PRODUCTION;
    const { FLOWAID_JWT_PUBLIC_KEY: _pub, ...bare } = noKeys;
    // the same environment fails for an api or general worker ...
    expect(issuesFor(bare).has("FLOWAID_MASTER_KEY")).toBe(true);
    expect(issuesFor(bare).has("FLOWAID_JWT_PRIVATE_KEY")).toBe(true);
    // ... and passes for the sandbox host (compose worker-code)
    expect(issuesFor({ ...bare, WORKER_POOLS: "code" }).size).toBe(0);
    // a worker that also serves another pool is not a sandbox host
    expect(issuesFor({ ...bare, WORKER_POOLS: "code,general" }).has("FLOWAID_MASTER_KEY")).toBe(
      true,
    );
    // a sandbox host must not hold a master key, from the variable or an explicit file
    expect(
      firstIssue(
        { ...bare, WORKER_POOLS: "code", FLOWAID_MASTER_KEY: PRODUCTION.FLOWAID_MASTER_KEY },
        "FLOWAID_MASTER_KEY",
      ),
    ).toContain("sandbox host never holds a master key");
    expect(
      firstIssue(
        { ...bare, WORKER_POOLS: "code", FLOWAID_MASTER_KEY_FILE: "/data/master.key" },
        "FLOWAID_MASTER_KEY_FILE",
      ),
    ).toContain("sandbox host never holds a master key");
    // outside production a code-only worker may carry a key (single-process local runs)
    expect(
      issuesFor({
        ...MINIMAL,
        WORKER_POOLS: "code",
        FLOWAID_MASTER_KEY: PRODUCTION.FLOWAID_MASTER_KEY,
      }).size,
    ).toBe(0);
  });

  it("reject cross-site CORS origins unless FLOWAID_ALLOW_CROSS_SITE", () => {
    const sameSite = { ...PRODUCTION, CORS_ORIGINS: "https://app.example.com,https://example.com" };
    expect(issuesFor(sameSite).size).toBe(0);
    const crossSite = { ...PRODUCTION, CORS_ORIGINS: "https://app.example.com,https://other.test" };
    expect(firstIssue(crossSite, "CORS_ORIGINS")).toContain("https://other.test is cross-site");
    expect(issuesFor({ ...crossSite, FLOWAID_ALLOW_CROSS_SITE: "true" }).size).toBe(0);
    // a different scheme is a different site
    const schemeful = {
      ...PRODUCTION,
      CORS_ORIGINS: "http://app.example.com",
      FLOWAID_ALLOW_INSECURE_HTTP: "true",
    };
    expect(firstIssue(schemeful, "CORS_ORIGINS")).toContain("cross-site");
  });

  it("are reported by crossFieldIssues on raw strings as well as on parsed values", () => {
    const raw = crossFieldIssues({ NODE_ENV: "production", CORS_ORIGINS: "*" });
    expect(raw.map((issue) => issue.path)).toContain("CORS_ORIGINS");
    const parsed = crossFieldIssues({ NODE_ENV: "production", CORS_ORIGINS: ["*"] });
    expect(parsed.map((issue) => issue.path)).toContain("CORS_ORIGINS");
  });
});

describe("site helpers", () => {
  it("recognise loopback hosts", () => {
    for (const host of ["localhost", "api.localhost", "127.0.0.1", "127.1.2.3", "[::1]", "::1"]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
    for (const host of ["example.com", "10.0.0.1", "localhost.example.com", "[fe80::1]"]) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });

  it("compute schemeful sites from the last two labels", () => {
    expect(siteOf(new URL("https://app.example.com:8443/x"))).toBe("https://example.com");
    expect(siteOf(new URL("https://example.com"))).toBe("https://example.com");
    expect(siteOf(new URL("http://example.com"))).toBe("http://example.com");
    expect(siteOf(new URL("https://10.0.0.1:3000"))).toBe("https://10.0.0.1");
    expect(siteOf(new URL("https://[::1]:3000"))).toBe("https://[::1]");
    expect(siteOf(new URL("https://localhost:3000"))).toBe("https://localhost");
  });
});
