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
      items: { name: string; filters: Record<string, unknown> }[];
      next_cursor: string | null;
    };
    expect(list.items.map((v) => v.name)).toEqual(["Approvals", "Failed today"]);
    expect(list.next_cursor).toBeNull();
    expect(list.items[1]?.filters).toEqual({ status: "failed", range: "7d" });

    expect((await save("", {})).statusCode).toBe(400);
    const id = failed.json().id as string;
    expect((await call(t.app, jar, "DELETE", `/v1/saved-views/${id}`)).statusCode).toBe(204);
    expect((await call(t.app, jar, "DELETE", `/v1/saved-views/${id}`)).statusCode).toBe(404);
    expect(
      ((await call(t.app, jar, "GET", "/v1/saved-views?scope=runs")).json() as { items: unknown[] })
        .items.length,
    ).toBe(1);
  });

  it("pages the list by name with a cursor", async () => {
    for (const name of ["Pager C", "Pager A", "Pager B"])
      await call(t.app, jar, "POST", "/v1/saved-views", { scope: "runs", name, filters: {} });
    type Page = { items: { name: string }[]; next_cursor: string | null };
    const first = (
      await call(t.app, jar, "GET", "/v1/saved-views?scope=runs&limit=2")
    ).json() as Page;
    expect(first.items.map((v) => v.name)).toEqual(["Approvals", "Pager A"]);
    expect(first.next_cursor).toEqual(expect.any(String));
    const rest = (
      await call(
        t.app,
        jar,
        "GET",
        `/v1/saved-views?scope=runs&limit=2&cursor=${first.next_cursor ?? ""}`,
      )
    ).json() as Page;
    expect(rest.items.map((v) => v.name)).toEqual(["Pager B", "Pager C"]);
    expect(rest.next_cursor).toBeNull();
    expect((await call(t.app, jar, "GET", "/v1/saved-views?scope=runs&limit=500")).statusCode).toBe(
      400,
    );
  });
});
