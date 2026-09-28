import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

describeDb("saved views (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  beforeAll(async () => {
    t = await createTestApp();
    jar = await login(t.app);
  });
  afterAll(() => t.close());

  it("saves, replaces by name, lists and deletes a person's views", async () => {
    const save = (name: string, filters: Record<string, unknown>) =>
      call(t.app, jar, "POST", "/v1/saved-views", { scope: "runs", name, filters });
    const failed = await save("Failed today", { status: "failed", range: "24h" });
    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toMatchObject({ scope: "runs", name: "Failed today" });
    await save("Approvals", { status: "waiting_for_human" });
    // same name: replaced, not duplicated
    const again = await save("Failed today", { status: "failed", range: "7d" });
    expect(again.json().id).toBe(failed.json().id);

    const list = (await call(t.app, jar, "GET", "/v1/saved-views?scope=runs")).json() as {
      name: string;
      filters: Record<string, unknown>;
    }[];
    expect(list.map((v) => v.name)).toEqual(["Approvals", "Failed today"]);
    expect(list[1]?.filters).toEqual({ status: "failed", range: "7d" });

    expect((await save("", {})).statusCode).toBe(400);
    const id = failed.json().id as string;
    expect((await call(t.app, jar, "DELETE", `/v1/saved-views/${id}`)).statusCode).toBe(204);
    expect((await call(t.app, jar, "DELETE", `/v1/saved-views/${id}`)).statusCode).toBe(404);
    expect(
      ((await call(t.app, jar, "GET", "/v1/saved-views?scope=runs")).json() as unknown[]).length,
    ).toBe(1);
  });
});
