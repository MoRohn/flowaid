import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { describeDb } from "@flowaid/database/testing";
import { fakeEmbeddingProvider } from "@flowaid/knowledge";
import { DefaultModelCatalog, ProviderRegistry } from "@flowaid/providers";
import { knowledgeServiceFor } from "./services/knowledge.js";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

describeDb("knowledge routes (Postgres + pgvector)", () => {
  let t: TestApp;
  let jar: Jar;
  let workspaceId: string;

  beforeAll(async () => {
    t = await createTestApp();
    const registry = new ProviderRegistry({ catalog: new DefaultModelCatalog() });
    registry.register({ id: "fake", kind: "embedding", create: () => fakeEmbeddingProvider() });
    t.ctx.providers = registry;
    jar = await login(t.app);
    workspaceId = (await call(t.app, jar, "GET", "/v1/me")).json().workspaces[0].id as string;
  });
  afterAll(() => t.close());

  const queued = async (sourceId: string) =>
    (
      await t.db.app.system((tx) =>
        tx.execute<{ n: number }>(
          sql`select count(*)::int as n from queue_jobs where queue = 'ingest' and payload->>'sourceId' = ${sourceId}`,
        ),
      )
    )[0]?.n ?? 0;

  it("turns the knowledge feature on", async () => {
    expect((await call(t.app, jar, "GET", "/v1/me")).json().features.knowledge).toBe(true);
  });

  it("creates sources, uploads, lists, queries, reconfigures and deletes", async () => {
    const bad = await call(t.app, jar, "POST", "/v1/knowledge/sources", {
      name: "Site",
      kind: "sitemap",
    });
    expect(bad.statusCode).toBe(400);

    const site = await call(t.app, jar, "POST", "/v1/knowledge/sources", {
      name: "Docs site",
      kind: "url",
      config: { url: "https://docs.example.com/" },
      pipeline: { embedding: { provider: "fake", model: "hashed-bow" } },
    });
    expect(site.statusCode).toBe(201);
    // remote kinds start syncing on create
    expect(await queued(site.json().id as string)).toBe(1);
    const noUpload = await call(
      t.app,
      jar,
      "POST",
      `/v1/knowledge/sources/${site.json().id as string}/documents`,
      { documents: [{ title: "x", text: "y" }] },
    );
    expect(noUpload.statusCode).toBe(400);

    const created = await call(t.app, jar, "POST", "/v1/knowledge/sources", {
      name: "Help center",
      kind: "files",
      pipeline: {
        chunker: { strategy: "markdown", chunkTokens: 60, overlapTokens: 5 },
        embedding: { provider: "fake", model: "hashed-bow" },
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(created.json()).toMatchObject({ kind: "files", status: "new", documents: 0 });
    expect(
      (
        await call(t.app, jar, "POST", "/v1/knowledge/sources", {
          name: "Help center",
          kind: "text",
        })
      ).statusCode,
    ).toBe(409);

    const up = await call(t.app, jar, "POST", `/v1/knowledge/sources/${id}/documents`, {
      documents: [
        {
          externalId: "refunds.md",
          title: "Refunds",
          mimeType: "text/markdown",
          text: "# Refunds\n\nRefunds go back to the original card within five business days.",
        },
        {
          externalId: "passwords.md",
          title: "Passwords",
          mimeType: "text/markdown",
          text: "# Passwords\n\nReset a forgotten password from the sign-in page.",
        },
      ],
    });
    expect(up.statusCode).toBe(202);
    expect(up.json().documents).toHaveLength(2);
    expect(await queued(id)).toBe(1);

    // what the worker's ingest.source job does for uploads
    const service = knowledgeServiceFor(t.ctx, workspaceId);
    for (const d of [
      {
        externalId: "refunds.md",
        title: "Refunds",
        text: "# Refunds\n\nRefunds go back to the original card within five business days.",
      },
      {
        externalId: "passwords.md",
        title: "Passwords",
        text: "# Passwords\n\nReset a forgotten password from the sign-in page.",
      },
    ])
      await service.upsertDocument(
        { sourceId: id, mimeType: "text/markdown", ...d },
        { keepContent: true },
      );

    const list = (await call(t.app, jar, "GET", "/v1/knowledge/sources")).json().items as {
      id: string;
      documents: number;
      chunks: number;
    }[];
    expect(list.find((s) => s.id === id)).toMatchObject({ documents: 2, chunks: 2 });

    const docs = await call(t.app, jar, "GET", `/v1/knowledge/sources/${id}/documents?limit=1`);
    expect(docs.json().items).toHaveLength(1);
    expect(docs.json().next_cursor).toBeTruthy();
    const rest = await call(
      t.app,
      jar,
      "GET",
      `/v1/knowledge/sources/${id}/documents?limit=1&cursor=${docs.json().next_cursor as string}`,
    );
    const all = [...docs.json().items, ...rest.json().items] as {
      id: string;
      externalId: string;
      status: string;
    }[];
    expect(all.map((d) => d.externalId).sort()).toEqual(["passwords.md", "refunds.md"]);
    expect(all.every((d) => d.status === "indexed")).toBe(true);

    const refunds = all.find((d) => d.externalId === "refunds.md");
    const chunks = await call(t.app, jar, "GET", `/v1/knowledge/documents/${refunds?.id}/chunks`);
    expect(chunks.json()).toEqual([
      expect.objectContaining({
        ordinal: 0,
        embedded: true,
        metadata: expect.objectContaining({ heading: "Refunds" }),
      }),
    ]);

    for (const mode of ["hybrid", "vector", "keyword"]) {
      const q = await call(t.app, jar, "POST", `/v1/knowledge/sources/${id}/query`, {
        text: "how do refunds reach my card",
        topK: 1,
        mode,
      });
      expect(q.statusCode).toBe(200);
      expect(q.json()).toMatchObject({ mode, hits: [{ title: "Refunds", sourceId: id }] });
    }

    // a pipeline change marks every document for re-indexing and queues a sync
    const patched = await call(t.app, jar, "PATCH", `/v1/knowledge/sources/${id}`, {
      pipeline: {
        chunker: { chunkTokens: 200 },
        embedding: { provider: "fake", model: "hashed-bow" },
      },
    });
    expect(patched.json()).toMatchObject({ status: "stale" });
    expect(await queued(id)).toBe(2);
    const pending = await call(t.app, jar, "GET", `/v1/knowledge/sources/${id}/documents`);
    expect(
      (pending.json().items as { status: string }[]).every((d) => d.status === "pending"),
    ).toBe(true);

    expect(
      (await call(t.app, jar, "DELETE", `/v1/knowledge/documents/${refunds?.id}`)).statusCode,
    ).toBe(204);
    const after = (await call(t.app, jar, "GET", `/v1/knowledge/sources/${id}`)).json();
    expect(after.documents).toBe(1);

    expect((await call(t.app, jar, "POST", `/v1/knowledge/sources/${id}/sync`)).statusCode).toBe(
      202,
    );
    expect((await call(t.app, jar, "DELETE", `/v1/knowledge/sources/${id}`)).statusCode).toBe(204);
    expect((await call(t.app, jar, "GET", `/v1/knowledge/sources/${id}`)).statusCode).toBe(404);
    const left = await t.db.app.system((tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from chunks where source_id = ${id}`),
    );
    expect(left[0]?.n).toBe(0);
  });

  it("pages the sources by name with a cursor", async () => {
    for (const name of ["Pager C", "Pager A", "Pager B"])
      expect(
        (
          await call(t.app, jar, "POST", "/v1/knowledge/sources", {
            name,
            kind: "files",
            pipeline: { embedding: { provider: "fake", model: "hashed-bow" } },
          })
        ).statusCode,
      ).toBe(201);
    type Page = { items: { name: string; documents: number }[]; next_cursor: string | null };
    const first = (await call(t.app, jar, "GET", "/v1/knowledge/sources?limit=2")).json() as Page;
    expect(first.next_cursor).toEqual(expect.any(String));
    const all = [...first.items];
    for (let cursor = first.next_cursor; cursor;) {
      const next = (
        await call(t.app, jar, "GET", `/v1/knowledge/sources?limit=2&cursor=${cursor}`)
      ).json() as Page;
      all.push(...next.items);
      cursor = next.next_cursor;
    }
    expect(all.map((s) => s.name).filter((n) => n.startsWith("Pager"))).toEqual([
      "Pager A",
      "Pager B",
      "Pager C",
    ]);
    expect(all.find((s) => s.name === "Pager A")).toMatchObject({ documents: 0 });
    expect((await call(t.app, jar, "GET", "/v1/knowledge/sources?limit=500")).statusCode).toBe(400);
  });
});
