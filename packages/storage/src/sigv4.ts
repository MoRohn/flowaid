/**
 * AWS Signature Version 4 for S3 requests, over node:crypto only: header-signed requests and
 * presigned query-string URLs. Path segments and query parameters are encoded per RFC 3986 the way
 * S3 expects (each segment once, `/` kept).
 */
import { createHash, createHmac } from "node:crypto";

export interface SigningKeys {
  accessKey: string;
  secretKey: string;
  region: string;
  /** The AWS service name; `s3` for every S3-compatible store. */
  service?: string;
}

export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

export const sha256Hex = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

const hmac = (key: string | Buffer, data: string): Buffer =>
  createHmac("sha256", key).update(data, "utf8").digest();

/** RFC 3986 encoding: everything but unreserved characters (`A-Za-z0-9-._~`). */
export const rfc3986 = (s: string): string =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** Encodes an object path segment by segment, keeping the slashes. */
export const encodePath = (path: string): string => path.split("/").map(rfc3986).join("/");

/** `20130524T000000Z`. */
export const amzDate = (d: Date): string =>
  d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");

function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

function signature(
  keys: SigningKeys,
  date: Date,
  method: string,
  url: URL,
  headers: Record<string, string>,
  payloadHash: string,
): { signature: string; scope: string; signedHeaders: string } {
  const service = keys.service ?? "s3";
  const stamp = amzDate(date);
  const day = stamp.slice(0, 8);
  const scope = `${day}/${keys.region}/${service}/aws4_request`;
  const names = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")]),
  );
  const signedHeaders = names.join(";");
  const canonical = [
    method,
    url.pathname,
    canonicalQuery(url.searchParams),
    names.map((n) => `${n}:${lower[n] ?? ""}\n`).join(""),
    signedHeaders,
    payloadHash,
  ].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonical)].join("\n");
  const kDate = hmac(`AWS4${keys.secretKey}`, day);
  const kSigning = hmac(hmac(hmac(kDate, keys.region), service), "aws4_request");
  return { signature: hmac(kSigning, toSign).toString("hex"), scope, signedHeaders };
}

/**
 * The headers to send with a signed request (`host`, `x-amz-date`, `x-amz-content-sha256`,
 * `authorization`, plus the caller's `extra` headers, which are signed too).
 */
export function signRequest(input: {
  keys: SigningKeys;
  method: string;
  url: URL;
  payloadHash: string;
  date?: Date;
  headers?: Record<string, string>;
}): Record<string, string> {
  const date = input.date ?? new Date();
  const headers: Record<string, string> = {
    ...input.headers,
    host: input.url.host,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": amzDate(date),
  };
  const s = signature(input.keys, date, input.method, input.url, headers, input.payloadHash);
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.keys.accessKey}/${s.scope}, SignedHeaders=${s.signedHeaders}, Signature=${s.signature}`,
  };
}

/** A presigned URL (only `host` signed, payload unsigned), valid `expiresSeconds` from `date`. */
export function presignUrl(input: {
  keys: SigningKeys;
  method: string;
  url: URL;
  expiresSeconds: number;
  date?: Date;
}): URL {
  const date = input.date ?? new Date();
  const url = new URL(input.url);
  const day = amzDate(date).slice(0, 8);
  const scope = `${day}/${input.keys.region}/${input.keys.service ?? "s3"}/aws4_request`;
  url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  url.searchParams.set("X-Amz-Credential", `${input.keys.accessKey}/${scope}`);
  url.searchParams.set("X-Amz-Date", amzDate(date));
  url.searchParams.set("X-Amz-Expires", String(Math.floor(input.expiresSeconds)));
  url.searchParams.set("X-Amz-SignedHeaders", "host");
  const s = signature(input.keys, date, input.method, url, { host: url.host }, UNSIGNED_PAYLOAD);
  url.searchParams.set("X-Amz-Signature", s.signature);
  return url;
}
