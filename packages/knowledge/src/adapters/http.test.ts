import { describe, expect, it } from "vitest";
import type { IndexedChunk, SafeFetch } from "@flowaid/workflow-core";
import { REMOTE_INDEX_KINDS, remoteIndex, type RemoteIndexKind } from "./http.js";

interface Call {
  method: string;
  url: string;
  body: string;
}

/** Records requests and answers each with the first matching canned response. */
function recorder(answers: { match: RegExp; body: unknown; status?: number }[]) {
  const calls: Call[] = [];
  const fetch: SafeFetch = (url, init) => {
    calls.push({
      method: init?.method ?? "GET",
      url,
      body: typeof init?.body === "string" ? init.body : "",
    });
    const a = answers.find((x) => x.match.test(`${init?.method ?? "GET"} ${url}`));
    return Promise.resolve(
      new Response(JSON.stringify(a?.body ?? {}), { status: a?.status ?? 200 }),
    );
  };
  return { fetch, calls };
}

const chunk: IndexedChunk = {
  id: "0199a1b2-0000-7000-8000-000000000001",
  documentId: "doc-1",
  ordinal: 0,
  content: "Refunds take five days.",
  tokens: 6,
  metadata: { lang: "en" },
  embedding: [0.1, 0.2, 0.3],
};

const SEARCH_ANSWERS: Record<RemoteIndexKind, unknown> = {
  qdrant: {
    result: [
      {
        id: chunk.id,
        score: 0.9,
        payload: {
          documentId: "doc-1",
          ordinal: 0,
          content: chunk.content,
          metadata: { lang: "en" },
        },
      },
    ],
  },
  pinecone: {
    matches: [
      {
        id: chunk.id,
        score: 0.9,
        metadata: {
          documentId: "doc-1",
          ordinal: 0,
          content: chunk.content,
          metadata: '{"lang":"en"}',
        },
      },
    ],
  },
  weaviate: {
    data: {
      Get: {
        Chunks: [
          {
            documentId: "doc-1",
            ordinal: 0,
            content: chunk.content,
            metadata: '{"lang":"en"}',
            _additional: { id: chunk.id, distance: 0.1 },
          },
        ],
      },
    },
  },
  milvus: {
    code: 0,
    data: [
      {
        id: chunk.id,
        distance: 0.9,
        documentId: "doc-1",
        ordinal: 0,
        content: chunk.content,
        metadata: { lang: "en" },
      },
    ],
  },
  chroma: {
    id: "coll-1",
    ids: [[chunk.id]],
    documents: [[chunk.content]],
    metadatas: [[{ documentId: "doc-1", ordinal: 0, metadata: '{"lang":"en"}' }]],
    distances: [[0.1]],
  },
  elasticsearch: {
    hits: {
      hits: [
        {
          _id: chunk.id,
          _score: 0.9,
          _source: {
            documentId: "doc-1",
            ordinal: 0,
            content: chunk.content,
            metadata: { lang: "en" },
          },
        },
      ],
    },
  },
  opensearch: {
    hits: {
      hits: [
        {
          _id: chunk.id,
          _score: 0.9,
          _source: {
            documentId: "doc-1",
            ordinal: 0,
            content: chunk.content,
            metadata: { lang: "en" },
          },
        },
      ],
    },
  },
};

describe.each(REMOTE_INDEX_KINDS.map((k) => [k]))("%s adapter", (kind) => {
  it("upserts the chunk with its ids and vector, and maps search results to hits", async () => {
    const { fetch, calls } = recorder([
      { match: /./, body: { code: 0, ...(SEARCH_ANSWERS[kind] as object) } },
    ]);
    const index = remoteIndex(
      kind,
      { url: "https://index.example.com", apiKey: "key", collection: "chunks" },
      fetch,
    );
    await index.upsert("src-1", "doc-1", [chunk]);
    const writes = calls.map((c) => c.body).join("\n");
    expect(writes).toContain(chunk.id);
    expect(writes).toContain("0.2");
    expect(writes).toContain("src-1");
    // the document's old chunks are dropped first
    expect(calls[0]?.url).toMatch(/delete|collections|batch/);

    calls.length = 0;
    const hits = await index.queryVector(["src-1"], [0.1, 0.2, 0.3], 3, { lang: "en" });
    expect(hits[0]).toMatchObject({
      chunkId: chunk.id,
      documentId: "doc-1",
      content: chunk.content,
      metadata: { lang: "en" },
    });
    expect(hits[0]?.score).toBeGreaterThan(0.8);
    const query = calls.map((c) => c.body).join("\n");
    expect(query).toContain("src-1");
    if (kind !== "weaviate") expect(query).toContain("lang");
  });

  it("surfaces API failures as network errors", async () => {
    const { fetch } = recorder([{ match: /./, body: { error: "boom" }, status: 500 }]);
    const index = remoteIndex(
      kind,
      { url: "https://index.example.com", collection: "chunks" },
      fetch,
    );
    await expect(index.queryVector(["src-1"], [0.1], 1)).rejects.toThrow(/500/);
  });
});

it("full-text search goes to the backends that have it", async () => {
  const { fetch, calls } = recorder([{ match: /./, body: SEARCH_ANSWERS.elasticsearch }]);
  const es = remoteIndex("elasticsearch", { url: "https://es", collection: "chunks" }, fetch);
  expect(es.supportsKeyword).toBe(true);
  await es.queryKeyword?.(["src-1"], "refunds", 3);
  expect(calls[0]?.body).toContain('"match":{"content":"refunds"}');
  expect(remoteIndex("qdrant", { url: "https://q", collection: "c" }, fetch).supportsKeyword).toBe(
    false,
  );
});
