/**
 * SHA-256 helpers over `@noble/hashes` (pure JS, synchronous, browser-safe).
 *
 * `sha256Json` is the content-hash primitive used for `definitionHash`, `planHash`,
 * idempotency keys and API-key lookups: it hashes the {@link stableStringify} form of a value
 * so that key order never changes a hash.
 *
 * No Node built-ins are used here: `definitionHash` and `planHash` are synchronous by
 * contract (CONTRACTS.ts), which rules out WebCrypto's async `subtle.digest`, and the
 * compiler runs in a Web Worker. `scripts/check-browser-bundle.test.ts` bundles this package
 * for the browser and fails on any `node:*` specifier anywhere in the import graph.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { stableStringify } from "./stringify.js";

const utf8 = new TextEncoder();

/** Strings are hashed as their UTF-8 encoding, exactly like `node:crypto`'s `update(string)`. */
function toBytes(input: string | Uint8Array): Uint8Array {
  return typeof input === "string" ? utf8.encode(input) : input;
}

/** Lower-case hex SHA-256 digest of a UTF-8 string or raw bytes. */
export function sha256Hex(input: string | Uint8Array): string {
  return bytesToHex(sha256(toBytes(input)));
}

/** Raw 32-byte SHA-256 digest of a UTF-8 string or raw bytes. */
export function sha256Bytes(input: string | Uint8Array): Uint8Array {
  return sha256(toBytes(input));
}

/**
 * Lower-case hex SHA-256 of the canonical JSON form of `value` (keys sorted at every depth).
 * Structurally equal values always hash identically. Throws for values that are not JSON
 * (see {@link stableStringify}).
 */
export function sha256Json(value: unknown): string {
  return sha256Hex(stableStringify(value));
}

/** The `sha256:` prefixed form used in content-addressed identifiers (artifacts, plans). */
export function sha256JsonRef(value: unknown): `sha256:${string}` {
  return `sha256:${sha256Json(value)}`;
}
