import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  encryptWithIv,
  keyCheckValue,
  open,
  parseKey,
  randomKey,
  seal,
  zeroise,
  constantTimeEqual,
} from "./cipher.js";
import { envMasterKey, fileMasterKey } from "./masterKey/local.js";
import { awsKmsMasterKey, vaultTransitMasterKey, type KmsClient } from "./masterKey/remote.js";

const hex = (h: string) => Buffer.from(h, "hex");

describe("AES-256-GCM known answers (GCM specification, test cases 13 and 14)", () => {
  const key = Buffer.alloc(32);
  const iv = Buffer.alloc(12);
  it("empty plaintext", () => {
    const { ciphertext, tag } = encryptWithIv(key, iv, Buffer.alloc(0), Buffer.alloc(0));
    expect(ciphertext.length).toBe(0);
    expect(tag.toString("hex")).toBe("530f8afbc74536b9a963b4f1c4cb738b");
  });
  it("one zero block", () => {
    const { ciphertext, tag } = encryptWithIv(key, iv, Buffer.alloc(16), Buffer.alloc(0));
    expect(ciphertext.toString("hex")).toBe("cea7403d4d606b6e074ec5d3baf39d18");
    expect(tag.toString("hex")).toBe("d0d1c8a799996bf0265b98b5d48ab919");
  });
  it("rejects keys that are not 32 bytes", () => {
    expect(() => encryptWithIv(Buffer.alloc(16), iv, Buffer.alloc(0), Buffer.alloc(0))).toThrow(
      RangeError,
    );
  });
});

describe("seal / open", () => {
  const key = randomKey();
  const sealed = seal(key, Buffer.from("s3cret"), "cred-1|http.bearer|1");

  it("round-trips and uses a fresh IV each time", () => {
    expect(open(key, sealed, "cred-1|http.bearer|1").toString()).toBe("s3cret");
    expect(seal(key, Buffer.from("s3cret"), "a")).not.toBe(seal(key, Buffer.from("s3cret"), "a"));
  });

  it.each([
    ["the IV", 0],
    ["the tag", 13],
    ["the ciphertext", 29],
  ])("detects tampering with %s", (_what, offset) => {
    const raw = Buffer.from(sealed, "base64");
    raw[offset] = (raw[offset] ?? 0) ^ 0x01;
    expect(() => open(key, raw.toString("base64"), "cred-1|http.bearer|1")).toThrow(
      /failed authentication/,
    );
  });

  it("binds the ciphertext to its AAD and key", () => {
    expect(() => open(key, sealed, "cred-2|http.bearer|1")).toThrow(/failed authentication/);
    expect(() => open(randomKey(), sealed, "cred-1|http.bearer|1")).toThrow(
      /failed authentication/,
    );
    expect(() => open(key, "AAAA", "x")).toThrow(/truncated/);
  });

  it("zeroises, compares in constant time and parses keys", () => {
    const buffer = Buffer.from([1, 2, 3]);
    zeroise(buffer);
    expect([...buffer]).toEqual([0, 0, 0]);
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "ab")).toBe(false);
    expect(parseKey("00".repeat(32), "k")).toEqual(Buffer.alloc(32));
    expect(parseKey(Buffer.alloc(32, 7).toString("base64"), "k")).toEqual(Buffer.alloc(32, 7));
    expect(() => parseKey("short", "FLOWAID_MASTER_KEY")).toThrow(/32 random bytes/);
  });

  it("derives a stable 8-byte KCV", () => {
    const master = Buffer.alloc(32, 1);
    expect(keyCheckValue(master)).toBe(keyCheckValue(Buffer.alloc(32, 1)));
    expect(Buffer.from(keyCheckValue(master), "base64")).toHaveLength(8);
    expect(keyCheckValue(master)).not.toBe(keyCheckValue(Buffer.alloc(32, 2)));
  });
});

describe("local master keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "flowaid-master-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("env: wraps and unwraps KEKs and reports its KCV", async () => {
    const master = envMasterKey(Buffer.alloc(32, 9).toString("base64"));
    const kek = randomKey();
    expect(await master.unwrap(await master.wrap(kek))).toEqual(kek);
    expect(await master.kcv()).toBe(keyCheckValue(Buffer.alloc(32, 9)));
    await expect(envMasterKey("11".repeat(32)).unwrap(await master.wrap(kek))).rejects.toThrow(
      /failed authentication/,
    );
  });

  it("file: creates a 0600 key once, under the lock, and reuses it", async () => {
    const path = join(dir, "master.key");
    const onCreated = vi.fn();
    let locked = 0;
    const withLock = async <T>(fn: () => T | Promise<T>): Promise<T> => {
      locked += 1;
      return await fn();
    };
    const first = await fileMasterKey({ path, autogenerate: true, withLock, onCreated });
    expect(locked).toBe(1);
    expect(onCreated).toHaveBeenCalledWith(path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const second = await fileMasterKey({ path, autogenerate: false });
    expect(await second.kcv()).toBe(await first.kcv());
    expect(readFileSync(path, "utf8").trim()).toHaveLength(44);
  });

  it("file: refuses to create without autogenerate, and the loser of a creation race reads the winner", async () => {
    await expect(
      fileMasterKey({ path: join(dir, "absent.key"), autogenerate: false }),
    ).rejects.toThrow(/does not exist/);
    const raced = join(dir, "raced.key");
    const winner = Buffer.alloc(32, 5).toString("base64");
    const master = await fileMasterKey({
      path: raced,
      autogenerate: true,
      withLock: (fn) => {
        writeFileSync(raced, winner); // another process won between our read and our create
        return Promise.resolve(fn());
      },
    });
    expect(await master.kcv()).toBe(keyCheckValue(Buffer.alloc(32, 5)));
  });

  it("file: reports an unreadable or malformed key", async () => {
    const bad = join(dir, "bad.key");
    writeFileSync(bad, "not a key");
    await expect(fileMasterKey({ path: bad, autogenerate: true })).rejects.toThrow(
      /32 random bytes/,
    );
    const locked = join(dir, "locked");
    writeFileSync(locked, "x");
    chmodSync(locked, 0o000);
    if (process.getuid?.() !== 0)
      await expect(fileMasterKey({ path: locked, autogenerate: true })).rejects.toThrow();
  });
});

describe("remote master keys", () => {
  it("AWS KMS wraps through the client and fingerprints the key ARN", async () => {
    const client: KmsClient = {
      encrypt: (_key, plaintext) => Promise.resolve(Buffer.from([...plaintext].reverse())),
      decrypt: (_key, ciphertext) => Promise.resolve(Buffer.from([...ciphertext].reverse())),
    };
    const arn = "arn:aws:kms:eu-west-1:123456789012:key/abcd";
    const kms = awsKmsMasterKey({ keyArn: arn, client });
    const kek = randomKey();
    expect(await kms.unwrap(await kms.wrap(kek))).toEqual(kek);
    expect(await kms.kcv()).not.toBe(await awsKmsMasterKey({ keyArn: `${arn}2`, client }).kcv());
    expect(() => awsKmsMasterKey({ keyArn: "not-an-arn", client })).toThrow(/KMS key/);
  });

  it("Vault Transit encrypts and decrypts over HTTP with the token and namespace", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const vault = vaultTransitMasterKey({
      address: "https://vault.test:8200/",
      token: "hvs.x",
      key: "flowaid",
      namespace: "team",
      http: (url, init) => {
        seen.push({ url, headers: init?.headers as Record<string, string> });
        const body = JSON.parse(init?.body as string) as {
          plaintext?: string;
          ciphertext?: string;
        };
        return Promise.resolve(
          Response.json({
            data: body.plaintext
              ? { ciphertext: `vault:v1:${body.plaintext}` }
              : { plaintext: body.ciphertext?.slice("vault:v1:".length) },
          }),
        );
      },
    });
    const kek = randomKey();
    const wrapped = await vault.wrap(kek);
    expect(wrapped.startsWith("vault:v1:")).toBe(true);
    expect(await vault.unwrap(wrapped)).toEqual(kek);
    expect(seen[0]).toMatchObject({
      url: "https://vault.test:8200/v1/transit/encrypt/flowaid",
      headers: { "x-vault-token": "hvs.x", "x-vault-namespace": "team" },
    });
    expect(await vault.kcv()).toHaveLength(12);
    const failing = vaultTransitMasterKey({
      address: "https://v",
      token: "t",
      key: "k",
      http: () => Promise.resolve(new Response("", { status: 403 })),
    });
    await expect(failing.wrap(kek)).rejects.toThrow(/403/);
    const empty = vaultTransitMasterKey({
      address: "https://v",
      token: "t",
      key: "k",
      http: () => Promise.resolve(Response.json({})),
    });
    await expect(empty.wrap(kek)).rejects.toThrow(/no ciphertext/);
    await expect(empty.unwrap("vault:v1:x")).rejects.toThrow(/no plaintext/);
  });
});

void hex;
