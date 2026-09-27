/**
 * The web app's API proxy: `/v1/*`, `/hooks/*`, `/mcp/*` and the JWKS are forwarded to the API at
 * request time (`FLOWAID_API_INTERNAL_URL`, read per request so one image serves any
 * deployment). The browser therefore talks to one origin: the session cookie is first-party and
 * no CORS is involved. Bodies stream both ways (SSE included); every Set-Cookie is kept.
 */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

export function apiOrigin(): string {
  return (process.env.FLOWAID_API_INTERNAL_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * The request's headers minus hop-by-hop ones. Next's server has already set `x-forwarded-for`
 * to the client's address (or kept an upstream proxy's), so the API sees the real client when
 * it trusts this hop (FLOWAID_TRUST_PROXY).
 */
export function forwardedRequestHeaders(req: Request): Headers {
  const out = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) out.set(key, value);
  });
  const url = new URL(req.url);
  out.set("x-forwarded-proto", url.protocol.replace(":", ""));
  out.set("x-forwarded-host", req.headers.get("host") ?? url.host);
  return out;
}

export function responseHeaders(upstream: Response): Headers {
  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === "set-cookie" || HOP_BY_HOP.has(k) || k === "content-encoding") return;
    out.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) out.append("set-cookie", cookie);
  return out;
}

export async function proxy(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const target = `${apiOrigin()}${url.pathname}${url.search}`;
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: forwardedRequestHeaders(req),
      ...(hasBody ? { body: req.body, duplex: "half" } : {}),
      redirect: "manual",
      signal: req.signal,
      cache: "no-store",
    });
  } catch {
    return Response.json(
      {
        error: { code: "SERVICE_UNAVAILABLE", message: "The API is unreachable.", retryable: true },
      },
      { status: 503, headers: { "retry-after": "2" } },
    );
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders(upstream),
  });
}
