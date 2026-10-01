/**
 * AWS Signature Version 4 (header-signed requests) over node:crypto, for the JSON-protocol
 * services the key services call: KMS and Secrets Manager. No AWS SDK.
 *
 * Canonical request: method, URI path (each segment RFC 3986-encoded once), the sorted canonical
 * query, the signed headers (lowercased names, trimmed values with inner runs of spaces collapsed),
 * the signed-header list and the hex SHA-256 of the body. Verified against AWS's published
 * `aws-sig-v4-test-suite` vectors (`sigv4.test.ts`).
 *
 * `@flowaid/storage` has its own S3 signer (S3 signs `x-amz-content-sha256` and presigns URLs);
 * the package boundaries keep the two apart.
 */
import { createHash, createHmac } from "node:crypto";

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** Temporary credentials (STS, ECS task role, EC2 instance profile). */
  sessionToken?: string;
}

const sha256Hex = (data: string): string => createHash("sha256").update(data, "utf8").digest("hex");

const hmac = (key: string | Buffer, data: string): Buffer =>
  createHmac("sha256", key).update(data, "utf8").digest();

/** RFC 3986: everything but `A-Za-z0-9-._~` percent-encoded, uppercase hex. */
const rfc3986 = (s: string): string =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** `20150830T123600Z`. */
export const amzDate = (d: Date): string =>
  d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");

function canonicalPath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => rfc3986(decodeURIComponent(segment)))
    .join("/");
}

function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

export interface SignInput {
  method: string;
  url: URL;
  region: string;
  service: string;
  credentials: AwsCredentials;
  /** Headers to send and sign; `host`, `x-amz-date` and the session token are added. */
  headers?: Record<string, string>;
  body?: string;
  date?: Date;
}

/**
 * The headers to send: the caller's (lowercased), `host`, `x-amz-date`, `x-amz-security-token`
 * for temporary credentials (signed, as STS requires), and `authorization`.
 */
export function signAwsRequest(input: SignInput): Record<string, string> {
  const date = input.date ?? new Date();
  const stamp = amzDate(date);
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) headers[k.toLowerCase()] = v;
  headers.host = input.url.host;
  headers["x-amz-date"] = stamp;
  if (input.credentials.sessionToken)
    headers["x-amz-security-token"] = input.credentials.sessionToken;

  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const canonical = [
    input.method.toUpperCase(),
    canonicalPath(input.url.pathname || "/"),
    canonicalQuery(input.url.searchParams),
    names.map((n) => `${n}:${(headers[n] ?? "").trim().replace(/ +/g, " ")}\n`).join(""),
    signedHeaders,
    sha256Hex(input.body ?? ""),
  ].join("\n");
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonical)].join("\n");
  const kSigning = hmac(
    hmac(hmac(hmac(`AWS4${input.credentials.secretAccessKey}`, day), input.region), input.service),
    "aws4_request",
  );
  const signature = createHmac("sha256", kSigning).update(toSign, "utf8").digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
