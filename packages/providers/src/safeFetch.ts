/**
 * `createSafeFetch` — the SSRF-guarded fetch (ARCHITECTURE.md §10.6) used by the HTTP node, OpenAPI
 * tools, MCP HTTP transports, credential tests and webhook callbacks.
 *
 * - Only http(s); no credentials in URLs.
 * - Every connection resolves the host through a `lookup` hook that refuses loopback, private,
 *   link-local (incl. cloud metadata), CGNAT, multicast and unique-local addresses — at connect
 *   time, so DNS rebinding between check and use cannot slip through.
 * - Redirects are followed manually (at most 5), each hop re-checked; 301/302/303 downgrade
 *   non-GET/HEAD requests to GET without a body.
 * - Responses are capped (25 MiB by default); per-workspace allow/deny host lists apply.
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { Agent, type Dispatcher } from "undici";
import {
  ForbiddenError,
  NetworkError,
  PayloadTooLargeError,
  type SafeFetch,
} from "@flowaid/workflow-core";

export const SAFE_FETCH_DEFAULTS = { maxRedirects: 5, maxBytes: 25 * 1024 * 1024 } as const;

function ipv4Blocked(ip: string): boolean {
  const [a = 0, b = 0, c = 0] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** True for addresses a server-side fetch must never reach. */
export function isBlockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  const kind = isIP(ip);
  if (kind === 4) return ipv4Blocked(ip);
  if (kind === 6) {
    if (ip === "::" || ip === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped?.[1]) return ipv4Blocked(mapped[1]);
    if (/^::ffff:/.test(ip)) return true;
    // unique-local fc00::/7, link-local fe80::/10, multicast ff00::/8, documentation 2001:db8::/32, NAT64 64:ff9b::/96
    return (
      /^(?:f[cd]|fe[89ab]|ff)/.test(ip) || ip.startsWith("2001:db8:") || ip.startsWith("64:ff9b:")
    );
  }
  return true;
}

export type LookupFn = (
  hostname: string,
  options: { all: true },
  cb: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

export interface SafeFetchOptions {
  /** Development only: permit private addresses (never set in production). */
  allowPrivate?: boolean;
  /** Only these hosts (exact or `*.suffix`); empty/undefined = any public host. */
  allowHosts?: readonly string[];
  /** Never these hosts (exact or `*.suffix`). */
  denyHosts?: readonly string[];
  maxRedirects?: number;
  maxBytes?: number;
  /** Per-request timeout (in addition to the caller's signal). */
  timeoutMs?: number;
  /** Injectable DNS (tests). */
  lookup?: LookupFn;
  userAgent?: string;
}

const hostMatches = (host: string, rule: string) => {
  const h = host.toLowerCase();
  const r = rule.toLowerCase();
  return r.startsWith("*.") ? h.endsWith(r.slice(1)) : h === r;
};

export class SsrfBlockedError extends ForbiddenError {}

export function createSafeFetch(o: SafeFetchOptions = {}): SafeFetch {
  const lookup: LookupFn = o.lookup ?? ((host, opts, cb) => dnsLookup(host, opts, cb));
  const agent: Dispatcher = new Agent({
    connect: {
      // net.connect calls this with `{ all: true }` (happy eyeballs) and then expects an array.
      lookup: (hostname, options, cb) => {
        const all = (options as { all?: boolean } | undefined)?.all === true;
        const reply = cb;
        const literal = isIP(hostname.replace(/^\[|\]$/g, ""));
        const check = (addresses: LookupAddress[]) => {
          const ok = o.allowPrivate
            ? addresses
            : addresses.filter((a) => !isBlockedAddress(a.address));
          const first = ok[0];
          if (!first)
            return reply(
              new SsrfBlockedError(
                `refused to connect to ${hostname}: it resolves to a private or reserved address`,
              ),
              all ? [] : "",
              4,
            );
          if (all) reply(null, ok);
          else reply(null, first.address, first.family);
        };
        if (literal) return check([{ address: hostname.replace(/^\[|\]$/g, ""), family: literal }]);
        lookup(hostname, { all: true }, (err, addresses) =>
          err ? reply(err, all ? [] : "", 4) : check(addresses),
        );
      },
    },
  });
  const maxRedirects = o.maxRedirects ?? SAFE_FETCH_DEFAULTS.maxRedirects;
  const maxBytesDefault = o.maxBytes ?? SAFE_FETCH_DEFAULTS.maxBytes;

  const checkUrl = (raw: string): URL => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new ForbiddenError(`not an absolute URL: ${raw}`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new SsrfBlockedError(`scheme ${url.protocol} is not allowed`);
    if (url.username || url.password)
      throw new SsrfBlockedError("credentials in URLs are not allowed");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (o.denyHosts?.some((r) => hostMatches(host, r)))
      throw new SsrfBlockedError(`host ${host} is denied`);
    if (o.allowHosts && o.allowHosts.length > 0 && !o.allowHosts.some((r) => hostMatches(host, r)))
      throw new SsrfBlockedError(`host ${host} is not on the allow list`);
    if (!o.allowPrivate && isIP(host) && isBlockedAddress(host))
      throw new SsrfBlockedError(`refused to connect to ${host}: private or reserved address`);
    if (
      !o.allowPrivate &&
      /^(?:localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)
    )
      throw new SsrfBlockedError(`refused to connect to ${host}`);
    return url;
  };

  return async (input, init = {}) => {
    const { maxRedirects: perRequestRedirects, maxBytes: perRequestBytes, ...rest } = init;
    const limit = perRequestRedirects ?? maxRedirects;
    const maxBytes = perRequestBytes ?? maxBytesDefault;
    const signals = [
      rest.signal,
      o.timeoutMs ? AbortSignal.timeout(o.timeoutMs) : undefined,
    ].filter((s): s is AbortSignal => Boolean(s));
    let url = checkUrl(input);
    let method = (rest.method ?? "GET").toUpperCase();
    let body = rest.body;
    const headers = new Headers(rest.headers);
    if (o.userAgent && !headers.has("user-agent")) headers.set("user-agent", o.userAgent);
    for (let hop = 0; ; hop++) {
      let res: Response;
      try {
        res = await fetch(url, {
          ...rest,
          method,
          headers,
          body: body ?? null,
          redirect: "manual",
          ...(signals.length
            ? { signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals) }
            : {}),
          // @ts-expect-error undici's dispatcher option on Node's fetch
          dispatcher: agent,
        });
      } catch (error) {
        const cause = (error as { cause?: unknown }).cause;
        if (cause instanceof SsrfBlockedError) throw cause;
        if (error instanceof Error && error.name === "AbortError") throw error;
        throw new NetworkError(
          `request to ${url.origin} failed: ${cause instanceof Error ? cause.message : error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
        if (hop >= limit) throw new NetworkError(`too many redirects (more than ${limit})`);
        const next = new URL(res.headers.get("location") as string, url);
        await res.body?.cancel();
        url = checkUrl(next.toString());
        if (
          (res.status === 301 || res.status === 302 || res.status === 303) &&
          method !== "GET" &&
          method !== "HEAD"
        ) {
          method = "GET";
          body = undefined;
          headers.delete("content-type");
          headers.delete("content-length");
        }
        // Never forward credentials to another origin.
        if (next.origin !== new URL(input).origin) {
          headers.delete("authorization");
          headers.delete("cookie");
        }
        continue;
      }
      return capBody(res, maxBytes);
    }
  };
}

/** Wraps the body so reading past `maxBytes` fails with 413-style PayloadTooLargeError. */
function capBody(res: Response, maxBytes: number): Response {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    void res.body?.cancel();
    throw new PayloadTooLargeError(`the response is larger than ${maxBytes} bytes`);
  }
  if (!res.body) return res;
  let total = 0;
  const limited = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes)
          controller.error(
            new PayloadTooLargeError(`the response is larger than ${maxBytes} bytes`),
          );
        else controller.enqueue(chunk);
      },
    }),
  );
  return new Response(limited, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}
