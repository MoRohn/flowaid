/**
 * npm tarballs: Subresource Integrity (`sha512-<base64>`, what registries publish as
 * `dist.integrity`) and a bounded, path-safe reader of the gzipped ustar archive. Plugin code is
 * never executed here; only `package.json` and the declared manifest file are read.
 */
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

/** Upper bound of an unpacked plugin tarball the API will read (npm's own limit is far higher). */
export const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;

export function integrityOf(
  data: Uint8Array,
  algorithm: "sha512" | "sha384" | "sha256" = "sha512",
): string {
  return `${algorithm}-${createHash(algorithm).update(data).digest("base64")}`;
}

/** Whether `data` matches an SRI string (any of its space-separated hashes of a known algorithm). */
export function verifyIntegrity(data: Uint8Array, integrity: string): boolean {
  const candidates = integrity
    .trim()
    .split(/\s+/)
    .map((h) => /^(sha512|sha384|sha256)-([A-Za-z0-9+/=]+)$/.exec(h))
    .filter((m): m is RegExpExecArray => m !== null);
  if (candidates.length === 0) return false;
  return candidates.some(
    (m) =>
      integrityOf(data, m[1] as "sha512" | "sha384" | "sha256") ===
      `${m[1] as string}-${m[2] as string}`,
  );
}

export interface TarEntry {
  /** path with npm's leading `package/` removed */
  path: string;
  data: Uint8Array;
}

function field(block: Uint8Array, start: number, length: number): string {
  const slice = block.subarray(start, start + length);
  const end = slice.indexOf(0);
  return new TextDecoder().decode(end === -1 ? slice : slice.subarray(0, end));
}

function safePath(raw: string): string | null {
  const parts = raw
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === "..") || raw.startsWith("/")) return null;
  // npm packs everything under one top-level directory (usually `package/`)
  return parts.slice(1).join("/") || null;
}

/** Reads the regular files of a gzipped (or plain) tar; rejects unsafe paths and oversized archives. */
export function readTarball(data: Uint8Array, maxBytes = MAX_UNPACKED_BYTES): TarEntry[] {
  const tar =
    data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data, { maxOutputLength: maxBytes }) : data;
  const entries: TarEntry[] = [];
  let offset = 0;
  let longName: string | null = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const size = parseInt(field(header, 124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) throw new Error("corrupt tarball: bad entry size");
    const type = String.fromCharCode(header[156] ?? 0);
    const prefix = field(header, 345, 155);
    const name =
      longName ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
    longName = null;
    const body = tar.subarray(offset + 512, offset + 512 + size);
    if (body.length < size) throw new Error("corrupt tarball: truncated entry");
    if (type === "L") longName = field(body, 0, body.length);
    else if (type === "0" || type === "\0") {
      const path = safePath(name);
      if (path === null) throw new Error(`tarball entry "${name}" escapes the package directory`);
      entries.push({ path, data: new Uint8Array(body) });
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

/** Builds a gzipped ustar archive with every file under `package/` (tests and the scaffold). */
export async function packTarball(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const { gzipSync } = await import("node:zlib");
  const chunks: Uint8Array[] = [];
  const enc = new TextEncoder();
  for (const [path, content] of Object.entries(files)) {
    const body = typeof content === "string" ? enc.encode(content) : content;
    const header = new Uint8Array(512);
    const put = (text: string, at: number, len: number) =>
      header.set(enc.encode(text).subarray(0, len), at);
    const name = `package/${path}`;
    if (name.length > 100) throw new Error(`path too long for the test packer: ${name}`);
    put(name, 0, 100);
    put("0000644\0", 100, 8);
    put("0000000\0", 108, 8);
    put("0000000\0", 116, 8);
    put(`${body.length.toString(8).padStart(11, "0")}\0`, 124, 12);
    put(
      `${Math.floor(Date.UTC(2026, 0, 1) / 1000)
        .toString(8)
        .padStart(11, "0")}\0`,
      136,
      12,
    );
    put("        ", 148, 8);
    header[156] = "0".charCodeAt(0);
    put("ustar\0", 257, 6);
    put("00", 263, 2);
    const sum = header.reduce((a, b) => a + b, 0);
    put(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
    chunks.push(header, body, new Uint8Array((512 - (body.length % 512)) % 512));
  }
  chunks.push(new Uint8Array(1024));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const tar = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    tar.set(c, at);
    at += c.length;
  }
  return new Uint8Array(gzipSync(tar));
}
