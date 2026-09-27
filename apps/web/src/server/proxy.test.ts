// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { forwardedRequestHeaders, proxy, responseHeaders } from "./proxy";

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
