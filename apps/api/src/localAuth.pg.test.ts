import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { Jar, createTestApp, type TestApp } from "./test/app.js";

describeDb("local mode: no sign-in on this computer (Postgres)", () => {
  let local: TestApp;
  let password: TestApp;
  beforeAll(async () => {
    local = await createTestApp({ authMode: "local" });
    password = await createTestApp({ authMode: "password" });
  });
  afterAll(async () => {
    await local.close();
    await password.close();
  });
  const signIn = (t: TestApp, headers: Record<string, string>, remoteAddress = "127.0.0.1") =>
    t.app.inject({ method: "POST", url: "/v1/auth/local", headers, remoteAddress });

  it("signs this computer in as the owner and reports the mode", async () => {
    const res = await signIn(local, { "x-requested-with": "flowaid", host: "localhost:3000" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      user: { email: expect.any(String) },
      mustChangePassword: false,
    });
    const jar = new Jar();
    jar.take(res);
    const me = await local.app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { cookie: jar.header("/v1/me") },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ authMode: "local", workspaces: [{ slug: "default" }] });
  });

  it("refuses other computers and rebinding hosts", async () => {
    expect(
      (await signIn(local, { "x-requested-with": "flowaid", host: "localhost" }, "192.168.1.20"))
        .statusCode,
    ).toBe(403);
    expect(
      (await signIn(local, { "x-requested-with": "flowaid", host: "rebind.evil.example" }))
        .statusCode,
    ).toBe(403);
    expect((await signIn(local, { host: "localhost" })).statusCode).toBe(403);
  });

  it("does not exist in password mode", async () => {
    const res = await signIn(password, { "x-requested-with": "flowaid", host: "localhost" });
    expect(res.statusCode).toBe(404);
  });
});
