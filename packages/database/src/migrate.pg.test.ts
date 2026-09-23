import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDatabase, describeDb, type TestDatabase } from "./test/pg.js";

describeDb("migrations", () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => {
    await t?.drop();
  });

  it("creates every table of the schema", async () => {
    const rows = await t.admin<{ n: number }[]>`
      select count(*)::int as n from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`;
    expect(rows[0]?.n).toBe(45);
  });
});
