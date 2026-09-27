import { describe, expect, it } from "vitest";
import { AuthService } from "./auth/service.js";
import { JwtKeys } from "./auth/jwt.js";
import { defaultConfig } from "./context.js";
import { buildServer } from "./server.js";

/** Route registration contract, checked without a database. */
describe("route registration guard", () => {
  const ctx = async () => {
    const keys = (await JwtKeys.generate()).keys;
    const db = {
      system: () => Promise.reject(new Error("no db")),
      tenant: () => Promise.reject(new Error("no db")),
      sql: Object.assign(() => Promise.reject(new Error("no db")), {}),
    } as never;
    return {
      config: defaultConfig(),
      db,
      keys,
      auth: new AuthService(db, keys),
      clock: { now: () => Date.now() },
      queue: {} as never,
      hub: {} as never,
      credentials: {} as never,
      http: {} as never,
    };
  };

  it("rejects a /v1 route without auth, without a CLI verb, or a mutation without audit", async () => {
    await expect(
      buildServer(await ctx(), { routes: [(app) => void app.get("/v1/x", () => ({}))] }),
    ).rejects.toThrow(/config.auth/);
    await expect(
      buildServer(await ctx(), {
        routes: [(app) => void app.get("/v1/x", { config: { auth: "public" } }, () => ({}))],
      }),
    ).rejects.toThrow(/config.cli/);
    await expect(
      buildServer(await ctx(), {
        routes: [
          (app) =>
            void app.post(
              "/v1/x",
              { config: { auth: "public", cli: { noun: "x", verb: "y" } } },
              () => ({}),
            ),
        ],
      }),
    ).rejects.toThrow(/config.audit/);
  });

  it("serves health, the error envelope and request ids", async () => {
    const app = await buildServer(await ctx());
    const h = await app.inject({
      method: "GET",
      url: "/v1/health",
      headers: { "x-request-id": "req-12345678" },
    });
    expect(h.json()).toMatchObject({ status: "ok" });
    expect(h.headers["x-request-id"]).toBe("req-12345678");
    const nf = await app.inject({ method: "GET", url: "/v1/nope" });
    expect(nf.statusCode).toBe(404);
    expect(nf.json()).toMatchObject({
      error: { code: "NOT_FOUND", retryable: false, request_id: expect.any(String) },
    });
    const unauth = await app.inject({ method: "GET", url: "/v1/environments" });
    expect(unauth.statusCode).toBe(401);
    expect(unauth.json().error.code).toBe("UNAUTHORIZED");
    const badKey = await app.inject({
      method: "GET",
      url: "/v1/environments",
      headers: { authorization: "Bearer fa_live_00000000000000000000000000000000_000000" },
    });
    expect(badKey.json().error.message).toMatch(/malformed/);
    const bad = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "nope" },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatchObject({
      code: "BAD_REQUEST",
      details: { issues: expect.any(Array) },
    });
    await app.close();
  });

  it("publishes OpenAPI 3.1 with x-cli on every operation", async () => {
    const app = await buildServer(await ctx());
    const doc = (await app.inject({ method: "GET", url: "/v1/openapi.json" })).json();
    expect(doc.openapi).toBe("3.1.0");
    const ops = Object.entries(
      doc.paths as Record<string, Record<string, Record<string, unknown>>>,
    ).flatMap(([path, methods]) => Object.entries(methods).map(([m, op]) => ({ path, m, op })));
    expect(ops.length).toBeGreaterThan(20);
    for (const { path, m, op } of ops) expect(op["x-cli"], `${m} ${path}`).toBeDefined();
    expect(
      (await app.inject({ method: "GET", url: "/.well-known/jwks.json" })).json().keys[0],
    ).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256" });
    await app.close();
  });
});
