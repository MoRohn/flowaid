/**
 * The key services the environment configures (ARCHITECTURE.md §10.6): which master key provider
 * wraps the KEKs, and which secret managers external credential references can read. The api and
 * the worker build both from the same `Env`, so they always agree.
 */
import type { Env } from "@flowaid/env";
import { CredentialError } from "@flowaid/workflow-core";
import { awsCredentialChain, awsKmsClient, awsSecretsManagerClient } from "./aws/client.js";
import type { ExternalResolverOptions } from "./externalRef.js";
import {
  AZURE_VAULT_RESOURCE,
  azureClientCredentialsToken,
  azureKeyVaultMasterKey,
  azureManagedIdentityToken,
  gcpKmsMasterKey,
  gcpMetadataToken,
  gcpServiceAccountToken,
  type GcpServiceAccountKey,
  type HttpFetch,
  type TokenSource,
} from "./masterKey/cloud.js";
import { awsKmsMasterKey, vaultTransitMasterKey } from "./masterKey/remote.js";
import type { MasterKeyProvider } from "./masterKey/types.js";

export interface KeyServiceDeps {
  /** Plain fetch: key services are platform configuration, not user input. */
  http: HttpFetch;
  /** Reads `GOOGLE_APPLICATION_CREDENTIALS`. */
  readFile: (path: string) => string;
}

type KeyEnv = Pick<
  Env,
  | "FLOWAID_MASTER_KEY_PROVIDER"
  | "FLOWAID_MASTER_KEY_ID"
  | "VAULT_ADDR"
  | "VAULT_TOKEN"
  | "VAULT_NAMESPACE"
  | "VAULT_TRANSIT_MOUNT"
  | "AZURE_TENANT_ID"
  | "AZURE_CLIENT_ID"
  | "AZURE_CLIENT_SECRET"
  | "GOOGLE_APPLICATION_CREDENTIALS"
  | "AWS_ACCESS_KEY_ID"
  | "AWS_SECRET_ACCESS_KEY"
  | "AWS_SESSION_TOKEN"
  | "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI"
  | "AWS_ENDPOINT_URL"
> & { secretRefs?: Env["secretRefs"] };

/** Azure: the service principal when configured, else the host's managed identity. */
export function azureToken(env: KeyEnv, deps: KeyServiceDeps): TokenSource {
  if (env.AZURE_TENANT_ID && env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET)
    return azureClientCredentialsToken({
      http: deps.http,
      tenantId: env.AZURE_TENANT_ID,
      clientId: env.AZURE_CLIENT_ID,
      clientSecret: env.AZURE_CLIENT_SECRET,
      scope: `${AZURE_VAULT_RESOURCE}/.default`,
    });
  return azureManagedIdentityToken({
    http: deps.http,
    ...(env.AZURE_CLIENT_ID ? { clientId: env.AZURE_CLIENT_ID } : {}),
  });
}

/** GCP: the service-account key file when configured, else the metadata server. */
export function gcpToken(env: KeyEnv, deps: KeyServiceDeps): TokenSource {
  const path = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) return gcpMetadataToken({ http: deps.http });
  let key: GcpServiceAccountKey;
  try {
    key = JSON.parse(deps.readFile(path)) as GcpServiceAccountKey;
  } catch {
    throw new CredentialError(
      `GOOGLE_APPLICATION_CREDENTIALS (${path}) is not a readable JSON key`,
    );
  }
  return gcpServiceAccountToken({ http: deps.http, key });
}

/** AWS: static keys, else the ECS task role, else the EC2 instance profile; `AWS_ENDPOINT_URL`
 * points both services at another endpoint (LocalStack). */
function awsServiceOptions(env: KeyEnv, deps: KeyServiceDeps) {
  return {
    http: deps.http,
    credentials: awsCredentialChain(env, deps.http),
    ...(env.AWS_ENDPOINT_URL ? { endpoint: env.AWS_ENDPOINT_URL } : {}),
  };
}

/**
 * The master key provider `FLOWAID_MASTER_KEY_PROVIDER` names; `local` is the caller's (env or
 * key file, whose creation rules differ between the api and the worker).
 */
export async function masterKeyProviderFromEnv(
  env: KeyEnv,
  deps: KeyServiceDeps,
  local: () => Promise<MasterKeyProvider>,
): Promise<MasterKeyProvider> {
  const keyId = env.FLOWAID_MASTER_KEY_ID ?? "";
  switch (env.FLOWAID_MASTER_KEY_PROVIDER) {
    case "local":
      return local();
    case "vault-transit":
      if (!env.VAULT_ADDR || !env.VAULT_TOKEN)
        throw new CredentialError("the vault-transit master key needs VAULT_ADDR and VAULT_TOKEN");
      return vaultTransitMasterKey({
        address: env.VAULT_ADDR,
        token: env.VAULT_TOKEN,
        key: keyId,
        mount: env.VAULT_TRANSIT_MOUNT,
        ...(env.VAULT_NAMESPACE ? { namespace: env.VAULT_NAMESPACE } : {}),
        http: deps.http as never,
      });
    case "aws-kms":
      return awsKmsMasterKey({ keyArn: keyId, client: awsKmsClient(awsServiceOptions(env, deps)) });
    case "azure-keyvault":
      return azureKeyVaultMasterKey({ keyId, token: azureToken(env, deps), http: deps.http });
    case "gcp-kms":
      return gcpKmsMasterKey({ keyName: keyId, token: gcpToken(env, deps), http: deps.http });
  }
}

/**
 * What external references can read: `FLOWAID_SECRET_*` values, Vault when `VAULT_ADDR` is set,
 * and AWS Secrets Manager, Azure Key Vault and Secret Manager through the platform identity
 * (resolved lazily: a reference that is never used never asks for credentials or a token).
 */
export function externalResolverOptionsFromEnv(
  env: KeyEnv,
  deps: KeyServiceDeps,
): ExternalResolverOptions {
  let azure: TokenSource | undefined;
  let gcp: TokenSource | undefined;
  let aws: ReturnType<typeof awsSecretsManagerClient> | undefined;
  return {
    secretEnv: env.secretRefs ?? {},
    ...(env.VAULT_ADDR && env.VAULT_TOKEN
      ? {
          vault: {
            address: env.VAULT_ADDR,
            token: env.VAULT_TOKEN,
            ...(env.VAULT_NAMESPACE ? { namespace: env.VAULT_NAMESPACE } : {}),
            http: deps.http as never,
          },
        }
      : {}),
    awsSecretsManager: {
      getSecretString: (arn) =>
        (aws ??= awsSecretsManagerClient(awsServiceOptions(env, deps))).getSecretString(arn),
    },
    azureKeyVault: {
      http: deps.http,
      token: () => (azure ??= azureToken(env, deps))(),
    },
    gcpSecretManager: {
      http: deps.http,
      token: () => (gcp ??= gcpToken(env, deps))(),
    },
  };
}
