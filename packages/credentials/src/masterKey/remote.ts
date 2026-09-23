/**
 * Remote master keys: the master never leaves AWS KMS or Vault Transit. KEKs are wrapped by the
 * service; the KCV cannot be an HMAC of a key we never see, so it fingerprints the key's
 * identity (`first 8 bytes of SHA-256('aws-kms:' + keyArn)`, resp. of the Vault address, mount
 * and key name). A boot pointed at a different key therefore still fails the KCV check.
 */
import { createHash } from "node:crypto";
import { CredentialError, type SafeFetch } from "@flowaid/workflow-core";
import type { MasterKeyProvider } from "./types.js";

function identityKcv(identity: string): string {
  return createHash("sha256").update(identity).digest().subarray(0, 8).toString("base64");
}

/** The two KMS calls the provider needs; the worker adapts the AWS SDK client to it. */
export interface KmsClient {
  encrypt(keyId: string, plaintext: Uint8Array): Promise<Uint8Array>;
  decrypt(keyId: string, ciphertext: Uint8Array): Promise<Uint8Array>;
}

export function awsKmsMasterKey(options: { keyArn: string; client: KmsClient }): MasterKeyProvider {
  if (!/^arn:aws[a-z-]*:kms:[a-z0-9-]+:\d{12}:(key|alias)\/.+$/.test(options.keyArn)) {
    throw new CredentialError(`'${options.keyArn}' is not a KMS key or alias ARN`);
  }
  return {
    id: "aws-kms",
    async wrap(kek) {
      return Buffer.from(await options.client.encrypt(options.keyArn, kek)).toString("base64");
    },
    async unwrap(wrapped) {
      return Buffer.from(
        await options.client.decrypt(options.keyArn, Buffer.from(wrapped, "base64")),
      );
    },
    kcv: () => Promise.resolve(identityKcv(`aws-kms:${options.keyArn}`)),
  };
}

export interface VaultTransitOptions {
  /** e.g. https://vault.internal:8200 */
  address: string;
  token: string;
  key: string;
  mount?: string;
  namespace?: string;
  http: SafeFetch;
}

export function vaultTransitMasterKey(options: VaultTransitOptions): MasterKeyProvider {
  const mount = options.mount ?? "transit";
  const base = `${options.address.replace(/\/+$/, "")}/v1/${mount}`;
  const call = async (
    op: "encrypt" | "decrypt",
    body: Record<string, string>,
  ): Promise<Record<string, unknown>> => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-vault-token": options.token,
    };
    if (options.namespace) headers["x-vault-namespace"] = options.namespace;
    const response = await options.http(`${base}/${op}/${encodeURIComponent(options.key)}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new CredentialError(`Vault transit ${op} failed (${response.status})`);
    const json = (await response.json()) as { data?: Record<string, unknown> };
    return json.data ?? {};
  };
  return {
    id: "vault-transit",
    async wrap(kek) {
      const data = await call("encrypt", { plaintext: Buffer.from(kek).toString("base64") });
      if (typeof data.ciphertext !== "string")
        throw new CredentialError("Vault transit returned no ciphertext");
      return data.ciphertext;
    },
    async unwrap(wrapped) {
      const data = await call("decrypt", { ciphertext: wrapped });
      if (typeof data.plaintext !== "string")
        throw new CredentialError("Vault transit returned no plaintext");
      return Buffer.from(data.plaintext, "base64");
    },
    kcv: () => Promise.resolve(identityKcv(`vault-transit:${base}/${options.key}`)),
  };
}
