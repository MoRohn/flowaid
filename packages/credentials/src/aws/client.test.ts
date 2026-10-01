/**
 * The AWS clients against a fake KMS + Secrets Manager speaking the JSON protocol on a real HTTP
 * server (the shape LocalStack serves). The fake re-derives every request's SigV4 signature with
 * the secret it knows and refuses a mismatch, so these tests prove the requests are signed the
 * way AWS verifies them, end to end through `fetch`.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExternalResolver } from "../externalRef.js";
import { externalResolverOptionsFromEnv, masterKeyProviderFromEnv } from "../fromEnv.js";
import type { HttpFetch } from "../masterKey/cloud.js";
import {
  awsCredentialChain,
  awsKmsClient,
  awsSecretsManagerClient,
  ec2InstanceCredentials,
  ecsContainerCredentials,
} from "./client.js";
import { signAwsRequest } from "./sigv4.js";

const KEY_ARN = "arn:aws:kms:eu-west-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab";
const OTHER_KEY = "arn:aws:kms:eu-west-1:123456789012:key/ffffffff-12ab-34cd-56ef-1234567890ab";
const SECRET_ARN = "arn:aws:secretsmanager:eu-west-1:123456789012:secret:flowaid/slack-AbCdEf";
const JSON_ARN = "arn:aws:secretsmanager:eu-west-1:123456789012:secret:flowaid/db-XyZ123";
const ACCESS = { accessKeyId: "AKIDFAKE", secretAccessKey: "fake-secret", sessionToken: "sess" };

/** KMS: AES-256-GCM under a per-key secret, the key ARN bound as AAD (like a real KMS blob). */
const serverKeys = new Map([
  [KEY_ARN, randomBytes(32)],
  [OTHER_KEY, randomBytes(32)],
]);
function serverKey(keyId: string): Buffer {
  const key = serverKeys.get(keyId);
  if (!key) throw new Error(`no key ${keyId}`);
  return key;
}
function kmsEncrypt(keyId: string, plaintext: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", serverKey(keyId), iv).setAAD(Buffer.from(keyId));
  const body = Buffer.concat([c.update(plaintext), c.final()]);
  const id = Buffer.from(keyId);
  return Buffer.concat([Buffer.from([id.length]), id, iv, c.getAuthTag(), body]);
}
function kmsDecrypt(blob: Buffer): { keyId: string; plaintext: Buffer } {
  const n = blob[0] ?? 0;
  const keyId = blob.subarray(1, 1 + n).toString();
  const iv = blob.subarray(1 + n, 13 + n);
  const tag = blob.subarray(13 + n, 29 + n);
  const d = createDecipheriv("aes-256-gcm", serverKey(keyId), iv).setAAD(Buffer.from(keyId));
  d.setAuthTag(tag);
  return { keyId, plaintext: Buffer.concat([d.update(blob.subarray(29 + n)), d.final()]) };
}

interface Seen {
  target: string;
  region: string;
  service: string;
  token: string | undefined;
}
const seen: Seen[] = [];

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Re-signs the request as the server would; null when the signature does not match. */
function verify(req: IncomingMessage, body: string): Seen | null {
  const auth = String(req.headers.authorization ?? "");
  const m =
    /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([a-z0-9-]+)\/([a-z]+)\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$/.exec(
      auth,
    );
  if (!m || m[1] !== ACCESS.accessKeyId) return null;
  const [, , , region = "", service = "", signed = ""] = m;
  const headers: Record<string, string> = {};
  for (const name of signed.split(";"))
    if (!["host", "x-amz-date", "x-amz-security-token"].includes(name))
      headers[name] = String(req.headers[name] ?? "");
  const amz = String(req.headers["x-amz-date"]);
  const date = new Date(
    `${amz.slice(0, 4)}-${amz.slice(4, 6)}-${amz.slice(6, 8)}T${amz.slice(9, 11)}:${amz.slice(11, 13)}:${amz.slice(13, 15)}Z`,
  );
  const token = req.headers["x-amz-security-token"] as string | undefined;
  const expected = signAwsRequest({
    method: req.method ?? "POST",
    url: new URL(`http://${req.headers.host}${req.url}`),
    region,
    service,
    credentials: { ...ACCESS, ...(token ? { sessionToken: token } : { sessionToken: "" }) },
    headers,
    body,
    date,
  }).authorization;
  if (expected !== auth) return null;
  return { target: String(req.headers["x-amz-target"]), region, service, token };
}

let server: Server;
let endpoint = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    void readBody(req).then((body) => {
      const reply = (status: number, json: unknown) => {
        res.writeHead(status, { "content-type": "application/x-amz-json-1.1" });
        res.end(JSON.stringify(json));
      };
      const who = verify(req, body);
      if (!who)
        return reply(403, {
          __type: "com.amazon.coral.service#InvalidSignatureException",
          message: "The request signature we calculated does not match",
        });
      seen.push(who);
      const input = JSON.parse(body) as Record<string, string | number>;
      switch (who.target) {
        case "TrentService.Encrypt":
          return reply(200, {
            KeyId: input.KeyId,
            CiphertextBlob: kmsEncrypt(
              String(input.KeyId),
              Buffer.from(String(input.Plaintext), "base64"),
            ).toString("base64"),
          });
        case "TrentService.Decrypt": {
          const out = kmsDecrypt(Buffer.from(String(input.CiphertextBlob), "base64"));
          if (input.KeyId && input.KeyId !== out.keyId)
            return reply(400, { __type: "IncorrectKeyException", message: "wrong key" });
          return reply(200, { KeyId: out.keyId, Plaintext: out.plaintext.toString("base64") });
        }
        case "TrentService.GenerateDataKey": {
          const plaintext = randomBytes(Number(input.NumberOfBytes));
          return reply(200, {
            KeyId: input.KeyId,
            Plaintext: plaintext.toString("base64"),
            CiphertextBlob: kmsEncrypt(String(input.KeyId), plaintext).toString("base64"),
          });
        }
        case "secretsmanager.GetSecretValue":
          if (input.SecretId === SECRET_ARN)
            return reply(200, { ARN: SECRET_ARN, SecretString: "xoxb-from-aws" });
          if (input.SecretId === JSON_ARN)
            return reply(200, {
              ARN: JSON_ARN,
              SecretBinary: Buffer.from('{"password":"pg-from-aws"}').toString("base64"),
            });
          return reply(400, {
            __type: "ResourceNotFoundException",
            message: `Secrets Manager can't find the specified secret ${String(input.SecretId)}`,
          });
        default:
          return reply(400, { __type: "UnknownOperationException" });
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const http: HttpFetch = (url, init) => fetch(url, init);
const credentials = () => Promise.resolve(ACCESS);

describe("awsKmsClient", () => {
  it("encrypts and decrypts through KMS, signed for the ARN's region", async () => {
    const kms = awsKmsClient({ http, credentials, endpoint });
    const blob = await kms.encrypt(KEY_ARN, Buffer.from("kek bytes"));
    expect(Buffer.from(await kms.decrypt(KEY_ARN, blob)).toString()).toBe("kek bytes");
    expect(seen.at(-1)).toEqual({
      target: "TrentService.Decrypt",
      region: "eu-west-1",
      service: "kms",
      token: "sess",
    });
  });

  it("generates a data key whose ciphertext decrypts to its plaintext", async () => {
    const kms = awsKmsClient({ http, credentials, endpoint });
    const key = await kms.generateDataKey(KEY_ARN);
    expect(key.plaintext).toHaveLength(32);
    expect(Buffer.from(await kms.decrypt(KEY_ARN, key.ciphertext))).toEqual(
      Buffer.from(key.plaintext),
    );
  });

  it("pins Decrypt to the configured key", async () => {
    const kms = awsKmsClient({ http, credentials, endpoint });
    const blob = await kms.encrypt(OTHER_KEY, Buffer.from("x"));
    await expect(kms.decrypt(KEY_ARN, blob)).rejects.toThrow(
      "AWS kms Decrypt failed (400 IncorrectKeyException)",
    );
  });

  it("reports a rejected signature with the AWS error type and nothing from the body", async () => {
    const kms = awsKmsClient({
      http,
      credentials: () => Promise.resolve({ ...ACCESS, secretAccessKey: "wrong" }),
      endpoint,
    });
    const err = await kms.encrypt(KEY_ARN, Buffer.from("x")).catch((e: Error) => e);
    expect(String(err)).toContain("AWS kms Encrypt failed (403 InvalidSignatureException)");
    expect(String(err)).not.toContain("calculated");
  });

  it("calls the regional endpoint without an override", async () => {
    const urls: string[] = [];
    const record: HttpFetch = (url) => {
      urls.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ CiphertextBlob: "AA==" }),
      });
    };
    await awsKmsClient({ http: record, credentials }).encrypt(KEY_ARN, Buffer.from("x"));
    await awsKmsClient({ http: record, credentials }).encrypt(
      "arn:aws-cn:kms:cn-north-1:123456789012:key/abc",
      Buffer.from("x"),
    );
    expect(urls).toEqual([
      "https://kms.eu-west-1.amazonaws.com/",
      "https://kms.cn-north-1.amazonaws.com.cn/",
    ]);
  });
});

describe("the aws-kms master key and aws-sm references from the environment", () => {
  const BASE = {
    FLOWAID_MASTER_KEY_PROVIDER: "aws-kms",
    FLOWAID_MASTER_KEY_ID: KEY_ARN,
    VAULT_TRANSIT_MOUNT: "transit",
    AWS_ACCESS_KEY_ID: ACCESS.accessKeyId,
    AWS_SECRET_ACCESS_KEY: ACCESS.secretAccessKey,
    AWS_SESSION_TOKEN: ACCESS.sessionToken,
  };
  const env = () =>
    ({ ...BASE, AWS_ENDPOINT_URL: endpoint }) as unknown as Parameters<
      typeof masterKeyProviderFromEnv
    >[0];
  const deps = { http, readFile: () => "{}" };

  it("wraps and unwraps KEKs, and the KCV names the key", async () => {
    const master = await masterKeyProviderFromEnv(env(), deps, () =>
      Promise.reject(new Error("not local")),
    );
    expect(master.id).toBe("aws-kms");
    const kek = Buffer.alloc(32, 9);
    const wrapped = await master.wrap(kek);
    expect(wrapped).not.toContain(kek.toString("base64"));
    expect(await master.unwrap(wrapped)).toEqual(kek);
    const other = await masterKeyProviderFromEnv(
      { ...env(), FLOWAID_MASTER_KEY_ID: OTHER_KEY },
      deps,
      () => Promise.reject(new Error("not local")),
    );
    expect(await master.kcv()).not.toBe(await other.kcv());
    await expect(other.unwrap(wrapped)).rejects.toThrow("IncorrectKeyException");
  });

  it("resolves aws-sm references, with a JSON key, from a binary secret too", async () => {
    const resolver = new ExternalResolver(externalResolverOptionsFromEnv(env(), deps));
    expect(await resolver.resolve(`aws-sm:${SECRET_ARN}`)).toBe("xoxb-from-aws");
    expect(await resolver.resolve(`aws-sm:${JSON_ARN}#password`)).toBe("pg-from-aws");
    expect(seen.at(-1)?.target).toBe("secretsmanager.GetSecretValue");
    expect(seen.at(-1)?.service).toBe("secretsmanager");
    await expect(
      resolver.resolve(
        "aws-sm:arn:aws:secretsmanager:eu-west-1:123456789012:secret:missing-AAAAAA",
      ),
    ).rejects.toThrow("(400 ResourceNotFoundException)");
  });

  it("asks for no credentials until a reference is used", () => {
    let calls = 0;
    const counting: HttpFetch = (url, init) => {
      calls++;
      return fetch(url, init);
    };
    externalResolverOptionsFromEnv(
      { VAULT_TRANSIT_MOUNT: "transit" } as unknown as Parameters<
        typeof externalResolverOptionsFromEnv
      >[0],
      { http: counting, readFile: () => "{}" },
    );
    expect(calls).toBe(0);
  });

  it("the Secrets Manager client stands alone", async () => {
    const sm = awsSecretsManagerClient({ http, credentials, endpoint });
    expect(await sm.getSecretString(SECRET_ARN)).toBe("xoxb-from-aws");
  });
});

/** A scripted metadata endpoint: `routes` maps "METHOD url" to a response. */
function metadata(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { key: string; headers: Record<string, string> }[] = [];
  const fetcher: HttpFetch = (url, init) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push({ key, headers: init?.headers ?? {} });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const route = routes[key] ?? { status: 404, body: "" };
    const status = route.status ?? 200;
    return Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(route.body),
      text: () => Promise.resolve(String(route.body)),
    });
  };
  return { calls, fetcher };
}

const ROLE_CREDS = (expiration: string) => ({
  AccessKeyId: "ASIAROLE",
  SecretAccessKey: "role-secret",
  Token: "role-token",
  Expiration: expiration,
});

describe("credential sources", () => {
  it("prefers static keys, then the ECS task role, then the EC2 instance profile", async () => {
    const none = metadata({}).fetcher;
    expect(
      await awsCredentialChain({ AWS_ACCESS_KEY_ID: "AK", AWS_SECRET_ACCESS_KEY: "SK" }, none)(),
    ).toEqual({ accessKeyId: "AK", secretAccessKey: "SK" });

    const ecs = metadata({
      "GET http://169.254.170.2/v2/credentials/abc": { body: ROLE_CREDS("2099-01-01T00:00:00Z") },
    });
    expect(
      await awsCredentialChain(
        { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/abc" },
        ecs.fetcher,
      )(),
    ).toEqual({
      accessKeyId: "ASIAROLE",
      secretAccessKey: "role-secret",
      sessionToken: "role-token",
    });

    const ec2 = metadata({
      "PUT http://169.254.169.254/latest/api/token": { body: "imds-token\n" },
      "GET http://169.254.169.254/latest/meta-data/iam/security-credentials/": {
        body: "flowaid-role\n",
      },
      "GET http://169.254.169.254/latest/meta-data/iam/security-credentials/flowaid-role": {
        body: ROLE_CREDS("2099-01-01T00:00:00Z"),
      },
    });
    expect((await awsCredentialChain({}, ec2.fetcher)()).accessKeyId).toBe("ASIAROLE");
    expect(ec2.calls[0]?.headers["x-aws-ec2-metadata-token-ttl-seconds"]).toBe("21600");
    expect(ec2.calls[2]?.headers["x-aws-ec2-metadata-token"]).toBe("imds-token");
  });

  it("caches role credentials until five minutes before they expire", async () => {
    let now = Date.parse("2030-01-01T00:00:00Z");
    const ecs = metadata({
      "GET http://169.254.170.2/creds": { body: ROLE_CREDS("2030-01-01T01:00:00Z") },
    });
    const source = ecsContainerCredentials({
      http: ecs.fetcher,
      relativeUri: "/creds",
      now: () => now,
    });
    await Promise.all([source(), source()]);
    expect(ecs.calls).toHaveLength(1);
    now += 54 * 60_000;
    await source();
    expect(ecs.calls).toHaveLength(1);
    now += 2 * 60_000;
    await source();
    expect(ecs.calls).toHaveLength(2);
  });

  it("refuses a relative URI that could leave the agent address", () => {
    for (const uri of ["@evil.example/x", "//evil.example/x", "/a/../../x", "http://x"])
      expect(() =>
        ecsContainerCredentials({ http: metadata({}).fetcher, relativeUri: uri }),
      ).toThrow("plain path");
  });

  it("fails clearly off EC2", async () => {
    await expect(ec2InstanceCredentials({ http: metadata({}).fetcher })()).rejects.toThrow(
      "EC2 metadata token request failed (404)",
    );
  });
});
