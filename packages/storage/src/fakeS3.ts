/**
 * A small in-process S3-compatible server for tests: path-style PUT/GET/HEAD/DELETE on one bucket,
 * with SigV4 verification of both signed headers and presigned URLs (wrong key, tampered request
 * or expired URL → 403 like S3). Objects live in memory.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { presignUrl, sha256Hex, signRequest, UNSIGNED_PAYLOAD, type SigningKeys } from "./sigv4.js";

export interface FakeS3 {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
  objects: Map<string, { body: Buffer; contentType: string }>;
  /** Every request as `METHOD /path` (presigned requests marked with `?presigned`). */
  requests: string[];
  close(): Promise<void>;
}

const parseAmzDate = (s: string): Date =>
  new Date(
    `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`,
  );

function fail(res: ServerResponse, status: number, code: string): void {
  res.writeHead(status, { "content-type": "application/xml" });
  res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code></Error>`);
}

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

export async function startFakeS3(
  opts: { bucket?: string; accessKey?: string; secretKey?: string; region?: string } = {},
): Promise<FakeS3> {
  const bucket = opts.bucket ?? "flowaid-test";
  const keys: SigningKeys = {
    accessKey: opts.accessKey ?? "fake-access",
    secretKey: opts.secretKey ?? "fake-secret",
    region: opts.region ?? "us-east-1",
  };
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const requests: string[] = [];

  const verify = (req: IncomingMessage, url: URL, payload: Buffer): string | null => {
    const auth = req.headers.authorization;
    if (auth) {
      const m = /Credential=([^/]+)\/[^,]+, SignedHeaders=([^,]+), Signature=([0-9a-f]+)/.exec(
        auth,
      );
      if (!m || m[1] !== keys.accessKey) return "InvalidAccessKeyId";
      const hash = String(req.headers["x-amz-content-sha256"] ?? "");
      if (hash !== UNSIGNED_PAYLOAD && hash !== sha256Hex(payload))
        return "XAmzContentSHA256Mismatch";
      const extra: Record<string, string> = {};
      for (const name of (m[2] ?? "").split(";"))
        if (!["host", "x-amz-date", "x-amz-content-sha256"].includes(name))
          extra[name] = String(req.headers[name] ?? "");
      const expected = signRequest({
        keys,
        method: req.method ?? "GET",
        url,
        payloadHash: hash,
        date: parseAmzDate(String(req.headers["x-amz-date"] ?? "")),
        headers: extra,
      });
      return expected.authorization === auth ? null : "SignatureDoesNotMatch";
    }
    const q = url.searchParams;
    if (q.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256") return "AccessDenied";
    if (!q.get("X-Amz-Credential")?.startsWith(`${keys.accessKey}/`)) return "InvalidAccessKeyId";
    const date = parseAmzDate(q.get("X-Amz-Date") ?? "");
    const expires = Number(q.get("X-Amz-Expires"));
    if (Date.now() > date.getTime() + expires * 1000) return "AccessDenied";
    const unsigned = new URL(url);
    for (const k of [
      "X-Amz-Algorithm",
      "X-Amz-Credential",
      "X-Amz-Date",
      "X-Amz-Expires",
      "X-Amz-SignedHeaders",
      "X-Amz-Signature",
    ])
      unsigned.searchParams.delete(k);
    const expected = presignUrl({
      keys,
      method: req.method ?? "GET",
      url: unsigned,
      expiresSeconds: expires,
      date,
    });
    return expected.searchParams.get("X-Amz-Signature") === q.get("X-Amz-Signature")
      ? null
      : "SignatureDoesNotMatch";
  };

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const payload = await body(req);
      requests.push(
        `${req.method} ${url.pathname}${req.headers.authorization ? "" : "?presigned"}`,
      );
      const denied = verify(req, url, payload);
      if (denied) return fail(res, 403, denied);
      const prefix = `/${bucket}/`;
      if (!url.pathname.startsWith(prefix)) return fail(res, 404, "NoSuchBucket");
      const key = decodeURIComponent(url.pathname.slice(prefix.length));
      switch (req.method ?? "GET") {
        case "PUT":
          objects.set(key, {
            body: payload,
            contentType: String(req.headers["content-type"] ?? "application/octet-stream"),
          });
          res.writeHead(200, { etag: `"${sha256Hex(payload).slice(0, 32)}"` });
          return res.end();
        case "GET":
        case "HEAD": {
          const o = objects.get(key);
          if (!o) return fail(res, 404, "NoSuchKey");
          const disposition = url.searchParams.get("response-content-disposition");
          res.writeHead(200, {
            "content-type": url.searchParams.get("response-content-type") ?? o.contentType,
            "content-length": o.body.byteLength,
            ...(disposition ? { "content-disposition": disposition } : {}),
          });
          return res.end(req.method === "GET" ? o.body : undefined);
        }
        case "DELETE":
          objects.delete(key);
          res.writeHead(204);
          return res.end();
        default:
          return fail(res, 405, "MethodNotAllowed");
      }
    })().catch(() => fail(res, 500, "InternalError"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    bucket,
    accessKey: keys.accessKey,
    secretKey: keys.secretKey,
    region: keys.region,
    objects,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
