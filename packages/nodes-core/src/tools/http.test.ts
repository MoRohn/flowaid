import { describe, expect, it } from "vitest";
import { runNode } from "@flowaid/node-sdk/testing";
import type { JsonValue } from "@flowaid/workflow-core";
import { httpNode } from "./http.js";

function recordingFetch(respond: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit; headers: Headers }[] = [];
  const http = (url: string, init: RequestInit = {}) => {
    calls.push({ url, init, headers: new Headers(init.headers) });
    return Promise.resolve(respond(url, init));
  };
  return { http, calls };
}

describe("flowaid.tools.http", () => {
  it("GETs with query params and parses JSON", async () => {
    const { http, calls } = recordingFetch(() =>
      Response.json({ items: [1, 2] }, { headers: { "x-total": "2" } }),
    );
    const r = await runNode(httpNode, {
      config: { method: "GET", url: "https://api.example.com/items", query: { page: "2" } },
      http,
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      output: { status: 200, body: { items: [1, 2] }, headers: { "x-total": "2" } },
    });
    expect(calls[0]?.url).toBe("https://api.example.com/items?page=2");
  });

  it("sends a JSON body and applies bearer auth", async () => {
    const { http, calls } = recordingFetch(() => new Response(null, { status: 204 }));
    const r = await runNode(httpNode, {
      config: { method: "POST", url: "https://api.example.com/items", body: { a: 1 } },
      credentials: { auth: { token: "t0k" } },
      http,
    });
    expect(r.result).toMatchObject({ kind: "ok", output: { status: 204, body: null } });
    expect(calls[0]?.init.body).toBe('{"a":1}');
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer t0k");
    expect(calls[0]?.headers.get("content-type")).toBe("application/json");
  });

  it("forwards the idempotency key on keyed methods only", async () => {
    const { http, calls } = recordingFetch(() => Response.json({}));
    await runNode(httpNode, {
      config: { method: "PUT", url: "https://x.test/a", body: {} },
      node: { idempotency: "keyed", idempotencyKey: "idem-1" },
      http,
    });
    await runNode(httpNode, {
      config: { method: "POST", url: "https://x.test/a" },
      node: { idempotency: "none", idempotencyKey: null },
      http,
    });
    expect(calls[0]?.headers.get("idempotency-key")).toBe("idem-1");
    expect(calls[1]?.headers.has("idempotency-key")).toBe(false);
  });

  it("applies api-key (query) and basic credentials", async () => {
    const { http, calls } = recordingFetch(() => Response.json({}));
    await runNode(httpNode, {
      config: { method: "GET", url: "https://x.test/a" },
      credentials: { auth: { key: "k", in: "query", name: "api_key" } },
      http,
    });
    await runNode(httpNode, {
      config: { method: "GET", url: "https://x.test/a" },
      credentials: { auth: { username: "u", password: "p" } },
      http,
    });
    expect(calls[0]?.url).toBe("https://x.test/a?api_key=k");
    expect(calls[1]?.headers.get("authorization")).toBe(
      `Basic ${Buffer.from("u:p").toString("base64")}`,
    );
  });

  it("maps ≥ 400 to TOOL_EXECUTION_ERROR, retryable for 429/5xx only", async () => {
    const retry = await runNode(httpNode, {
      config: { method: "GET", url: "https://x.test/a" },
      http: recordingFetch(() => new Response("slow down", { status: 429 })).http,
    });
    expect(retry.result).toMatchObject({
      kind: "error",
      error: { code: "TOOL_EXECUTION_ERROR", retryable: true },
    });
    const final = await runNode(httpNode, {
      config: { method: "GET", url: "https://x.test/a" },
      http: recordingFetch(() => Response.json({ e: 1 }, { status: 404 })).http,
    });
    expect(final.result).toMatchObject({
      kind: "error",
      error: { code: "TOOL_EXECUTION_ERROR", retryable: false },
    });
  });

  it("refuses transport headers, CR/LF values and non-http schemes", async () => {
    const { http } = recordingFetch(() => Response.json({}));
    for (const config of <JsonValue[]>[
      { method: "GET", url: "https://x.test", headers: { Host: "evil" } },
      { method: "GET", url: "https://x.test", headers: { "X-A": "a\r\nB: c" } },
      { method: "GET", url: "file:///etc/passwd" },
    ]) {
      const r = await runNode(httpNode, { config, http });
      expect(r.result.kind).toBe("error");
    }
  });

  it("stores binary responses as artifacts", async () => {
    const { http } = recordingFetch(
      () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }),
    );
    const r = await runNode(httpNode, {
      config: { method: "GET", url: "https://x.test/logo.png", responseType: "binary" },
      http,
    });
    expect(r.result.kind === "ok" && (r.result.output as { body: unknown }).body).toMatchObject({
      $artifact: expect.any(String),
    });
    expect([...r.recorder.artifacts.values()][0]).toMatchObject({
      name: "logo.png",
      mimeType: "image/png",
    });
  });
});
