import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { plugins, templates } from "@flowaid/database";
import { createTestDatabase, describeDb, type TestDatabase } from "@flowaid/database/testing";
import { loadBundledPlugins } from "./bundled.js";

describeDb("bundled plugins are recorded in the plugins table (Postgres)", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => {
    await db.drop();
  });

  it("upserts one global bundled row, keeps an admin's disabled status and then skips loading", async () => {
    const first = await loadBundledPlugins(["@flowaid/nodes-langchain"], { db: db.app });
    expect(first.packages).toHaveLength(1);
    const rows = await db.app.system((tx) =>
      tx.select().from(plugins).where(eq(plugins.packageName, "@flowaid/nodes-langchain")),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspaceId: null,
      source: "bundled",
      status: "enabled",
      version: "0.1.0",
      integrity: "0.1.0",
    });
    expect(rows[0]?.manifests.map((m) => m.id)).toContain("@flowaid/nodes-langchain.retriever");
    // its template is a global built-in, once, however often the worker boots
    const seeded = await db.app.system((tx) =>
      tx.select().from(templates).where(eq(templates.slug, "knowledge-assistant-langchain-rag")),
    );
    expect(seeded).toHaveLength(1);
    expect(seeded[0]).toMatchObject({ workspaceId: null, category: "knowledge" });

    // Boot again: still one row. Then an administrator disables it; the next boot respects that.
    await loadBundledPlugins(["@flowaid/nodes-langchain"], { db: db.app });
    await db.app.system((tx) =>
      tx
        .update(plugins)
        .set({ status: "disabled" })
        .where(eq(plugins.packageName, "@flowaid/nodes-langchain")),
    );
    const disabled = await loadBundledPlugins(["@flowaid/nodes-langchain"], { db: db.app });
    expect(disabled.packages).toHaveLength(0);
    expect(disabled.skipped).toEqual([
      { name: "@flowaid/nodes-langchain", reason: "plugin row is disabled" },
    ]);
    const after = await db.app.system((tx) => tx.select().from(plugins));
    expect(after).toHaveLength(1);
    const templateRows = await db.app.system((tx) =>
      tx.select().from(templates).where(eq(templates.slug, "knowledge-assistant-langchain-rag")),
    );
    expect(templateRows).toHaveLength(1);
  });
});
