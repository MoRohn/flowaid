import { describe, expect, it } from "vitest";

import { sha256Bytes, sha256Hex, sha256Json, sha256JsonRef } from "./hash.js";

// FIPS 180-4 / NIST known-answer vectors: empty string, "abc" and the 56-byte two-block message.
const VECTORS: readonly [input: string, digest: string][] = [
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  [
    "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  ],
  [
    "The quick brown fox jumps over the lazy dog",
    "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592",
  ],
];

/** Hex without `Buffer`, so this file stays meaningful in a browser-like environment. */
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("sha256Hex", () => {
  it("matches the standard test vectors", () => {
    for (const [input, digest] of VECTORS) {
      expect(sha256Hex(input)).toBe(digest);
    }
  });

  it("hashes raw bytes identically to the equivalent UTF-8 string", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(sha256Hex("abc"));
  });

  it("encodes non-ASCII strings as UTF-8 (node:crypto update(string) semantics)", () => {
    const text = "héllo € 🙂";
    expect(sha256Hex(text)).toBe(sha256Hex(new TextEncoder().encode(text)));
    // `printf 'é' | shasum -a 256` (UTF-8 bytes 0xc3 0xa9).
    expect(sha256Hex("é")).toBe(sha256Hex(new Uint8Array([0xc3, 0xa9])));
    expect(sha256Hex("é")).toBe("4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c");
  });

  it("respects the view window of a Uint8Array subarray", () => {
    const backing = new TextEncoder().encode("xxabcxx");
    expect(sha256Hex(backing.subarray(2, 5))).toBe(VECTORS[1]?.[1]);
  });

  it("hashes a million 'a's (FIPS long vector)", () => {
    expect(sha256Hex("a".repeat(1_000_000))).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });

  it("is synchronous (definitionHash / planHash are sync by contract)", () => {
    const digest: unknown = sha256Hex("abc");
    expect(typeof digest).toBe("string");
  });
});

describe("sha256Bytes", () => {
  it("returns the 32 raw digest bytes", () => {
    const bytes = sha256Bytes("abc");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(32);
    expect(hex(bytes)).toBe(VECTORS[1]?.[1]);
  });

  it("agrees with sha256Hex for every vector", () => {
    for (const [input, digest] of VECTORS) {
      expect(hex(sha256Bytes(input))).toBe(digest);
    }
  });
});

describe("sha256Json", () => {
  it("is key-order independent", () => {
    expect(sha256Json({ a: 1, b: [{ c: 2, d: 3 }] })).toBe(
      sha256Json({ b: [{ d: 3, c: 2 }], a: 1 }),
    );
  });

  it("hashes the stable-stringified form", () => {
    expect(sha256Json({ b: 1, a: 2 })).toBe(sha256Hex('{"a":2,"b":1}'));
    expect(sha256Json("abc")).toBe(sha256Hex('"abc"'));
  });

  it("pins the canonical-JSON digest of a small document", () => {
    // `printf '{"a":2,"b":1}' | shasum -a 256`; any change to stableStringify or the digest
    // would move it, and `definitionHash`/`planHash` stored in the database would drift.
    expect(sha256Json({ b: 1, a: 2 })).toBe(
      "d3626ac30a87e6f7a6428233b3c68299976865fa5508e4267c5415c76af7a772",
    );
  });

  it("differs for structurally different values", () => {
    expect(sha256Json({ a: 1 })).not.toBe(sha256Json({ a: "1" }));
    expect(sha256Json([1, 2])).not.toBe(sha256Json([2, 1]));
  });

  it("refuses non-JSON input", () => {
    expect(() => sha256Json({ a: undefined })).toThrow();
  });

  it("sha256JsonRef prefixes the algorithm", () => {
    expect(sha256JsonRef({ a: 1 })).toBe(`sha256:${sha256Json({ a: 1 })}`);
  });
});
