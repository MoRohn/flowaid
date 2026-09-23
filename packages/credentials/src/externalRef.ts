/**
 * External credential references (ARCHITECTURE.md §10.6, DATABASE.md `credentials.external_ref`):
 * the value lives in the environment or a secret manager and is fetched when used.
 *
 *   env:FLOWAID_SECRET_<NAME>                       only that prefix, never a platform setting
 *   vault:<path>#<key>                              KV v2 (`<mount>/<path>` read through the data API)
 *   aws-sm:arn:aws:secretsmanager:<region>:<acct>:secret:<name>[#<json key>]
 *   azure-kv:<vault>/<secret>[/<version>]           parsed now, resolved in P6-07
 *   gcp-sm:projects/<p>/secrets/<s>/versions/<v>    parsed now, resolved in P6-07
 *
 * `env:` refuses every name the environment schema knows (`ENV_SCHEMA_KEYS`), so a credential
 * can never read `FLOWAID_MASTER_KEY`, `DATABASE_URL` or another platform secret.
 */
import { ENV_SCHEMA_KEYS } from "@flowaid/env";
import { BadRequestError, CredentialError, type SafeFetch } from "@flowaid/workflow-core";

export type ExternalRef =
  | { scheme: "env"; name: string }
  | { scheme: "vault"; path: string; key: string }
  | { scheme: "aws-sm"; arn: string; jsonKey?: string }
  | { scheme: "azure-kv"; vault: string; secret: string; version?: string }
  | { scheme: "gcp-sm"; project: string; secret: string; version: string };

const ENV_NAME = /^FLOWAID_SECRET_[A-Z0-9_]+$/;
const PLATFORM_KEYS = new Set(ENV_SCHEMA_KEYS);

export type ParseRefResult = { ok: true; ref: ExternalRef } | { ok: false; reason: string };

export function parseExternalRef(text: string): ParseRefResult {
  const colon = text.indexOf(":");
  if (colon < 0)
    return { ok: false, reason: "missing scheme (env:, vault:, aws-sm:, azure-kv:, gcp-sm:)" };
  const scheme = text.slice(0, colon);
  const rest = text.slice(colon + 1);
  switch (scheme) {
    case "env":
      if (!ENV_NAME.test(rest))
        return {
          ok: false,
          reason: "env references must name FLOWAID_SECRET_<NAME> (uppercase letters, digits, _)",
        };
      if (PLATFORM_KEYS.has(rest))
        return { ok: false, reason: `${rest} is a platform setting, not a credential` };
      return { ok: true, ref: { scheme: "env", name: rest } };
    case "vault": {
      const m = /^([A-Za-z0-9_\-./]+)#([A-Za-z0-9_.-]+)$/.exec(rest);
      if (!m?.[1] || !m[2] || m[1].includes("..") || m[1].startsWith("/")) {
        return { ok: false, reason: "vault references look like vault:<mount>/<path>#<key>" };
      }
      return { ok: true, ref: { scheme: "vault", path: m[1], key: m[2] } };
    }
    case "aws-sm": {
      const m =
        /^(arn:aws[a-z-]*:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+)(?:#([A-Za-z0-9_.-]+))?$/.exec(
          rest,
        );
      if (!m?.[1])
        return {
          ok: false,
          reason: "aws-sm references are Secrets Manager ARNs (optionally #<json key>)",
        };
      return {
        ok: true,
        ref: m[2]
          ? { scheme: "aws-sm", arn: m[1], jsonKey: m[2] }
          : { scheme: "aws-sm", arn: m[1] },
      };
    }
    case "azure-kv": {
      const m = /^([a-z0-9-]{3,24})\/([A-Za-z0-9-]{1,127})(?:\/([0-9a-f]{32}))?$/.exec(rest);
      if (!m?.[1] || !m[2])
        return {
          ok: false,
          reason: "azure-kv references look like azure-kv:<vault>/<secret>[/<version>]",
        };
      return {
        ok: true,
        ref: m[3]
          ? { scheme: "azure-kv", vault: m[1], secret: m[2], version: m[3] }
          : { scheme: "azure-kv", vault: m[1], secret: m[2] },
      };
    }
    case "gcp-sm": {
      const m = /^projects\/([a-z0-9-]+)\/secrets\/([A-Za-z0-9_-]+)\/versions\/(latest|\d+)$/.exec(
        rest,
      );
      if (!m?.[1] || !m[2] || !m[3])
        return {
          ok: false,
          reason: "gcp-sm references look like gcp-sm:projects/<p>/secrets/<s>/versions/<v>",
        };
      return { ok: true, ref: { scheme: "gcp-sm", project: m[1], secret: m[2], version: m[3] } };
    }
    default:
      return { ok: false, reason: `unknown scheme '${scheme}'` };
  }
}

/** Validates an external reference at write time (the API returns 400 with the reason). */
export function assertExternalRef(text: string): ExternalRef {
  const parsed = parseExternalRef(text);
  if (!parsed.ok)
    throw new BadRequestError(`Invalid external credential reference: ${parsed.reason}`);
  return parsed.ref;
}

export interface SecretsManagerClient {
  getSecretString(arn: string): Promise<string>;
}

export interface ExternalResolverOptions {
  /** `FLOWAID_SECRET_*` values, loaded by `@flowaid/env` (this package never reads process.env). */
  secretEnv?: Readonly<Record<string, string>>;
  vault?: { address: string; token: string; namespace?: string; http: SafeFetch };
  awsSecretsManager?: SecretsManagerClient;
  clock?: () => number;
}

export const EXTERNAL_CACHE_MS = 5 * 60_000;

/**
 * Resolves references to secret values, caching each for five minutes. A resolved value is a
 * single secret string; the credential's type decides which field it fills (the first secret
 * field of its schema).
 */
export class ExternalResolver {
  private readonly cache = new Map<string, { at: number; value: string }>();
  private readonly now: () => number;

  constructor(private readonly options: ExternalResolverOptions) {
    this.now = options.clock ?? (() => Date.now());
  }

  async resolve(text: string): Promise<string> {
    const cached = this.cache.get(text);
    if (cached && this.now() - cached.at < EXTERNAL_CACHE_MS) return cached.value;
    const ref = assertExternalRef(text);
    const value = await this.fetch(ref);
    this.cache.set(text, { at: this.now(), value });
    return value;
  }

  private async fetch(ref: ExternalRef): Promise<string> {
    switch (ref.scheme) {
      case "env": {
        const value = this.options.secretEnv?.[ref.name];
        if (value === undefined || value === "")
          throw new CredentialError(`${ref.name} is not set in the worker's environment`);
        return value;
      }
      case "vault": {
        const vault = this.options.vault;
        if (!vault) throw new CredentialError("Vault is not configured for external credentials");
        const [mount, ...rest] = ref.path.split("/");
        const headers: Record<string, string> = { "x-vault-token": vault.token };
        if (vault.namespace) headers["x-vault-namespace"] = vault.namespace;
        const response = await vault.http(
          `${vault.address.replace(/\/+$/, "")}/v1/${mount ?? ""}/data/${rest.join("/")}`,
          { headers },
        );
        if (!response.ok)
          throw new CredentialError(`Vault read of ${ref.path} failed (${response.status})`);
        const json = (await response.json()) as { data?: { data?: Record<string, unknown> } };
        const value = json.data?.data?.[ref.key];
        if (typeof value !== "string")
          throw new CredentialError(`Vault secret ${ref.path} has no string key '${ref.key}'`);
        return value;
      }
      case "aws-sm": {
        const client = this.options.awsSecretsManager;
        if (!client)
          throw new CredentialError(
            "AWS Secrets Manager is not configured for external credentials",
          );
        const text = await client.getSecretString(ref.arn);
        if (!ref.jsonKey) return text;
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new CredentialError(
            `Secret ${ref.arn} is not JSON, so it has no key '${ref.jsonKey}'`,
          );
        }
        const value = (parsed as Record<string, unknown>)[ref.jsonKey];
        if (typeof value !== "string")
          throw new CredentialError(`Secret ${ref.arn} has no string key '${ref.jsonKey}'`);
        return value;
      }
      case "azure-kv":
      case "gcp-sm":
        throw new CredentialError(
          `${ref.scheme} references are not supported yet (planned: P6-07)`,
        );
    }
  }

  clear(): void {
    this.cache.clear();
  }
}
