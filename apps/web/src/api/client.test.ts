import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, get } from "./client";

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
