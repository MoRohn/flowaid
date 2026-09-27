import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeS3, type FakeS3 } from "./fakeS3.js";
import { EMPTY_SHA256, presignUrl, signRequest } from "./sigv4.js";
import {
  artifactStorageFrom,
  LocalArtifactStore,
  S3ArtifactStore,
  type ArtifactStore,
} from "./store.js";

// The worked examples from the AWS "Signature Version 4 for Amazon S3" documentation.
const AWS = {
  accessKey: "AKIAIOSFODNN7EXAMPLE",
  secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
};
const MAY_24 = new Date("2013-05-24T00:00:00Z");

describe("SigV4", () => {
  it("signs the documented GET object example", () => {
    const h = signRequest({
      keys: AWS,
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      payloadHash: EMPTY_SHA256,
      date: MAY_24,
      headers: { range: "bytes=0-9" },
    });
    expect(h.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("presigns the documented query-string example", () => {
    const url = presignUrl({
      keys: AWS,
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      expiresSeconds: 86400,
      date: MAY_24,
    });
    expect(url.searchParams.get("X-Amz-Signature")).toBe(
      "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });
});

function contract(name: string, make: () => ArtifactStore) {
  describe(name, () => {
    it("round-trips bytes, streams them and deletes", async () => {
      const store = make();
      const bytes = new TextEncoder().encode("hello artifact");
      await store.put("ws/w1/a1", bytes, "text/plain");
      expect(new TextDecoder().decode(await store.get("ws/w1/a1"))).toBe("hello artifact");
      const o = await store.open("ws/w1/a1");
      expect(o.size).toBe(bytes.byteLength);
      expect(await new Response(o.body).text()).toBe("hello artifact");
      await store.delete("ws/w1/a1");
      await expect(store.get("ws/w1/a1")).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(store.open("ws/w1/a1")).rejects.toMatchObject({ code: "NOT_FOUND" });
      await store.delete("ws/w1/a1");
    });

    it("rejects keys that could escape the store", async () => {
      const store = make();
      for (const key of ["../x", "ws/../../etc/passwd", "/abs", "ws//x", "ws/a b"])
        await expect(store.put(key, new Uint8Array(1), "text/plain")).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
    });
  });
}

let s3: FakeS3;
beforeAll(async () => {
  s3 = await startFakeS3();
});
afterAll(() => s3.close());

const s3Store = (over: Partial<ConstructorParameters<typeof S3ArtifactStore>[0]> = {}) =>
  new S3ArtifactStore({
    endpoint: s3.endpoint,
    bucket: s3.bucket,
    accessKey: s3.accessKey,
    secretKey: s3.secretKey,
    region: s3.region,
    forcePathStyle: true,
    ...over,
  });

contract("LocalArtifactStore", () => new LocalArtifactStore(mkdtempSync(join(tmpdir(), "st-"))));
contract("S3ArtifactStore", () => s3Store());

describe("S3ArtifactStore against the fake server", () => {
  it("stores under the bucket with the mime type, signed", async () => {
    await s3Store().put("ws/w2/zip", new Uint8Array([1, 2, 3]), "application/zip");
    expect(s3.objects.get("ws/w2/zip")).toMatchObject({ contentType: "application/zip" });
    expect(s3.requests).toContain(`PUT /${s3.bucket}/ws/w2/zip`);
  });

  it("presigns a download URL that works without credentials and expires", async () => {
    const store = s3Store();
    await store.put("ws/w3/f", new TextEncoder().encode("{}"), "application/json");
    const url = store.presign("ws/w3/f", {
      expiresSeconds: 60,
      contentDisposition: 'attachment; filename="f.json"',
    });
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="f.json"');
    expect(await res.text()).toBe("{}");
    const tampered = url.replace("ws/w3/f", "ws/w3/g");
    expect((await fetch(tampered)).status).toBe(403);
    const old = presignUrl({
      keys: s3,
      method: "GET",
      url: store.url("ws/w3/f"),
      expiresSeconds: 1,
      date: new Date(Date.now() - 60_000),
    });
    expect((await fetch(old)).status).toBe(403);
  });

  it("surfaces a wrong secret as a storage failure, not a missing object", async () => {
    await expect(s3Store({ secretKey: "nope" }).get("ws/w3/f")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message: expect.stringContaining("SignatureDoesNotMatch") as unknown,
    });
  });

  it("builds virtual-hosted URLs when path style is off", () => {
    const store = s3Store({
      endpoint: "https://s3.eu-central-1.amazonaws.com",
      forcePathStyle: false,
    });
    expect(store.url("ws/a/b").toString()).toBe(
      `https://${s3.bucket}.s3.eu-central-1.amazonaws.com/ws/a/b`,
    );
  });

  it("uses S3 only when all four variables are set, keeping local readable", () => {
    const dir = mkdtempSync(join(tmpdir(), "st-"));
    expect(artifactStorageFrom({}, dir).primary.kind).toBe("local");
    const both = artifactStorageFrom(
      { S3_ENDPOINT: s3.endpoint, S3_BUCKET: "b", S3_ACCESS_KEY: "a", S3_SECRET_KEY: "s" },
      dir,
    );
    expect(both.primary.kind).toBe("s3");
    expect(both.forKind("local").kind).toBe("local");
    expect(() => artifactStorageFrom({}, dir).forKind("s3")).toThrow(/not configured/);
  });
});
