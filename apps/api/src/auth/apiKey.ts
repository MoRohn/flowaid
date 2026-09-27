/**
 * API key format (API.md §1): `fa_<live|test>_<32 base62 random>_<6 base62 crc32>`. The checksum
 * lets secret scanners (and this server) reject a mistyped or fabricated key offline; lookups are
 * by SHA-256 of the whole key.
 */
import { createHash, randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const KEY_RE = /^fa_(live|test)_([0-9A-Za-z]{32})_([0-9A-Za-z]{6})$/;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(text: string): number {
  let c = 0xffffffff;
  for (const b of Buffer.from(text, "utf8")) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function base62(n: number, width: number): string {
  let out = "";
  let x = n;
  for (let i = 0; i < width; i++) {
    out = (ALPHABET[x % 62] ?? "0") + out;
    x = Math.floor(x / 62);
  }
  return out;
}

function randomBase62(length: number): string {
  let out = "";
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      if (b < 248 && out.length < length) out += ALPHABET[b % 62];
    }
  }
  return out;
}

export type KeyMode = "live" | "test";

export function generateApiKey(mode: KeyMode): { key: string; prefix: string; hash: string } {
  const body = `fa_${mode}_${randomBase62(32)}`;
  const key = `${body}_${base62(crc32(body), 6)}`;
  return { key, prefix: key.slice(0, `fa_${mode}_`.length + 8), hash: hashSecret(key) };
}

/** Structurally valid and checksum-correct (no database access). */
export function parseApiKey(key: string): { mode: KeyMode } | null {
  const m = KEY_RE.exec(key);
  if (!m?.[1] || !m[3]) return null;
  const body = key.slice(0, key.length - 7);
  return base62(crc32(body), 6) === m[3] ? { mode: m[1] as KeyMode } : null;
}

export function looksLikeApiKey(token: string): boolean {
  return token.startsWith("fa_live_") || token.startsWith("fa_test_");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** 32 random bytes, base64url: refresh tokens, review tokens, invitations, reset links. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}
