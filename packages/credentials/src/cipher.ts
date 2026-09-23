/**
 * AES-256-GCM primitives for the credential envelope (ARCHITECTURE.md §10.6): a 12-byte random
 * IV, a 16-byte tag and additional authenticated data that binds a ciphertext to its record, so
 * a ciphertext copied onto another credential, type or key version fails to decrypt. Sealed
 * values are `base64(iv | tag | ciphertext)`.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { CredentialError } from "@flowaid/workflow-core";

export const KEY_BYTES = 32;
export const IV_BYTES = 12;
export const TAG_BYTES = 16;

export function randomKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

function checkKey(key: Uint8Array): void {
  if (key.length !== KEY_BYTES)
    throw new RangeError(`AES-256 keys are ${KEY_BYTES} bytes (got ${key.length})`);
}

/** Encrypts with an explicit IV (for known-answer tests); production code uses `seal`. */
export function encryptWithIv(
  key: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): { ciphertext: Buffer; tag: Buffer } {
  checkKey(key);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  if (aad.length > 0) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, tag: cipher.getAuthTag() };
}

/** Encrypts `plaintext` under `key` with a fresh IV; returns `base64(iv | tag | ciphertext)`. */
export function seal(key: Uint8Array, plaintext: Uint8Array, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const { ciphertext, tag } = encryptWithIv(key, iv, plaintext, Buffer.from(aad, "utf8"));
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** Decrypts a sealed value; any tampering, a wrong key or a wrong AAD is a CredentialError. */
export function open(key: Uint8Array, sealed: string, aad: string): Buffer {
  checkKey(key);
  const raw = Buffer.from(sealed, "base64");
  if (raw.length < IV_BYTES + TAG_BYTES)
    throw new CredentialError("Sealed credential data is truncated");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const data = raw.subarray(IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  } catch {
    throw new CredentialError(
      "Credential data failed authentication (wrong key, wrong record or tampered)",
    );
  }
}

/** Key check value: base64 of the first 8 bytes of HMAC-SHA256(master, 'flowaid/master-kcv/v1'). */
export function keyCheckValue(master: Uint8Array): string {
  return createHmac("sha256", master)
    .update("flowaid/master-kcv/v1")
    .digest()
    .subarray(0, 8)
    .toString("base64");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Overwrites a buffer in place (for data keys and decrypted values once they are no longer needed). */
export function zeroise(buffer: Uint8Array): void {
  buffer.fill(0);
}

/** Parses a 32-byte key written as base64 (44 chars) or hex (64 chars). */
export function parseKey(text: string, what: string): Buffer {
  const trimmed = text.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (key.length !== KEY_BYTES) {
    throw new CredentialError(
      `${what} must be ${KEY_BYTES} random bytes as base64 (44 characters) or hex (64 characters)`,
    );
  }
  return key;
}
