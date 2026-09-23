import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ENV_COMPOSE_ONLY_VAR_NAMES,
  ENV_COMPOSE_REQUIRED_VAR_NAMES,
  ENV_GROUPS,
  ENV_PARSED_VAR_NAMES,
  ENV_VAR_DOCS,
  ENV_VAR_NAMES,
  SECRET_ENV_KEYS,
  envVarDoc,
  isDocumentedEnvName,
} from "./docs.js";
import {
  README_TABLE_END,
  README_TABLE_START,
  injectReadmeTable,
  renderEnvExample,
  renderReadmeTable,
} from "./render.js";

const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = dirname(dirname(PACKAGE_DIR));

/** Markdown files whose backticked variable names must all be documented. */
const DOCS_WITH_VARIABLES = ["README.md", "SECURITY.md", "docker/README.md"];

/** Variable-name prefixes the documentation test recognises inside backticks. */
const TOKEN_RE = /\b(?:FLOWAID|S3|DB|OIDC)_[A-Z0-9_]+/g;

function backtickedTokens(markdown: string): string[] {
  const tokens = new Set<string>();
  for (const span of markdown.matchAll(/`([^`\n]+)`/g)) {
    for (const token of (span[1] ?? "").matchAll(TOKEN_RE)) {
      tokens.add(token[0]);
    }
  }
  return [...tokens].sort();
}

describe("environment variable documentation", () => {
  it("documents every variable with a description, example and consistent required/default", () => {
    for (const name of ENV_VAR_NAMES) {
      const doc = envVarDoc(name);
      if (doc.pattern === true) {
        expect(name, "family names are SCREAMING_SNAKE_CASE with a <NAME> placeholder").toMatch(
          /^[A-Z][A-Z0-9_]+_<NAME>$/,
        );
        expect(doc.required, `${name} is a family and cannot be required`).toBe(false);
        expect(doc.default, `${name} is a family and cannot have a default`).toBeUndefined();
      } else {
        expect(name, "variable names are SCREAMING_SNAKE_CASE").toMatch(/^[A-Z][A-Z0-9_]+$/);
      }
      expect(doc.description.length, `${name} description`).toBeGreaterThan(20);
      expect(doc.example.length, `${name} example`).toBeGreaterThan(0);
      expect(ENV_GROUPS).toContain(doc.group);
      if (doc.required) {
        expect(doc.default, `${name} is required and must not have a default`).toBeUndefined();
      }
      if (doc.quickstart !== undefined) {
        expect(doc.required, `${name} quick-start values are for optional variables`).toBe(false);
        expect(
          doc.default,
          `${name} quick-start values are for undefaulted variables`,
        ).toBeUndefined();
      }
      if (doc.values !== undefined && doc.default !== undefined) {
        for (const item of doc.default.split(",")) {
          expect(doc.values, `${name} default must be one of its values`).toContain(item.trim());
        }
      }
    }
    expect(ENV_PARSED_VAR_NAMES.length).toBe(
      ENV_VAR_NAMES.length - 1 - ENV_COMPOSE_ONLY_VAR_NAMES.length,
    );
    expect(SECRET_ENV_KEYS.every((name) => ENV_VAR_DOCS[name].secret)).toBe(true);
  });

  it("keeps compose-only variables documented, grouped and out of the schema", () => {
    expect(ENV_COMPOSE_ONLY_VAR_NAMES).toEqual(
      expect.arrayContaining([
        "POSTGRES_PASSWORD",
        "POSTGRES_CODE_PASSWORD",
        "REDIS_PASSWORD",
        "BIND_ADDRESS",
      ]),
    );
    for (const name of ENV_COMPOSE_ONLY_VAR_NAMES) {
      const doc = envVarDoc(name);
      expect(doc.group, `${name} belongs to the compose group`).toBe("compose");
      expect(doc.required, `${name} cannot be schema-required`).toBe(false);
      expect(doc.pattern, `${name} is not a family`).toBeUndefined();
      expect(ENV_PARSED_VAR_NAMES, `${name} is not parsed`).not.toContain(name);
      expect(SECRET_ENV_KEYS, `${name} is not a schema secret`).not.toContain(name);
    }
    for (const name of ENV_VAR_NAMES) {
      const doc = envVarDoc(name);
      if (doc.group === "compose") {
        expect(doc.composeOnly, `${name} in the compose group must be compose-only`).toBe(true);
      }
    }
    expect(ENV_COMPOSE_REQUIRED_VAR_NAMES).toEqual([
      "S3_SECRET_KEY",
      "POSTGRES_PASSWORD",
      "POSTGRES_CODE_PASSWORD",
    ]);
    for (const name of ENV_COMPOSE_REQUIRED_VAR_NAMES) {
      const doc = envVarDoc(name);
      expect(doc.default, `${name} has no default`).toBeUndefined();
      expect(doc.quickstart, `${name} has no quick-start value`).toBeUndefined();
      expect(doc.required, `${name} is not schema-required`).toBe(false);
      expect(doc.secret, `${name} is a secret`).toBe(true);
    }
  });

  it("covers every variable named in the architecture", () => {
    const expected = [
      "DATABASE_URL",
      "DATABASE_ADMIN_URL",
      "REDIS_URL",
      "FLOWAID_MASTER_KEY",
      "FLOWAID_MASTER_KEY_FILE",
      "FLOWAID_MASTER_KEY_AUTOGENERATE",
      "FLOWAID_JWT_PRIVATE_KEY",
      "FLOWAID_JWT_PUBLIC_KEY",
      "FLOWAID_BASE_URL",
      "FLOWAID_WEB_URL",
      "FLOWAID_API_INTERNAL_URL",
      "FLOWAID_ALLOW_INSECURE_HTTP",
      "FLOWAID_ALLOW_CROSS_SITE",
      "FLOWAID_TRUST_PROXY",
      "FLOWAID_SSE_MAX_STREAMS_PER_PRINCIPAL",
      "FLOWAID_EXPORT_MODE",
      "FLOWAID_VENDOR_DIR",
      "FLOWAID_FEATURES_DISABLED",
      "FLOWAID_BUNDLED_PLUGINS",
      "FLOWAID_PLUGIN_ALLOW_LOCAL",
      "FLOWAID_MCP_STDIO_ALLOWED_COMMANDS",
      "FLOWAID_MCP_STDIO_ENV_ALLOWLIST",
      "FLOWAID_QUEUE_UI",
      "FLOWAID_PROVIDER_FIXTURES",
      "FLOWAID_PROVIDER_FIXTURES_DIR",
      "RETENTION_SWEEP_CRON",
      "OIDC_ISSUER",
      "OIDC_CLIENT_ID",
      "OIDC_CLIENT_SECRET",
      "OIDC_ROLE_CLAIM",
      "FLOWAID_SECRET_<NAME>",
      "PORT",
      "HOST",
      "LOG_LEVEL",
      "NODE_ENV",
      "WORKER_POOLS",
      "WORKER_CONCURRENCY",
      "SANDBOX_MODE",
      "MCP_STDIO_ENABLED",
      "DB_RLS",
      "RUN_EVENTS_PARTITIONED",
      "S3_ENDPOINT",
      "S3_BUCKET",
      "S3_ACCESS_KEY",
      "S3_SECRET_KEY",
      "S3_REGION",
      "S3_FORCE_PATH_STYLE",
      "TYPESAFE_API_KEY",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "OLLAMA_HOST",
      "OTEL_EXPORTER_OTLP_ENDPOINT",
      "PROMETHEUS_PORT",
      "FLOWAID_PLUGIN_DIR",
      "FLOWAID_ADMIN_EMAIL",
      "FLOWAID_ADMIN_PASSWORD",
      "CORS_ORIGINS",
      "RATE_LIMIT_MAX",
    ];
    for (const name of expected) {
      expect(Object.keys(ENV_VAR_DOCS), name).toContain(name);
    }
  });

  it("the checked-in .env.example is generated from the table", () => {
    const current = readFileSync(join(REPO_ROOT, ".env.example"), "utf8");
    expect(current).toBe(renderEnvExample());
  });

  it("the checked-in README table is generated from the table", () => {
    const readme = readFileSync(join(PACKAGE_DIR, "README.md"), "utf8");
    expect(readme).toContain(README_TABLE_START);
    expect(readme).toContain(README_TABLE_END);
    expect(readme).toBe(injectReadmeTable(readme));
    expect(readme).toContain(renderReadmeTable());
  });

  it("renders required variables set, defaults set, quick-start values set and optionals commented", () => {
    const text = renderEnvExample();
    expect(text).toContain("\nDATABASE_URL=postgres://flowaid:flowaid@localhost:5432/flowaid\n");
    expect(text).toContain("\nPORT=3000\n");
    expect(text).toContain("\n# REDIS_URL=redis://localhost:6379\n");
    expect(text).toContain("# Values: development | test | production");
    expect(text).toContain("\nFLOWAID_ADMIN_EMAIL=admin@flowaid.local\n");
    expect(text).toContain("\nFLOWAID_ADMIN_PASSWORD=flowaid-local-admin\n");
    expect(text).toContain("\n# FLOWAID_SECRET_<NAME>=<value>\n");
    // compose-required passwords are present, uncommented and empty
    expect(text).toContain("\nPOSTGRES_PASSWORD=\n");
    expect(text).toContain("\nPOSTGRES_CODE_PASSWORD=\n");
    expect(text).toContain("\nS3_SECRET_KEY=\n");
    expect(text).toContain("\n# REDIS_PASSWORD=<openssl rand -hex 16>\n");
    expect(text).toContain("\nBIND_ADDRESS=127.0.0.1\n");
    expect(text).toContain("\nHOST=127.0.0.1\n");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("injectReadmeTable requires both markers", () => {
    expect(() => injectReadmeTable("no markers")).toThrow("markers");
  });

  it("isDocumentedEnvName accepts variables, the secret family and nothing else", () => {
    expect(isDocumentedEnvName("DATABASE_URL")).toBe(true);
    expect(isDocumentedEnvName("FLOWAID_SECRET_SLACK_TOKEN")).toBe(true);
    expect(isDocumentedEnvName("FLOWAID_SECRET_")).toBe(true);
    expect(isDocumentedEnvName("FLOWAID_ENCRYPTION_KEY")).toBe(false);
    expect(isDocumentedEnvName("toString")).toBe(false);
  });

  it.each(DOCS_WITH_VARIABLES)(
    "every backticked FLOWAID_/S3_/DB_/OIDC_ token in %s is a documented variable",
    (file) => {
      const markdown = readFileSync(join(REPO_ROOT, file), "utf8");
      const tokens = backtickedTokens(markdown);
      const unknown = tokens.filter((token) => !isDocumentedEnvName(token));
      expect(unknown, `${file} names variables that packages/env does not document`).toEqual([]);
    },
  );
});
