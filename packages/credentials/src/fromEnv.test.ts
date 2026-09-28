import { describe, expect, it } from "vitest";
import { envMasterKey } from "./masterKey/local.js";
import { ExternalResolver } from "./externalRef.js";
import { externalResolverOptionsFromEnv, masterKeyProviderFromEnv } from "./fromEnv.js";
import type { HttpFetch } from "./masterKey/cloud.js";

const BASE = {
  FLOWAID_MASTER_KEY_PROVIDER: "local",
  FLOWAID_MASTER_KEY_ID: undefined,
  VAULT_ADDR: undefined,
  VAULT_TOKEN: undefined,
  VAULT_NAMESPACE: undefined,
  VAULT_TRANSIT_MOUNT: "transit",
  AZURE_TENANT_ID: undefined,
  AZURE_CLIENT_ID: undefined,
  AZURE_CLIENT_SECRET: undefined,
  GOOGLE_APPLICATION_CREDENTIALS: undefined,
} as const;
type TestEnv = Parameters<typeof masterKeyProviderFromEnv>[0];
const env = (over: Record<string, unknown>) => ({ ...BASE, ...over }) as unknown as TestEnv;

const calls: string[] = [];
const http: HttpFetch = (url) => {
  calls.push(url);
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve(
        url.includes("oauth2") || url.includes("metadata")
          ? { access_token: "tok", expires_in: 3600 }
          : { value: "from-key-vault" },
      ),
  });
};
const deps = { http, readFile: () => "{}" };
const local = () => Promise.resolve(envMasterKey(Buffer.alloc(32, 7).toString("base64")));

describe("masterKeyProviderFromEnv", () => {
  it("picks the provider the environment names", async () => {
    expect((await masterKeyProviderFromEnv(env({}), deps, local)).id).toBe("env");
    expect(
      (
        await masterKeyProviderFromEnv(
          env({
            FLOWAID_MASTER_KEY_PROVIDER: "azure-keyvault",
            FLOWAID_MASTER_KEY_ID: "https://acme-vault.vault.azure.net/keys/master",
          }),
          deps,
          local,
        )
      ).id,
    ).toBe("azure-keyvault");
    expect(
      (
        await masterKeyProviderFromEnv(
          env({
            FLOWAID_MASTER_KEY_PROVIDER: "gcp-kms",
            FLOWAID_MASTER_KEY_ID: "projects/acme-prod/locations/global/keyRings/r/cryptoKeys/k",
          }),
          deps,
          local,
        )
      ).id,
    ).toBe("gcp-kms");
    expect(
      (
        await masterKeyProviderFromEnv(
          env({
            FLOWAID_MASTER_KEY_PROVIDER: "vault-transit",
            FLOWAID_MASTER_KEY_ID: "flowaid",
            VAULT_ADDR: "https://vault:8200",
            VAULT_TOKEN: "t",
          }),
          deps,
          local,
        )
      ).id,
    ).toBe("vault-transit");
    await expect(
      masterKeyProviderFromEnv(
        env({ FLOWAID_MASTER_KEY_PROVIDER: "gcp-kms", GOOGLE_APPLICATION_CREDENTIALS: "/k.json" }),
        { http, readFile: () => "not json" },
        local,
      ),
    ).rejects.toThrow(/not a readable JSON key/);
  });
});

describe("externalResolverOptionsFromEnv", () => {
  it("reads FLOWAID_SECRET_* values and asks the managed identity only when a reference is used", async () => {
    calls.length = 0;
    const options = externalResolverOptionsFromEnv(
      env({ secretRefs: { FLOWAID_SECRET_OPENAI: "sk-env" } }),
      deps,
    );
    expect(options.vault).toBeUndefined();
    expect(calls).toEqual([]);
    const resolver = new ExternalResolver(options);
    expect(await resolver.resolve("env:FLOWAID_SECRET_OPENAI")).toBe("sk-env");
    expect(await resolver.resolve("azure-kv:acme-vault/openai")).toBe("from-key-vault");
    expect(calls[0]).toMatch(/^http:\/\/169\.254\.169\.254\/metadata\/identity/);
    expect(
      externalResolverOptionsFromEnv(
        env({ VAULT_ADDR: "https://vault:8200", VAULT_TOKEN: "t" }),
        deps,
      ).vault,
    ).toMatchObject({ address: "https://vault:8200" });
  });
});
