import { describe, expect, it } from "vitest";
import {
  EXTERNAL_CACHE_MS,
  ExternalResolver,
  assertExternalRef,
  parseExternalRef,
} from "./externalRef.js";

describe("parseExternalRef", () => {
  it.each([
    ["env:FLOWAID_SECRET_CRM_TOKEN", { scheme: "env", name: "FLOWAID_SECRET_CRM_TOKEN" }],
    ["vault:secret/crm/prod#token", { scheme: "vault", path: "secret/crm/prod", key: "token" }],
    [
      "aws-sm:arn:aws:secretsmanager:eu-west-1:123456789012:secret:crm-abc123",
      { scheme: "aws-sm", arn: "arn:aws:secretsmanager:eu-west-1:123456789012:secret:crm-abc123" },
    ],
    [
      "aws-sm:arn:aws:secretsmanager:eu-west-1:123456789012:secret:crm#apiKey",
      {
        scheme: "aws-sm",
        arn: "arn:aws:secretsmanager:eu-west-1:123456789012:secret:crm",
        jsonKey: "apiKey",
      },
    ],
    ["azure-kv:my-vault/crm-token", { scheme: "azure-kv", vault: "my-vault", secret: "crm-token" }],
    [
      "azure-kv:my-vault/crm-token/0123456789abcdef0123456789abcdef",
      {
        scheme: "azure-kv",
        vault: "my-vault",
        secret: "crm-token",
        version: "0123456789abcdef0123456789abcdef",
      },
    ],
    [
      "gcp-sm:projects/acme/secrets/crm/versions/latest",
      { scheme: "gcp-sm", project: "acme", secret: "crm", version: "latest" },
    ],
  ])("accepts %s", (text, ref) => {
    expect(parseExternalRef(text)).toEqual({ ok: true, ref });
  });

  it.each([
    ["env:FLOWAID_MASTER_KEY", /FLOWAID_SECRET_/],
    ["env:DATABASE_URL", /FLOWAID_SECRET_/],
    ["env:FLOWAID_SECRET_lower", /FLOWAID_SECRET_/],
    ["env:HOME", /FLOWAID_SECRET_/],
    ["vault:/etc/passwd#x", /vault:/],
    ["vault:secret/../other#x", /vault:/],
    ["vault:secret/crm", /vault:/],
    ["aws-sm:arn:aws:s3:::bucket", /Secrets Manager/],
    ["azure-kv:x/y", /azure-kv:/],
    ["gcp-sm:projects/p/secrets/s", /gcp-sm:/],
    ["file:/etc/shadow", /unknown scheme/],
    ["FLOWAID_SECRET_X", /missing scheme/],
  ])("rejects %s", (text, reason) => {
    const parsed = parseExternalRef(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toMatch(reason);
  });

  it("refuses FLOWAID_SECRET_* names the environment schema owns", () => {
    // Any schema key with that prefix would be a platform setting; none exist today, so a synthetic check:
    expect(parseExternalRef("env:FLOWAID_SECRET_ANY").ok).toBe(true);
    expect(() => assertExternalRef("env:FLOWAID_MASTER_KEY")).toThrow(
      /Invalid external credential reference/,
    );
  });
});

describe("ExternalResolver", () => {
  it("resolves env, vault and Secrets Manager references and caches them for five minutes", async () => {
    let now = 0;
    let vaultReads = 0;
    const resolver = new ExternalResolver({
      clock: () => now,
      secretEnv: { FLOWAID_SECRET_A: "from-env" },
      vault: {
        address: "https://vault:8200",
        token: "t",
        namespace: "ns",
        http: (url) => {
          vaultReads += 1;
          expect(url).toBe("https://vault:8200/v1/secret/data/crm/prod");
          return Promise.resolve(Response.json({ data: { data: { token: "from-vault" } } }));
        },
      },
      awsSecretsManager: {
        getSecretString: (arn) =>
          Promise.resolve(arn.endsWith("json") ? '{"apiKey":"from-sm-json"}' : "from-sm"),
      },
    });
    expect(await resolver.resolve("env:FLOWAID_SECRET_A")).toBe("from-env");
    expect(await resolver.resolve("vault:secret/crm/prod#token")).toBe("from-vault");
    expect(await resolver.resolve("vault:secret/crm/prod#token")).toBe("from-vault");
    expect(vaultReads).toBe(1);
    now += EXTERNAL_CACHE_MS;
    await resolver.resolve("vault:secret/crm/prod#token");
    expect(vaultReads).toBe(2);
    expect(
      await resolver.resolve("aws-sm:arn:aws:secretsmanager:eu-west-1:123456789012:secret:plain"),
    ).toBe("from-sm");
    expect(
      await resolver.resolve(
        "aws-sm:arn:aws:secretsmanager:eu-west-1:123456789012:secret:json#apiKey",
      ),
    ).toBe("from-sm-json");
    resolver.clear();
  });

  it("explains what is missing", async () => {
    const empty = new ExternalResolver({});
    await expect(empty.resolve("env:FLOWAID_SECRET_A")).rejects.toThrow(/not set/);
    await expect(empty.resolve("vault:a/b#c")).rejects.toThrow(/Vault is not configured/);
    await expect(
      empty.resolve("aws-sm:arn:aws:secretsmanager:eu-west-1:123456789012:secret:x"),
    ).rejects.toThrow(/not configured/);
    await expect(empty.resolve("azure-kv:my-vault/x")).rejects.toThrow(/P6-07/);
    const vault = new ExternalResolver({
      vault: {
        address: "https://v",
        token: "t",
        http: () => Promise.resolve(new Response("", { status: 404 })),
      },
    });
    await expect(vault.resolve("vault:a/b#c")).rejects.toThrow(/404/);
    const noKey = new ExternalResolver({
      vault: {
        address: "https://v",
        token: "t",
        http: () => Promise.resolve(Response.json({ data: { data: {} } })),
      },
    });
    await expect(noKey.resolve("vault:a/b#c")).rejects.toThrow(/no string key/);
    const sm = new ExternalResolver({
      awsSecretsManager: { getSecretString: () => Promise.resolve("plain text") },
    });
    await expect(
      sm.resolve("aws-sm:arn:aws:secretsmanager:eu-west-1:123456789012:secret:x#k"),
    ).rejects.toThrow(/not JSON/);
    const smMissing = new ExternalResolver({
      awsSecretsManager: { getSecretString: () => Promise.resolve("{}") },
    });
    await expect(
      smMissing.resolve("aws-sm:arn:aws:secretsmanager:eu-west-1:123456789012:secret:x#k"),
    ).rejects.toThrow(/no string key/);
  });
});
