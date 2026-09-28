// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UNVERIFIED_CLIENT_HEADER,
  forwardedRequestHeaders,
  proxy,
  responseHeaders,
  webBindIsLoopback,
} from "./proxy";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("API proxy", () => {
  it("drops hop-by-hop headers and keeps the client's forwarding chain", () => {
    const req = new Request("https://app.example.com/v1/me", {
      headers: {
        connection: "keep-alive",
        cookie: "fa_session=x",
        "x-forwarded-for": "203.0.113.9",
        host: "app.example.com",
      },
    });
    const h = forwardedRequestHeaders(req);
    expect(h.get("connection")).toBeNull();
    expect(h.get("cookie")).toBe("fa_session=x");
    expect(h.get("x-forwarded-for")).toBe("203.0.113.9");
    expect(h.get("x-forwarded-proto")).toBe("https");
    expect(h.get("x-forwarded-host")).toBe("app.example.com");
  });

  it("replaces client-supplied forwarding headers with its own", () => {
    const req = new Request("http://flowaid.localhost:3001/v1/auth/local", {
      method: "POST",
      headers: {
        host: "192.168.1.5:3001",
        "x-forwarded-host": "localhost",
        "x-forwarded-proto": "https",
        "x-forwarded-port": "443",
        forwarded: "for=127.0.0.1;host=localhost",
        "x-real-ip": "127.0.0.1",
        "x-flowaid-client-unverified": "0",
      },
    });
    vi.stubEnv("HOSTNAME", "127.0.0.1");
    const h = forwardedRequestHeaders(req);
    expect(h.get("x-forwarded-host")).toBe("192.168.1.5:3001");
    expect(h.get("x-forwarded-proto")).toBe("http");
    expect(h.get("x-forwarded-port")).toBeNull();
    expect(h.get("forwarded")).toBeNull();
    expect(h.get("x-real-ip")).toBeNull();
    expect(h.get(UNVERIFIED_CLIENT_HEADER)).toBeNull();
  });

  it("marks the forwarding chain unverified when the web server listens beyond loopback", () => {
    // a LAN client posing as this computer: Next keeps its X-Forwarded-For as sent
    const req = new Request("http://localhost:3001/v1/auth/local", {
      method: "POST",
      headers: { host: "localhost:3001", "x-forwarded-for": "127.0.0.1" },
    });
    vi.stubEnv("HOSTNAME", "0.0.0.0");
    expect(forwardedRequestHeaders(req).get(UNVERIFIED_CLIENT_HEADER)).toBe("1");
    vi.stubEnv("HOSTNAME", "127.0.0.1");
    expect(forwardedRequestHeaders(req).get(UNVERIFIED_CLIENT_HEADER)).toBeNull();
    expect(webBindIsLoopback("::1")).toBe(true);
    expect(webBindIsLoopback("[::]")).toBe(false);
    expect(webBindIsLoopback("192.168.1.5")).toBe(false);
  });

  it("keeps every Set-Cookie and drops content-encoding", () => {
    const upstream = new Response("{}", {
      headers: [
        ["set-cookie", "a=1; Path=/"],
        ["set-cookie", "b=2; Path=/v1/auth"],
        ["content-encoding", "gzip"],
        ["content-type", "application/json"],
      ],
    });
    const h = responseHeaders(upstream);
    expect(h.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/v1/auth"]);
    expect(h.get("content-encoding")).toBeNull();
    expect(h.get("content-type")).toBe("application/json");
  });

  it("forwards method, path, query and body to FLOWAID_API_INTERNAL_URL at request time", async () => {
    vi.stubEnv("FLOWAID_API_INTERNAL_URL", "http://api:3000/");
    const fetchMock = vi.fn(() => Promise.resolve(new Response("created", { status: 201 })));
    vi.stubGlobal("fetch", fetchMock);
    const res = await proxy(
      new Request("http://web/v1/workflows?x=1", {
        method: "POST",
        body: '{"name":"a"}',
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(201);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api:3000/v1/workflows?x=1");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
  });

  it("answers 503 with the error envelope when the API is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("fetch failed"))),
    );
    const res = await proxy(new Request("http://web/v1/me"));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "SERVICE_UNAVAILABLE",
    );
  });
});
