/**
 * Private-address checks for OpenAPI documents and servers: loopback, RFC 1918, CGNAT, link-local
 * (incl. the 169.254.169.254 metadata address), unique-local and mapped IPv6, and internal names.
 * The worker's SafeFetch resolves DNS as well; this is the import-time literal check.
 */
import { isIP } from "node:net";

function ipv4Private(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateAddress(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const kind = isIP(host);
  if (kind === 4) return ipv4Private(host);
  if (kind === 6) {
    if (host === "::" || host === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
    if (mapped?.[1]) return ipv4Private(mapped[1]);
    return /^(?:fc|fd|fe[89ab])/.test(host) || host.startsWith("::ffff:");
  }
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host === "metadata.google.internal" ||
    !host.includes(".")
  );
}

export function isPrivateUrl(url: string | URL): boolean {
  try {
    const u = typeof url === "string" ? new URL(url) : url;
    if (u.protocol !== "https:" && u.protocol !== "http:") return true;
    return isPrivateAddress(u.hostname);
  } catch {
    return true;
  }
}
