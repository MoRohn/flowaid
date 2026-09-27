/** Everything a route needs, built once in `buildServer` (tests build it over a test database). */
import type { Database } from "@flowaid/database";
import type { CredentialService } from "@flowaid/credentials";
import type { QueueDriver, SafeFetch } from "@flowaid/workflow-core";
import type { RunEventHub } from "./services/hub.js";
import type { Env } from "@flowaid/env";
import type { AuthService } from "./auth/service.js";
import type { JwtKeys } from "./auth/jwt.js";

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
  /** Local artifact storage shared with the worker (`<data>/artifacts`); null when artifacts live in S3. */
  artifactsDir: string | null;
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
    ...over,
  };
}
