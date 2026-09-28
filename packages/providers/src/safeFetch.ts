/**
 * `createSafeFetch` — the SSRF-guarded fetch (ARCHITECTURE.md §10.6) used by the HTTP node, OpenAPI
 * tools, MCP HTTP transports, credential tests and webhook callbacks.
 *
 * - Only http(s); no credentials in URLs.
 * - Every connection resolves the host through a `lookup` hook that refuses loopback, private,
 *   link-local (incl. cloud metadata), CGNAT, multicast and unique-local addresses — at connect
 *   time, so DNS rebinding between check and use cannot slip through.
 * - Redirects are followed manually (at most 5), each hop re-checked; 301/302/303 downgrade
 *   non-GET/HEAD requests to GET without a body. A hop to another origin keeps only
 *   content-negotiation headers, so no credential header follows it.
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

/** The only request headers a redirect to another origin keeps (plus Content-Type with a body). */
const CROSS_ORIGIN_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "cache-control",
  "user-agent",
]);

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

/** The eight 16-bit groups of a valid IPv6 address (a trailing dotted IPv4 becomes two). */
function ipv6Groups(ip: string): number[] {
  let text = ip.replace(/%.*$/, "");
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", tail] = text.split("::");
  const parse = (part: string) => (part ? part.split(":").map((g) => parseInt(g, 16)) : []);
  const left = parse(head);
  const right = tail === undefined ? [] : parse(tail);
  return [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
}

const v4Of = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** True for addresses a server-side fetch must never reach. */
export function isBlockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  const kind = isIP(ip);
  if (kind === 4) return ipv4Blocked(ip);
  if (kind === 6) {
    const g = ipv6Groups(ip);
    const [g0 = 0, g1 = 0, g2 = 0, , , g5 = 0, g6 = 0, g7 = 0] = g;
    const zeroPrefix = (n: number) => g.slice(0, n).every((x) => x === 0);
    // ::/96 covers ::, ::1 and the deprecated IPv4-compatible ::a.b.c.d; ::ffff:0:0/96 is mapped
    if (zeroPrefix(6)) return true;
    if (zeroPrefix(5) && g5 === 0xffff) return ipv4Blocked(v4Of(g6, g7));
    if (zeroPrefix(5)) return true;
    // NAT64 64:ff9b::/96 and its local-use 64:ff9b:1::/48 translate to any IPv4 address
    if (g0 === 0x64 && g1 === 0xff9b) return true;
    // 6to4 2002::/16 embeds the IPv4 relay target in the next 32 bits
    if (g0 === 0x2002) return ipv4Blocked(v4Of(g1, g2));
    // Teredo 2001:0::/32 tunnels to embedded IPv4 server and client addresses
    if (g0 === 0x2001 && g1 === 0) return true;
    // documentation 2001:db8::/32
    if (g0 === 0x2001 && g1 === 0xdb8) return true;
    // unique-local fc00::/7, link-local fe80::/10, site-local fec0::/10, multicast ff00::/8
    return (g0 & 0xfe00) === 0xfc00 || (g0 & 0xff80) === 0xfe80 || (g0 & 0xff00) === 0xff00;
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
        // Never forward credentials to another origin: they may sit in any custom header
        // (X-API-Key, an OpenAPI tool's apiKey header), so only content negotiation survives.
        if (next.origin !== new URL(input).origin) {
          for (const name of [...headers.keys()]) {
            if (!CROSS_ORIGIN_HEADERS.has(name) && !(name === "content-type" && body != null))
              headers.delete(name);
          }
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
