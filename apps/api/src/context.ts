/** Everything a route needs, built once in `buildServer` (tests build it over a test database). */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "@flowaid/database";
import type { CredentialService } from "@flowaid/credentials";
import type { QueueDriver, SafeFetch } from "@flowaid/workflow-core";
import type { RunEventHub } from "./services/hub.js";
import type { Env } from "@flowaid/env";
import type { ProviderRegistry } from "@flowaid/providers";
import type { AuthService } from "./auth/service.js";
import type { AlertDispatcher } from "@flowaid/observability";
import type { JwtKeys } from "./auth/jwt.js";
import type { S3Options } from "@flowaid/storage";

export interface ApiConfig {
  production: boolean;
  /** `Secure` cookies unless FLOWAID_ALLOW_INSECURE_HTTP */
  secureCookies: boolean;
  baseUrl: string;
  webUrl: string;
  corsOrigins: readonly string[];
  trustProxy: boolean | string | string[];
  rateLimit: { session: number; apiKey: number; public: number };
  sseMaxStreamsPerPrincipal: number;
  featuresDisabled: readonly string[];
  hasRedis: boolean;
  hasOidc: boolean;
  /** Development and tests only: outbound calls may reach private addresses. Never in production. */
  allowPrivateNetwork: boolean;
  /** Local artifact storage shared with the worker (`<data>/artifacts`); null when unavailable. */
  artifactsDir: string | null;
  /** S3-compatible artifact storage (all four S3_ variables set); new artifacts go there. */
  s3: S3Options | null;
  /** Code export: default dependency mode (FLOWAID_EXPORT_MODE). */
  exportMode: "npm" | "vendored";
  /** The packed runtime packages exist (FLOWAID_VENDOR_DIR/SHA256SUMS), so vendored exports work. */
  vendorAvailable: boolean;
  /** Plugins (ARCHITECTURE.md §3.5): the allow-list, the npm registry, and whether local installs are accepted. */
  plugins: { allowList: readonly string[]; registry: string; allowLocal: boolean };
}

export interface Clock {
  now(): number;
}

export interface ApiContext {
  config: ApiConfig;
  db: Database;
  keys: JwtKeys;
  auth: AuthService;
  clock: Clock;
  /** where `run.start`, `run.resume` and `run.control` go (Postgres or BullMQ) */
  queue: QueueDriver;
  /** run notifications for SSE and sync waits */
  hub: RunEventHub;
  /** envelope encryption of credential values */
  credentials: CredentialService;
  /** SSRF-guarded fetch for outbound calls the API makes (OpenAPI import, MCP discovery, credential tests) */
  http: SafeFetch;
  env?: Env;
  /** providers the advisor generates and judges with (P6-02); built from the server's factories */
  providers?: ProviderRegistry;
  /** observability alerts to notification channels (P6-04); absent in most tests */
  alerts?: AlertDispatcher;
}

export function configFromEnv(env: Env): ApiConfig {
  const trust = env.FLOWAID_TRUST_PROXY as unknown;
  return {
    production: env.flags.isProduction,
    secureCookies: !env.FLOWAID_ALLOW_INSECURE_HTTP,
    baseUrl: String(env.FLOWAID_BASE_URL),
    webUrl: String(env.FLOWAID_WEB_URL ?? env.FLOWAID_BASE_URL),
    corsOrigins: env.CORS_ORIGINS ?? [],
    trustProxy:
      typeof trust === "boolean" || typeof trust === "string" || Array.isArray(trust)
        ? (trust as boolean | string | string[])
        : false,
    rateLimit: { session: 600, apiKey: 1200, public: Number(env.RATE_LIMIT_MAX ?? 120) },
    sseMaxStreamsPerPrincipal: Number(env.FLOWAID_SSE_MAX_STREAMS_PER_PRINCIPAL ?? 20),
    featuresDisabled: env.FLOWAID_FEATURES_DISABLED ?? [],
    hasRedis: env.flags.hasRedis,
    hasOidc: env.flags.hasOidc,
    allowPrivateNetwork: false,
    artifactsDir: `${String(env.FLOWAID_MASTER_KEY_FILE ?? "/data/master.key").replace(/\/[^/]*$/, "")}/artifacts`,
    s3:
      env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY
        ? {
            endpoint: env.S3_ENDPOINT,
            bucket: env.S3_BUCKET,
            accessKey: env.S3_ACCESS_KEY,
            secretKey: env.S3_SECRET_KEY,
            region: env.S3_REGION,
            forcePathStyle: env.S3_FORCE_PATH_STYLE,
          }
        : null,
    exportMode: env.FLOWAID_EXPORT_MODE === "npm" ? "npm" : "vendored",
    vendorAvailable: existsSync(
      join(String(env.FLOWAID_VENDOR_DIR ?? "/opt/flowaid/vendor"), "SHA256SUMS"),
    ),
    plugins: {
      allowList: env.FLOWAID_PLUGIN_ALLOWED_SCOPES,
      registry: String(env.FLOWAID_PLUGIN_REGISTRY),
      allowLocal: env.FLOWAID_PLUGIN_ALLOW_LOCAL,
    },
  };
}

/** Sensible defaults for tests and local development. */
export function defaultConfig(over: Partial<ApiConfig> = {}): ApiConfig {
  return {
    production: false,
    secureCookies: true,
    baseUrl: "http://localhost:3001",
    webUrl: "http://localhost:3000",
    corsOrigins: ["http://localhost:3000"],
    trustProxy: false,
    rateLimit: { session: 600, apiKey: 1200, public: 120 },
    sseMaxStreamsPerPrincipal: 20,
    featuresDisabled: [],
    hasRedis: false,
    hasOidc: false,
    allowPrivateNetwork: false,
    artifactsDir: null,
    s3: null,
    exportMode: "npm",
    vendorAvailable: false,
    plugins: { allowList: ["@flowaid"], registry: "https://registry.npmjs.org", allowLocal: false },
    ...over,
  };
}
