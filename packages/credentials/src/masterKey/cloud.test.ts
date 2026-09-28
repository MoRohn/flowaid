import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ExternalResolver } from "../externalRef.js";
import {
  azureClientCredentialsToken,
  azureKeyVaultMasterKey,
  azureManagedIdentityToken,
  cachedToken,
  gcpKmsMasterKey,
  gcpMetadataToken,
  gcpServiceAccountToken,
  type HttpFetch,
} from "./cloud.js";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** A fake HTTP service: `route` answers each call; every call is recorded. */
function fake(route: (c: Call) => { status?: number; json: unknown }) {
  const calls: Call[] = [];
  const http: HttpFetch = (url, init) => {
    const call = {
      url,
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body: init?.body,
    };
    calls.push(call);
    const out = route(call);
    const status = out.status ?? 200;
    return Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(out.json),
    });
  };
  return { http, calls };
}

const token = () => Promise.resolve("tok");
const KEY = "https://acme-vault.vault.azure.net/keys/flowaid";
const V1 = "0123456789abcdef0123456789abcdef";
const V2 = "fedcba9876543210fedcba9876543210";

/** "Wraps" by reversing the bytes, remembering which key version did it. */
function fakeKeyVault(current: string) {
  return fake((c) => {
    const body = JSON.parse(c.body ?? "{}") as { value: string; alg: string };
    expect(c.headers.authorization).toBe("Bearer tok");
    expect(body.alg).toBe("RSA-OAEP-256");
    const bytes = Buffer.from(body.value, "base64url");
    if (c.url.includes("/wrapkey"))
      return {
        json: {
          kid: `${KEY}/${current}`,
          value: Buffer.from(bytes.reverse()).toString("base64url"),
        },
      };
    return { json: { value: Buffer.from(bytes.reverse()).toString("base64url") } };
  });
}

describe("azureKeyVaultMasterKey", () => {
  it("wraps and unwraps through wrapkey/unwrapkey, with the version that wrapped", async () => {
    const vault = fakeKeyVault(V1);
    const master = azureKeyVaultMasterKey({ keyId: KEY, token, http: vault.http });
    const kek = new Uint8Array([1, 2, 3, 4]);
    const wrapped = await master.wrap(kek);
    expect(wrapped.startsWith(`${KEY}/${V1}#`)).toBe(true);
    expect(vault.calls[0]?.url).toBe(`${KEY}/wrapkey?api-version=7.4`);
    expect([...(await master.unwrap(wrapped))]).toEqual([1, 2, 3, 4]);
    expect(vault.calls[1]?.url).toBe(`${KEY}/${V1}/unwrapkey?api-version=7.4`);
  });

  it("keeps its KCV across key versions and refuses another key's wrapped value", async () => {
    const a = azureKeyVaultMasterKey({ keyId: `${KEY}/${V1}`, token, http: fakeKeyVault(V1).http });
    const b = azureKeyVaultMasterKey({ keyId: `${KEY}/${V2}`, token, http: fakeKeyVault(V2).http });
    expect(await a.kcv()).toBe(await b.kcv());
    const other = azureKeyVaultMasterKey({
      keyId: "https://acme-vault.vault.azure.net/keys/other",
      token,
      http: fakeKeyVault(V1).http,
    });
    expect(await other.kcv()).not.toBe(await a.kcv());
    await expect(a.unwrap(`https://evil.example/keys/x/${V1}#AAAA`)).rejects.toThrow(
      /not made by this Key Vault key/,
    );
    expect(() =>
      azureKeyVaultMasterKey({
        keyId: "https://example.com/keys/x",
        token,
        http: fake(() => ({ json: {} })).http,
      }),
    ).toThrow(/not a Key Vault key URL/);
  });

  it("reports a failed call with its status", async () => {
    const down = fake(() => ({ status: 403, json: {} }));
    const master = azureKeyVaultMasterKey({ keyId: KEY, token, http: down.http });
    await expect(master.wrap(new Uint8Array([1]))).rejects.toThrow(/wrapkey failed \(403\)/);
  });
});

const GCP_KEY = "projects/acme-prod/locations/global/keyRings/flowaid/cryptoKeys/master";

describe("gcpKmsMasterKey", () => {
  it("encrypts and decrypts through Cloud KMS", async () => {
    const kms = fake((c) => {
      const body = JSON.parse(c.body ?? "{}") as { plaintext?: string; ciphertext?: string };
      return c.url.endsWith(":encrypt")
        ? { json: { ciphertext: Buffer.from(`enc:${body.plaintext}`).toString("base64") } }
        : {
            json: {
              plaintext: Buffer.from(body.ciphertext ?? "", "base64")
                .toString()
                .slice(4),
            },
          };
    });
    const master = gcpKmsMasterKey({ keyName: GCP_KEY, token, http: kms.http });
    const wrapped = await master.wrap(new Uint8Array([9, 8, 7]));
    expect([...(await master.unwrap(wrapped))]).toEqual([9, 8, 7]);
    expect(kms.calls[0]?.url).toBe(`https://cloudkms.googleapis.com/v1/${GCP_KEY}:encrypt`);
    expect(kms.calls[0]?.headers.authorization).toBe("Bearer tok");
    expect(master.id).toBe("gcp-kms");
    expect(() => gcpKmsMasterKey({ keyName: "projects/x", token, http: kms.http })).toThrow(
      /not a Cloud KMS key/,
    );
  });
});

describe("token sources", () => {
  it("caches a token until a minute before it expires, sharing concurrent requests", async () => {
    let t = 0;
    let issued = 0;
    const source = cachedToken(
      () => {
        issued++;
        return Promise.resolve({ token: `t${issued}`, expiresIn: 3600 });
      },
      () => t,
    );
    expect(await Promise.all([source(), source()])).toEqual(["t1", "t1"]);
    t = 3539_000;
    expect(await source()).toBe("t1");
    t = 3541_000;
    expect(await source()).toBe("t2");
  });

  it("asks Azure IMDS and Azure AD the documented way", async () => {
    const imds = fake(() => ({ json: { access_token: "mi", expires_in: "3599" } }));
    expect(await azureManagedIdentityToken({ http: imds.http, clientId: "cid" })()).toBe("mi");
    expect(imds.calls[0]?.url).toMatch(
      /^http:\/\/169\.254\.169\.254\/metadata\/identity\/oauth2\/token\?api-version=2018-02-01&resource=https%3A%2F%2Fvault\.azure\.net&client_id=cid$/,
    );
    expect(imds.calls[0]?.headers.metadata).toBe("true");

    const aad = fake(() => ({ json: { access_token: "sp", expires_in: 3599 } }));
    const sp = azureClientCredentialsToken({
      http: aad.http,
      tenantId: "tenant",
      clientId: "app",
      clientSecret: "shh",
    });
    expect(await sp()).toBe("sp");
    expect(aad.calls[0]?.url).toBe("https://login.microsoftonline.com/tenant/oauth2/v2.0/token");
    expect(new URLSearchParams(aad.calls[0]?.body).get("scope")).toBe(
      "https://vault.azure.net/.default",
    );
  });

  it("signs a service-account JWT the token endpoint can verify, or uses the metadata server", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const endpoint = fake((c) => {
      const assertion = new URLSearchParams(c.body).get("assertion") ?? "";
      const [h, p, s] = assertion.split(".");
      const ok = createVerify("RSA-SHA256")
        .update(`${h}.${p}`)
        .verify(publicKey, Buffer.from(s ?? "", "base64url"));
      const claims = JSON.parse(Buffer.from(p ?? "", "base64url").toString()) as {
        iss: string;
        aud: string;
      };
      return ok && claims.iss === "sa@acme.iam.gserviceaccount.com"
        ? { json: { access_token: "ya29", expires_in: 3599 } }
        : { status: 400, json: {} };
    });
    const sa = gcpServiceAccountToken({
      http: endpoint.http,
      key: {
        client_email: "sa@acme.iam.gserviceaccount.com",
        private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      },
    });
    expect(await sa()).toBe("ya29");
    expect(endpoint.calls[0]?.url).toBe("https://oauth2.googleapis.com/token");

    const md = fake(() => ({ json: { access_token: "md", expires_in: 100 } }));
    expect(await gcpMetadataToken({ http: md.http })()).toBe("md");
    expect(md.calls[0]?.headers["metadata-flavor"]).toBe("Google");
  });
});

describe("azure-kv and gcp-sm references", () => {
  it("read a Key Vault secret and a Secret Manager version", async () => {
    const azure = fake((c) => ({ json: { value: `azure:${c.url}` } }));
    const gcp = fake(() => ({
      json: { payload: { data: Buffer.from("gcp-secret").toString("base64") } },
    }));
    const resolver = new ExternalResolver({
      azureKeyVault: { token, http: azure.http },
      gcpSecretManager: { token, http: gcp.http },
    });
    expect(await resolver.resolve("azure-kv:acme-vault/openai-key")).toBe(
      "azure:https://acme-vault.vault.azure.net/secrets/openai-key?api-version=7.4",
    );
    expect(await resolver.resolve(`azure-kv:acme-vault/openai-key/${V1}`)).toContain(
      `/secrets/openai-key/${V1}?`,
    );
    expect(await resolver.resolve("gcp-sm:projects/acme/secrets/openai/versions/latest")).toBe(
      "gcp-secret",
    );
    expect(gcp.calls[0]?.url).toBe(
      "https://secretmanager.googleapis.com/v1/projects/acme/secrets/openai/versions/latest:access",
    );
    expect(azure.calls[0]?.headers.authorization).toBe("Bearer tok");
  });

  it("explain what is missing when a manager is not configured", async () => {
    const resolver = new ExternalResolver({});
    await expect(resolver.resolve("azure-kv:acme-vault/k")).rejects.toThrow(/not configured/);
    await expect(resolver.resolve("gcp-sm:projects/acme/secrets/k/versions/1")).rejects.toThrow(
      /not configured/,
    );
  });
});
