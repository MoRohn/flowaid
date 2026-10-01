import { describe, expect, it } from "vitest";
import { EnvSchema } from "./schema.js";

const MINIMAL = { DATABASE_URL: "postgres://flowaid:flowaid@localhost:5432/flowaid" };

const issues = (vars: Record<string, string>) => {
  const r = EnvSchema.safeParse({ ...MINIMAL, ...vars });
  return r.success ? [] : r.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`);
};

describe("master key providers", () => {
  it("needs a well-formed key id for a key service, and none for the local key", () => {
    expect(issues({ FLOWAID_MASTER_KEY_PROVIDER: "gcp-kms" })).toEqual([
      "FLOWAID_MASTER_KEY_ID: is required with FLOWAID_MASTER_KEY_PROVIDER=gcp-kms",
    ]);
    expect(
      issues({ FLOWAID_MASTER_KEY_PROVIDER: "gcp-kms", FLOWAID_MASTER_KEY_ID: "projects/x" }),
    ).toEqual([
      "FLOWAID_MASTER_KEY_ID: must be projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>",
    ]);
    expect(
      issues({
        FLOWAID_MASTER_KEY_PROVIDER: "gcp-kms",
        FLOWAID_MASTER_KEY_ID: "projects/acme-prod/locations/global/keyRings/r/cryptoKeys/k",
      }),
    ).toEqual([]);
    expect(issues({ FLOWAID_MASTER_KEY_ID: "k" })).toEqual([
      "FLOWAID_MASTER_KEY_ID: has no effect with FLOWAID_MASTER_KEY_PROVIDER=local",
    ]);
  });

  it("needs Vault's address and token together, and a complete service principal", () => {
    expect(
      issues({ FLOWAID_MASTER_KEY_PROVIDER: "vault-transit", FLOWAID_MASTER_KEY_ID: "flowaid" }),
    ).toEqual(["VAULT_ADDR: is required with FLOWAID_MASTER_KEY_PROVIDER=vault-transit"]);
    expect(issues({ VAULT_ADDR: "https://vault:8200" })).toEqual([
      "VAULT_TOKEN: VAULT_ADDR and VAULT_TOKEN must be set together",
    ]);
    expect(issues({ AZURE_CLIENT_SECRET: "s", AZURE_CLIENT_ID: "c" })).toEqual([
      "AZURE_TENANT_ID: is required with AZURE_CLIENT_SECRET",
    ]);
  });

  it("takes an AWS KMS key or alias ARN, and AWS keys as a pair", () => {
    expect(
      issues({ FLOWAID_MASTER_KEY_PROVIDER: "aws-kms", FLOWAID_MASTER_KEY_ID: "alias/flowaid" }),
    ).toEqual([
      "FLOWAID_MASTER_KEY_ID: must be a KMS key or alias ARN (arn:aws:kms:<region>:<account>:key/<id>)",
    ]);
    for (const arn of [
      "arn:aws:kms:eu-west-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab",
      "arn:aws-us-gov:kms:us-gov-west-1:123456789012:alias/flowaid/master",
    ])
      expect(
        issues({ FLOWAID_MASTER_KEY_PROVIDER: "aws-kms", FLOWAID_MASTER_KEY_ID: arn }),
      ).toEqual([]);
    expect(issues({ AWS_ACCESS_KEY_ID: "AKIA" })).toEqual([
      "AWS_SECRET_ACCESS_KEY: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set together",
    ]);
    expect(issues({ AWS_SESSION_TOKEN: "t" })).toEqual([
      "AWS_SESSION_TOKEN: requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY",
    ]);
    expect(issues({ AWS_ENDPOINT_URL: "localstack:4566" })).toHaveLength(1);
    expect(
      issues({ AWS_ACCESS_KEY_ID: "AKIA", AWS_SECRET_ACCESS_KEY: "s", AWS_SESSION_TOKEN: "t" }),
    ).toEqual([]);
  });

  it("does not ask production for a local master key when a key service holds it", () => {
    const prod = {
      NODE_ENV: "production",
      FLOWAID_JWT_KEYS_DIR: "/var/lib/flowaid/jwt",
      FLOWAID_BASE_URL: "https://flowaid.example.com",
      FLOWAID_WEB_URL: "https://flowaid.example.com",
    };
    expect(issues(prod).some((i) => i.startsWith("FLOWAID_MASTER_KEY:"))).toBe(true);
    expect(
      issues({
        ...prod,
        FLOWAID_MASTER_KEY_PROVIDER: "azure-keyvault",
        FLOWAID_MASTER_KEY_ID: "https://acme-vault.vault.azure.net/keys/master",
      }).some((i) => i.startsWith("FLOWAID_MASTER_KEY")),
    ).toBe(false);
  });
});
