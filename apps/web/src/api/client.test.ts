import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, get, setWorkspace, upload } from "./client";

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("a 401 on this computer", () => {
  it("signs in locally when there is no session to refresh, then retries", async () => {
    const calls: string[] = [];
    let signedIn = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string) => {
        calls.push(path);
        if (path === "/v1/auth/refresh") return Promise.resolve(json(401));
        if (path === "/v1/auth/local") {
          signedIn = true;
          return Promise.resolve(json(200));
        }
        return Promise.resolve(signedIn ? json(200, { ok: true }) : json(401));
      }),
    );
    await expect(get("/v1/me")).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["/v1/me", "/v1/auth/refresh", "/v1/auth/local", "/v1/me"]);
  });

  it("reports the 401 where local sign-in is off", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string) => Promise.resolve(json(path === "/v1/auth/local" ? 404 : 401))),
    );
    await expect(get("/v1/me")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("upload", () => {
  it("sends the file as the raw body with its type, name and the usual headers", async () => {
    setWorkspace("acme");
    const fetchMock = vi.fn((_path: string, _init?: RequestInit) =>
      Promise.resolve(json(201, { created: true })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = new Blob(["%PDF-1.7"], { type: "application/pdf" });
    await expect(
      upload("/v1/pageindex/sources/s1/documents", file, {
        contentType: "application/pdf",
        fileName: "Q3 report é.pdf",
      }),
    ).resolves.toEqual({ created: true });
    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe("/v1/pageindex/sources/s1/documents");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(file);
    expect(init?.headers).toEqual({
      "x-requested-with": "flowaid",
      "x-workspace": "acme",
      "content-type": "application/pdf",
      "x-file-name": "Q3%20report%20%C3%A9.pdf",
    });
    setWorkspace(null);
  });

  it("refreshes once on a 401 and resends the same file", async () => {
    // let an earlier test's single-flight refresh settle
    await new Promise((r) => setTimeout(r, 0));
    const calls: string[] = [];
    let refreshed = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string) => {
        calls.push(path);
        if (path === "/v1/auth/refresh") {
          refreshed = true;
          return Promise.resolve(json(200));
        }
        return Promise.resolve(refreshed ? json(200, { created: false }) : json(401));
      }),
    );
    const file = new Blob(["%PDF"], { type: "application/pdf" });
    await upload("/v1/x", file, { contentType: "application/pdf", fileName: "a.pdf" });
    expect(calls).toEqual(["/v1/x", "/v1/auth/refresh", "/v1/x"]);
  });
});
