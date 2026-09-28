/**
 * Cloud master keys and the tokens they need (P6-07): Azure Key Vault wraps KEKs with an RSA key
 * (`wrapkey` / `unwrapkey`, RSA-OAEP-256) and GCP Cloud KMS with a symmetric crypto key
 * (`:encrypt` / `:decrypt`). Both are called over their REST APIs through an injected fetch, so no
 * cloud SDK is a dependency. As with AWS KMS and Vault Transit, the master never leaves the
 * service and the KCV fingerprints the key's identity (not its version, so rotating the key's
 * versions keeps the KCV).
 *
 * Tokens come from the platform identity when running in the cloud (Azure managed identity, the
 * GCE/GKE metadata server) or from an explicit service principal / service-account key.
 */
import { createSign } from "node:crypto";
import { CredentialError } from "@flowaid/workflow-core";
import { identityKcv } from "./remote.js";
import type { MasterKeyProvider } from "./types.js";

/** The fetch these calls need; the global `fetch` fits. Not SSRF-guarded: the URLs are platform
 * configuration (and metadata endpoints are link-local by design). */
export type HttpFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Returns a bearer token for the service, refreshed as it nears expiry. */
export type TokenSource = () => Promise<string>;

interface IssuedToken {
  token: string;
  /** seconds */
  expiresIn: number;
}

/** Caches a token until a minute before it expires; concurrent callers share one request. */
export function cachedToken(
  issue: () => Promise<IssuedToken>,
  now: () => number = Date.now,
): TokenSource {
  let current: { token: string; until: number } | null = null;
  let pending: Promise<string> | null = null;
  return () => {
    if (current && now() < current.until) return Promise.resolve(current.token);
    pending ??= issue()
      .then((t) => {
        current = { token: t.token, until: now() + Math.max(0, t.expiresIn - 60) * 1000 };
        return t.token;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}

async function tokenJson(
  what: string,
  response: Awaited<ReturnType<HttpFetch>>,
): Promise<IssuedToken> {
  if (!response.ok) throw new CredentialError(`${what} token request failed (${response.status})`);
  const json = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof json.access_token !== "string")
    throw new CredentialError(`${what} returned no access token`);
  return { token: json.access_token, expiresIn: Number(json.expires_in ?? 300) || 300 };
}

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();

export const AZURE_VAULT_RESOURCE = "https://vault.azure.net";
export const GCP_CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/** Azure managed identity (IMDS); `clientId` picks a user-assigned identity. */
export function azureManagedIdentityToken(options: {
  http: HttpFetch;
  resource?: string;
  clientId?: string;
  now?: () => number;
}): TokenSource {
  const params = new URLSearchParams({
    "api-version": "2018-02-01",
    resource: options.resource ?? AZURE_VAULT_RESOURCE,
  });
  if (options.clientId) params.set("client_id", options.clientId);
  return cachedToken(
    async () =>
      tokenJson(
        "Azure managed identity",
        await options.http(
          `http://169.254.169.254/metadata/identity/oauth2/token?${params.toString()}`,
          {
            headers: { metadata: "true" },
          },
        ),
      ),
    options.now,
  );
}

/** Azure service principal (client credentials). */
export function azureClientCredentialsToken(options: {
  http: HttpFetch;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  now?: () => number;
}): TokenSource {
  return cachedToken(
    async () =>
      tokenJson(
        "Azure AD",
        await options.http(
          `https://login.microsoftonline.com/${encodeURIComponent(options.tenantId)}/oauth2/v2.0/token`,
          {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: form({
              grant_type: "client_credentials",
              client_id: options.clientId,
              client_secret: options.clientSecret,
              scope: options.scope ?? `${AZURE_VAULT_RESOURCE}/.default`,
            }),
          },
        ),
      ),
    options.now,
  );
}

/** The GCE/GKE/Cloud Run metadata server's default service account. */
export function gcpMetadataToken(options: { http: HttpFetch; now?: () => number }): TokenSource {
  return cachedToken(
    async () =>
      tokenJson(
        "GCP metadata server",
        await options.http(
          "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
          { headers: { "metadata-flavor": "Google" } },
        ),
      ),
    options.now,
  );
}

/** A service-account key file's contents (`GOOGLE_APPLICATION_CREDENTIALS`). */
export interface GcpServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** OAuth 2.0 JWT bearer grant signed with a service-account key (RS256). */
export function gcpServiceAccountToken(options: {
  http: HttpFetch;
  key: GcpServiceAccountKey;
  scope?: string;
  now?: () => number;
}): TokenSource {
  const now = options.now ?? Date.now;
  const tokenUri = options.key.token_uri ?? "https://oauth2.googleapis.com/token";
  if (!options.key.client_email || !options.key.private_key)
    throw new CredentialError("the GCP service-account key has no client_email or private_key");
  return cachedToken(async () => {
    const iat = Math.floor(now() / 1000);
    const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
      JSON.stringify({
        iss: options.key.client_email,
        scope: options.scope ?? GCP_CLOUD_PLATFORM_SCOPE,
        aud: tokenUri,
        iat,
        exp: iat + 3600,
      }),
    )}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(options.key.private_key);
    return tokenJson(
      "GCP OAuth",
      await options.http(tokenUri, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: `${unsigned}.${b64url(signature)}`,
        }),
      }),
    );
  }, now);
}

async function callJson(
  what: string,
  http: HttpFetch,
  token: TokenSource,
  url: string,
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await http(url, {
    method: "POST",
    headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new CredentialError(`${what} failed (${response.status})`);
  return (await response.json()) as Record<string, unknown>;
}

const AZURE_KEY =
  /^(https:\/\/[a-z0-9-]{3,24}\.(?:vault|managedhsm)\.(?:azure\.net|azure\.cn|usgovcloudapi\.net)\/keys\/[A-Za-z0-9-]{1,127})(?:\/([0-9a-f]{32}))?$/;
const AZURE_API = "api-version=7.4";

/**
 * Azure Key Vault (or Managed HSM) RSA key. `keyId` is the key's URL, optionally with a version;
 * without one the vault wraps with the current version. The wrapped form is
 * `<kid>#<base64url>`, so a KEK wrapped before a key rotation still unwraps with its version.
 */
export function azureKeyVaultMasterKey(options: {
  keyId: string;
  token: TokenSource;
  http: HttpFetch;
}): MasterKeyProvider {
  const m = AZURE_KEY.exec(options.keyId);
  if (!m?.[1])
    throw new CredentialError(
      `'${options.keyId}' is not a Key Vault key URL (https://<vault>.vault.azure.net/keys/<name>[/<version>])`,
    );
  const base = m[1];
  return {
    id: "azure-keyvault",
    async wrap(kek) {
      const out = await callJson(
        "Azure Key Vault wrapkey",
        options.http,
        options.token,
        `${options.keyId}/wrapkey?${AZURE_API}`,
        { alg: "RSA-OAEP-256", value: b64url(Buffer.from(kek)) },
      );
      if (typeof out.kid !== "string" || typeof out.value !== "string")
        throw new CredentialError("Azure Key Vault returned no wrapped key");
      return `${out.kid}#${out.value}`;
    },
    async unwrap(wrapped) {
      const at = wrapped.lastIndexOf("#");
      const kid = wrapped.slice(0, at);
      // only this key's versions: a tampered row cannot point the call at another URL
      if (at < 0 || !kid.startsWith(`${base}/`))
        throw new CredentialError("the wrapped key was not made by this Key Vault key");
      const out = await callJson(
        "Azure Key Vault unwrapkey",
        options.http,
        options.token,
        `${kid}/unwrapkey?${AZURE_API}`,
        { alg: "RSA-OAEP-256", value: wrapped.slice(at + 1) },
      );
      if (typeof out.value !== "string")
        throw new CredentialError("Azure Key Vault returned no key");
      return Buffer.from(out.value, "base64url");
    },
    kcv: () => Promise.resolve(identityKcv(`azure-keyvault:${base}`)),
  };
}

const GCP_KEY =
  /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/[a-z0-9-]+\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}$/;

/** GCP Cloud KMS symmetric key; the ciphertext names the key version that made it. */
export function gcpKmsMasterKey(options: {
  keyName: string;
  token: TokenSource;
  http: HttpFetch;
  endpoint?: string;
}): MasterKeyProvider {
  if (!GCP_KEY.test(options.keyName))
    throw new CredentialError(
      `'${options.keyName}' is not a Cloud KMS key (projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>)`,
    );
  const url = `${(options.endpoint ?? "https://cloudkms.googleapis.com").replace(/\/+$/, "")}/v1/${options.keyName}`;
  return {
    id: "gcp-kms",
    async wrap(kek) {
      const out = await callJson(
        "Cloud KMS encrypt",
        options.http,
        options.token,
        `${url}:encrypt`,
        {
          plaintext: Buffer.from(kek).toString("base64"),
        },
      );
      if (typeof out.ciphertext !== "string")
        throw new CredentialError("Cloud KMS returned no ciphertext");
      return out.ciphertext;
    },
    async unwrap(wrapped) {
      const out = await callJson(
        "Cloud KMS decrypt",
        options.http,
        options.token,
        `${url}:decrypt`,
        {
          ciphertext: wrapped,
        },
      );
      if (typeof out.plaintext !== "string")
        throw new CredentialError("Cloud KMS returned no plaintext");
      return Buffer.from(out.plaintext, "base64");
    },
    kcv: () => Promise.resolve(identityKcv(`gcp-kms:${options.keyName}`)),
  };
}
