import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { CredentialService } from "@flowaid/credentials";
import { PgVectorIndex, documents, knowledgeSources } from "@flowaid/database";
import { describeDb } from "@flowaid/database/testing";
import { fakeEmbeddingProvider } from "@flowaid/knowledge";
import { vectorIndexContract } from "@flowaid/knowledge/testing";
import { uuidv7 } from "@flowaid/shared";
import type { JsonObject, SafeFetch } from "@flowaid/workflow-core";
import { runIngestJob } from "./jobs/ingest.js";
import type { KnowledgeDeps } from "./services/knowledge.js";
import { createHarness, fakeTypesafeRegistry, type Harness } from "./test/setup.js";

const ref = (node: string, port: string, path?: string) => ({
  kind: "ref",
  ref: { kind: "port", node, port, ...(path ? { path } : {}) },
});

/** the typesafe fake plus the hashed bag-of-words embedding model as provider `fake` */
function registry(calls: string[][]) {
  const r = fakeTypesafeRegistry();
  r.register({
    id: "fake",
    kind: "embedding",
    create: () => fakeEmbeddingProvider({ calls }),
  } as never);
  return r;
}

const PIPELINE = {
  chunker: { strategy: "recursive", chunkTokens: 80, overlapTokens: 10 },
  embedding: { provider: "fake", model: "hashed-bow" },
};

describeDb("knowledge (Postgres + pgvector)", () => {
  let h: Harness;
  const calls: string[][] = [];
  let pages: Record<string, string> = {};
  const http: SafeFetch = (url) => {
    const body = pages[String(url)];
    return Promise.resolve(
      body === undefined
        ? new Response("missing", { status: 404 })
        : new Response(body, { status: 200, headers: { "content-type": "text/html" } }),
    );
  };
  let deps: KnowledgeDeps;

  beforeAll(async () => {
    h = await createHarness({ registry: registry(calls) });
    deps = {
      db: h.db.app,
      // sources without credentials never decrypt
      credentials: {} as CredentialService,
      registry: registry(calls),
      http,
      serverKeys: {},
    };
  });
  afterAll(() => h.close());

  async function source(kind: string, config: JsonObject = {}, pipeline: JsonObject = PIPELINE) {
    const id = uuidv7();
    await h.db.app.system((tx) =>
      tx.insert(knowledgeSources).values({
        id,
        workspaceId: h.workspaceId,
        name: `src-${id.slice(-8)}`,
        kind,
        config,
        pipeline,
      }),
    );
    return id;
  }

  const sourceRow = async (id: string) =>
    (
      await h.db.app.system((tx) =>
        tx.select().from(knowledgeSources).where(eq(knowledgeSources.id, id)),
      )
    )[0];
  const docRows = (sourceId: string) =>
    h.db.app.system((tx) => tx.select().from(documents).where(eq(documents.sourceId, sourceId)));

  describe("pgvector adapter", () => {
    vectorIndexContract("pgvector", () => new PgVectorIndex(h.db.app, h.workspaceId), {
      newId: uuidv7,
      prepare: async (sourceId, ids) => {
        await h.db.app.system(async (tx) => {
          await tx.insert(knowledgeSources).values({
            id: sourceId,
            workspaceId: h.workspaceId,
            name: `contract-${sourceId}`,
            kind: "files",
            config: {},
            pipeline: {},
          });
          for (const id of ids)
            await tx.insert(documents).values({
              id,
              workspaceId: h.workspaceId,
              sourceId,
              externalId: id,
              contentHash: "x",
            });
        });
      },
    });
  });

  it("indexes uploads idempotently: a re-run embeds nothing", async () => {
    const id = await source("files");
    await h.db.app.system((tx) =>
      tx.insert(documents).values([
        {
          id: uuidv7(),
          workspaceId: h.workspaceId,
          sourceId: id,
          externalId: "refunds.md",
          title: "Refunds",
          mimeType: "text/markdown",
          contentHash: "pending",
          content: "# Refunds\n\nRefunds go back to the original card within five business days.",
        },
        {
          id: uuidv7(),
          workspaceId: h.workspaceId,
          sourceId: id,
          externalId: "passwords.md",
          title: "Passwords",
          mimeType: "text/markdown",
          contentHash: "pending",
          content: "# Passwords\n\nReset a forgotten password from the sign-in page.",
        },
      ]),
    );
    const first = await runIngestJob(deps, id);
    expect(first).toMatchObject({ indexed: 2, unchanged: 0, deleted: 0, failed: [] });
    const row = await sourceRow(id);
    expect(row).toMatchObject({ status: "ready", lastError: null });
    expect(row?.stats).toMatchObject({ documents: 2, lastRun: { indexed: 2 } });
    const docs = await docRows(id);
    expect(docs.every((d) => d.status === "indexed" && d.chunkCount > 0)).toBe(true);
    const embedded = calls.length;
    const again = await runIngestJob(deps, id);
    expect(again).toMatchObject({ indexed: 0, deleted: 0, failed: [] });
    expect(calls.length).toBe(embedded);
    expect(await new PgVectorIndex(h.db.app, h.workspaceId).stats(id)).toMatchObject({
      chunks: 2,
    });
  });

  it("syncs a URL source: unchanged pages skipped, changed re-indexed, vanished deleted", async () => {
    pages = {
      "https://docs.example.com/a":
        "<html><head><title>A</title></head><body><h1>Alpha</h1><p>Alpha ships on Mondays.</p></body></html>",
      "https://docs.example.com/b":
        "<html><head><title>B</title></head><body><h1>Beta</h1><p>Beta ships on Fridays.</p></body></html>",
    };
    const id = await source("url", { urls: Object.keys(pages) });
    expect(await runIngestJob(deps, id)).toMatchObject({ indexed: 2, unchanged: 0 });
    expect(await runIngestJob(deps, id)).toMatchObject({ indexed: 0, unchanged: 2, deleted: 0 });
    expect((await docRows(id)).map((d) => d.title).sort()).toEqual(["A", "B"]);
    pages["https://docs.example.com/a"] =
      "<html><body><h1>Alpha</h1><p>Alpha now ships daily.</p></body></html>";
    await h.db.app.system((tx) =>
      tx
        .update(knowledgeSources)
        .set({ config: { urls: ["https://docs.example.com/a"] } })
        .where(eq(knowledgeSources.id, id)),
    );
    expect(await runIngestJob(deps, id)).toMatchObject({ indexed: 1, unchanged: 0, deleted: 1 });
    expect((await docRows(id)).map((d) => d.externalId)).toEqual(["https://docs.example.com/a"]);
    // an unreachable page fails its document, not the whole sync
    await h.db.app.system((tx) =>
      tx
        .update(knowledgeSources)
        .set({ config: { urls: ["https://docs.example.com/a", "https://docs.example.com/gone"] } })
        .where(eq(knowledgeSources.id, id)),
    );
    const r = await runIngestJob(deps, id);
    expect(r?.failed.map((f) => f.externalId)).toEqual(["https://docs.example.com/gone"]);
    const row = await sourceRow(id);
    expect(row?.status).toBe("ready");
    expect(row?.lastError).toContain("1 document failed");
  });

  it("consumes ingest jobs and serves ctx.knowledge to retrieval nodes in a run", async () => {
    const id = await source("text");
    await h.db.app.system((tx) =>
      tx.insert(documents).values({
        id: uuidv7(),
        workspaceId: h.workspaceId,
        sourceId: id,
        externalId: "shipping.md",
        title: "Shipping",
        uri: "https://help.example.com/shipping",
        contentHash: "pending",
        content: "Orders ship within two days. International shipping takes a week.",
      }),
    );
    await h.queue.enqueue("ingest", { type: "ingest.source", sourceId: id });
    for (let i = 0; i < 200 && (await sourceRow(id))?.status !== "ready"; i++)
      await new Promise((r) => setTimeout(r, 50));
    expect((await sourceRow(id))?.status).toBe("ready");

    const { workflowId, versionId } = await h.deploy("Ask", {
      inputs: {
        type: "object",
        properties: { question: { type: "string" } },
        required: ["question"],
      },
      outputs: { type: "object", properties: { context: {}, found: {}, top: {} } },
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        {
          id: "kb",
          kind: "task",
          type: "flowaid.retrieval.knowledge_base",
          typeVersion: "1.0.0",
          name: "Knowledge",
          config: { sourceIds: [id], k: 3 },
          inputs: { query: ref("start", "question") },
        },
        {
          id: "done",
          kind: "output",
          name: "Done",
          value: {
            kind: "object",
            fields: {
              context: ref("kb", "context"),
              found: ref("kb", "found"),
              top: ref("kb", "citations", "/0/title"),
            },
          },
        },
      ],
    });
    const runId = await h.start(workflowId, versionId, {
      question: "how long does international shipping take",
    });
    const run = await h.waitFor(runId, ["completed", "failed"]);
    expect(run.error).toBeNull();
    expect(run.output).toMatchObject({ found: true, top: "Shipping" });
    expect((run.output as JsonObject).context as string).toContain(
      "International shipping takes a week.",
    );
  });
});
