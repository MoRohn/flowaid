import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

describeDb("API keys pinned to an environment stay in it (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  let envs: Record<string, string>;
  let workflowId: string;
  let versionId: string;
  let key: string;
  beforeAll(async () => {
    t = await createTestApp();
    jar = await login(t.app);
    envs = Object.fromEntries(
      (
        (await call(t.app, jar, "GET", "/v1/environments")).json() as { id: string; name: string }[]
      ).map((e) => [e.name, e.id]),
    );
    workflowId = (await call(t.app, jar, "POST", "/v1/workflows", { name: "Pinned" })).json()
      .id as string;
    versionId = (await call(t.app, jar, "POST", `/v1/workflows/${workflowId}/publish`, {})).json()
      .id as string;
    await call(t.app, jar, "PUT", `/v1/workflows/${workflowId}/deployments/${envs.dev as string}`, {
      versionId,
    });
    key = (
      await call(t.app, jar, "POST", "/v1/api-keys", {
        name: "staging-deployer",
        scopes: [
          "workflows:read",
          "workflows:publish",
          "secrets:bind",
          "credentials:read",
          "credentials:write",
          "runs:read",
        ],
        environmentId: envs.staging,
      })
    ).json().key as string;
  });
  afterAll(() => t.close());
  const asKey = (method: string, url: string, payload?: unknown) =>
    call(t.app, null, method, url, payload, { authorization: `Bearer ${key}` });

  it("deploys, rolls back and publishes only to its own environment", async () => {
    const dev = envs.dev as string;
    const staging = envs.staging as string;
    expect(
      (await asKey("PUT", `/v1/workflows/${workflowId}/deployments/${dev}`, { versionId }))
        .statusCode,
    ).toBe(403);
    expect(
      (await asKey("POST", `/v1/workflows/${workflowId}/deployments/${dev}/rollback`, {}))
        .statusCode,
    ).toBe(403);
    expect(
      (await asKey("POST", `/v1/workflows/${workflowId}/publish`, { deployTo: [dev] })).statusCode,
    ).toBe(403);
    expect(
      (await asKey("PUT", `/v1/workflows/${workflowId}/deployments/${staging}`, { versionId }))
        .statusCode,
    ).toBe(200);
    const listed = (await asKey("GET", `/v1/workflows/${workflowId}/deployments`)).json() as {
      environmentId: string;
    }[];
    expect(listed.map((d) => d.environmentId)).toEqual([staging]);
  });

  it("binds and reads secrets only in its own environment", async () => {
    const dev = envs.dev as string;
    expect((await asKey("GET", `/v1/workflows/${workflowId}/secrets/${dev}`)).statusCode).toBe(403);
    expect((await asKey("PUT", `/v1/workflows/${workflowId}/secrets/${dev}`, {})).statusCode).toBe(
      403,
    );
    expect(
      (await asKey("PUT", `/v1/workflows/${workflowId}/secrets/${envs.staging as string}`, {}))
        .statusCode,
    ).toBe(200);
  });

  it("sees its environment's and shared credentials, and changes only its own", async () => {
    const create = (name: string, environmentId?: string) =>
      call(t.app, jar, "POST", "/v1/credentials", {
        name,
        type: "http.bearer",
        values: { token: "sk-live-1234567890abcdef" },
        ...(environmentId ? { environmentId } : {}),
      });
    const devCred = (await create("dev-only", envs.dev)).json().id as string;
    const shared = (await create("shared")).json().id as string;
    const names = ((await asKey("GET", "/v1/credentials")).json() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(names).toContain("shared");
    expect(names).not.toContain("dev-only");
    expect(
      (await asKey("GET", `/v1/credentials?environmentId=${envs.dev as string}`)).statusCode,
    ).toBe(403);
    expect((await asKey("GET", `/v1/credentials/${devCred}`)).statusCode).toBe(404);
    expect((await asKey("GET", `/v1/credentials/${shared}`)).statusCode).toBe(200);
    expect(
      (await asKey("PATCH", `/v1/credentials/${shared}`, { name: "renamed" })).statusCode,
    ).toBe(403);
    expect((await asKey("DELETE", `/v1/credentials/${shared}`)).statusCode).toBe(403);
    const own = await asKey("POST", "/v1/credentials", {
      name: "staging-own",
      type: "http.bearer",
      values: { token: "sk-live-abcdef1234567890" },
    });
    expect(own.statusCode).toBe(201);
    expect(own.json().environmentId).toBe(envs.staging);
    expect(
      (
        await asKey("POST", "/v1/credentials", {
          name: "elsewhere",
          type: "http.bearer",
          values: { token: "sk-live-abcdef1234567890" },
          environmentId: envs.dev,
        })
      ).statusCode,
    ).toBe(403);
  });

  it("lists runs only in its own environment", async () => {
    expect((await asKey("GET", `/v1/runs?environmentId=${envs.dev as string}`)).statusCode).toBe(
      403,
    );
    expect((await asKey("GET", "/v1/runs")).statusCode).toBe(200);
  });
});
