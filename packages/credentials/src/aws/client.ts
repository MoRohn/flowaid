/**
 * AWS KMS and Secrets Manager over their JSON APIs, SigV4-signed through the injected fetch, and
 * the credential sources that feed them. No AWS SDK.
 *
 * Credentials, first match wins (the same order the AWS SDKs use for these three):
 *   1. static keys: `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` [+ `AWS_SESSION_TOKEN`]
 *   2. the ECS task role: `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` on `169.254.170.2`
 *   3. the EC2 instance profile through IMDSv2 (`169.254.169.254`, session-token protected)
 * Temporary credentials are cached until five minutes before they expire.
 *
 * The region of every call is the one in the key's or secret's ARN, so no region setting is
 * needed. `endpoint` replaces `https://<service>.<region>.amazonaws.com` (LocalStack, VPC
 * endpoints, tests); the signature still uses the ARN's region.
 */
import { CredentialError } from "@flowaid/workflow-core";
import type { HttpFetch } from "../masterKey/cloud.js";
import type { KmsClient } from "../masterKey/remote.js";
import type { SecretsManagerClient } from "../externalRef.js";
import { signAwsRequest, type AwsCredentials } from "./sigv4.js";

export type AwsCredentialSource = () => Promise<AwsCredentials>;

/** The `http` calls the metadata endpoints need: a timeout, and plain-text bodies. */
type Response = Awaited<ReturnType<HttpFetch>>;

const METADATA_TIMEOUT_MS = 2_000;
const REFRESH_BEFORE_MS = 5 * 60_000;
const ECS_HOST = "http://169.254.170.2";
const IMDS_HOST = "http://169.254.169.254";

export function staticAwsCredentials(credentials: AwsCredentials): AwsCredentialSource {
  if (!credentials.accessKeyId || !credentials.secretAccessKey)
    throw new CredentialError("AWS credentials need an access key id and a secret access key");
  return () => Promise.resolve(credentials);
}

interface Expiring {
  credentials: AwsCredentials;
  /** epoch ms; Infinity when the endpoint gives none */
  expiresAt: number;
}

/** Caches until five minutes before expiry; concurrent callers share one request. */
function cachedCredentials(
  fetchOnce: () => Promise<Expiring>,
  now: () => number = Date.now,
): AwsCredentialSource {
  let current: Expiring | null = null;
  let pending: Promise<AwsCredentials> | null = null;
  return () => {
    if (current && now() < current.expiresAt - REFRESH_BEFORE_MS)
      return Promise.resolve(current.credentials);
    pending ??= fetchOnce()
      .then((c) => {
        current = c;
        return c.credentials;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}

async function readText(what: string, response: Response): Promise<string> {
  if (!response.ok) throw new CredentialError(`${what} failed (${response.status})`);
  if (!response.text) throw new CredentialError(`${what}: the http client cannot read text`);
  return response.text();
}

/** The credential document both metadata endpoints return. */
async function parseRoleCredentials(what: string, response: Response): Promise<Expiring> {
  if (!response.ok) throw new CredentialError(`${what} failed (${response.status})`);
  const json = (await response.json()) as {
    AccessKeyId?: unknown;
    SecretAccessKey?: unknown;
    Token?: unknown;
    Expiration?: unknown;
  };
  if (typeof json.AccessKeyId !== "string" || typeof json.SecretAccessKey !== "string")
    throw new CredentialError(`${what} returned no credentials`);
  const expiresAt =
    typeof json.Expiration === "string" ? Date.parse(json.Expiration) : Number.POSITIVE_INFINITY;
  return {
    credentials: {
      accessKeyId: json.AccessKeyId,
      secretAccessKey: json.SecretAccessKey,
      ...(typeof json.Token === "string" && json.Token ? { sessionToken: json.Token } : {}),
    },
    expiresAt: Number.isNaN(expiresAt) ? 0 : expiresAt,
  };
}

/** The ECS task role (`AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`, set by the ECS agent). */
export function ecsContainerCredentials(options: {
  http: HttpFetch;
  relativeUri: string;
  now?: () => number;
}): AwsCredentialSource {
  // a path on the fixed link-local agent address, never another host
  if (
    !/^\/(?!\/)[A-Za-z0-9/_.?=&-]*$/.test(options.relativeUri) ||
    options.relativeUri.includes("..")
  )
    throw new CredentialError("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI must be a plain path");
  return cachedCredentials(
    async () =>
      parseRoleCredentials(
        "ECS container credentials",
        await options.http(`${ECS_HOST}${options.relativeUri}`, {
          signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
        }),
      ),
    options.now,
  );
}

/** The EC2 instance profile through IMDSv2 (a PUT for a session token first). */
export function ec2InstanceCredentials(options: {
  http: HttpFetch;
  now?: () => number;
}): AwsCredentialSource {
  return cachedCredentials(async () => {
    const token = (
      await readText(
        "EC2 metadata token request",
        await options.http(`${IMDS_HOST}/latest/api/token`, {
          method: "PUT",
          headers: { "x-aws-ec2-metadata-token-ttl-seconds": "21600" },
          signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
        }),
      )
    ).trim();
    const headers = { "x-aws-ec2-metadata-token": token };
    const base = `${IMDS_HOST}/latest/meta-data/iam/security-credentials/`;
    const role = (
      await readText(
        "EC2 instance profile lookup",
        await options.http(base, { headers, signal: AbortSignal.timeout(METADATA_TIMEOUT_MS) }),
      )
    )
      .split("\n")[0]
      ?.trim();
    if (!role) throw new CredentialError("the EC2 instance has no instance profile");
    return parseRoleCredentials(
      "EC2 instance credentials",
      await options.http(`${base}${encodeURIComponent(role)}`, {
        headers,
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
      }),
    );
  }, options.now);
}

export interface AwsCredentialEnv {
  AWS_ACCESS_KEY_ID?: string | undefined;
  AWS_SECRET_ACCESS_KEY?: string | undefined;
  AWS_SESSION_TOKEN?: string | undefined;
  AWS_CONTAINER_CREDENTIALS_RELATIVE_URI?: string | undefined;
}

/** Static keys, else the ECS task role, else the EC2 instance profile. */
export function awsCredentialChain(
  env: AwsCredentialEnv,
  http: HttpFetch,
  now?: () => number,
): AwsCredentialSource {
  const clock = now ? { now } : {};
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY)
    return staticAwsCredentials({
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {}),
    });
  if (env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI)
    return ecsContainerCredentials({
      http,
      relativeUri: env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI,
      ...clock,
    });
  return ec2InstanceCredentials({ http, ...clock });
}

/** `arn:<partition>:<service>:<region>:...` → region. */
export function arnRegion(arn: string): string {
  const region = arn.split(":")[3];
  if (!region || !/^[a-z0-9-]+$/.test(region))
    throw new CredentialError(`'${arn}' names no AWS region`);
  return region;
}

const DNS_SUFFIX: Record<string, string> = { "aws-cn": "amazonaws.com.cn" };

export interface AwsServiceOptions {
  http: HttpFetch;
  credentials: AwsCredentialSource;
  /** Replaces `https://<service>.<region>.amazonaws.com` (LocalStack, VPC endpoints). */
  endpoint?: string;
  clock?: () => Date;
}

/**
 * One AWS JSON-protocol call (`x-amz-json-1.1`): signed POST of `body` to `/` with the
 * `X-Amz-Target` header. Errors carry the status and the AWS error type, never the response body.
 */
async function awsJsonCall(
  options: AwsServiceOptions,
  call: { service: string; host: string; target: string; arn: string },
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const region = arnRegion(call.arn);
  const partition = call.arn.split(":")[1] ?? "aws";
  const base =
    options.endpoint?.replace(/\/+$/, "") ??
    `https://${call.host}.${region}.${DNS_SUFFIX[partition] ?? "amazonaws.com"}`;
  const url = new URL(`${base}/`);
  const payload = JSON.stringify(body);
  const headers = signAwsRequest({
    method: "POST",
    url,
    region,
    service: call.service,
    credentials: await options.credentials(),
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": call.target,
    },
    body: payload,
    ...(options.clock ? { date: options.clock() } : {}),
  });
  // fetch sets Host itself and refuses to be told
  delete headers.host;
  const response = await options.http(url.toString(), { method: "POST", headers, body: payload });
  if (!response.ok) {
    let type = "";
    try {
      const err = (await response.json()) as { __type?: unknown };
      if (typeof err.__type === "string") type = err.__type.split("#").pop()?.slice(0, 80) ?? "";
    } catch {
      // not JSON: the status says enough
    }
    const op = call.target.split(".").pop() ?? call.target;
    throw new CredentialError(
      `AWS ${call.service} ${op} failed (${response.status}${type ? ` ${type}` : ""})`,
    );
  }
  return (await response.json()) as Record<string, unknown>;
}

export interface AwsKmsClient extends KmsClient {
  /** A fresh data key: its plaintext and the same key encrypted under `keyId`. */
  generateDataKey(
    keyId: string,
    bytes?: number,
  ): Promise<{ plaintext: Uint8Array; ciphertext: Uint8Array }>;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function blob(value: unknown, what: string): Uint8Array {
  if (typeof value !== "string") throw new CredentialError(`AWS KMS returned no ${what}`);
  return Buffer.from(value, "base64");
}

/** KMS `Encrypt`, `Decrypt` and `GenerateDataKey` (TrentService). */
export function awsKmsClient(options: AwsServiceOptions): AwsKmsClient {
  const kms = (target: string, keyId: string, body: Record<string, unknown>) =>
    awsJsonCall(
      options,
      { service: "kms", host: "kms", target: `TrentService.${target}`, arn: keyId },
      body,
    );
  return {
    async encrypt(keyId, plaintext) {
      const out = await kms("Encrypt", keyId, { KeyId: keyId, Plaintext: b64(plaintext) });
      return blob(out.CiphertextBlob, "ciphertext");
    },
    async decrypt(keyId, ciphertext) {
      // KeyId pins the key: a ciphertext made under another key is refused by KMS
      const out = await kms("Decrypt", keyId, { KeyId: keyId, CiphertextBlob: b64(ciphertext) });
      return blob(out.Plaintext, "plaintext");
    },
    async generateDataKey(keyId, bytes = 32) {
      const out = await kms("GenerateDataKey", keyId, { KeyId: keyId, NumberOfBytes: bytes });
      return {
        plaintext: blob(out.Plaintext, "plaintext"),
        ciphertext: blob(out.CiphertextBlob, "ciphertext"),
      };
    },
  };
}

/** Secrets Manager `GetSecretValue` (the current version); binary secrets are read as UTF-8. */
export function awsSecretsManagerClient(options: AwsServiceOptions): SecretsManagerClient {
  return {
    async getSecretString(arn) {
      const out = await awsJsonCall(
        options,
        {
          service: "secretsmanager",
          host: "secretsmanager",
          target: "secretsmanager.GetSecretValue",
          arn,
        },
        { SecretId: arn },
      );
      if (typeof out.SecretString === "string") return out.SecretString;
      if (typeof out.SecretBinary === "string")
        return Buffer.from(out.SecretBinary, "base64").toString("utf8");
      throw new CredentialError(`Secret ${arn} has no value`);
    },
  };
}
