# RFC-0021: `ctx.knowledge` and the `VectorIndexAdapter` contract

- Status: accepted (2026-09-27)
- Raised by: P6-09 (Knowledge/RAG, WP-25), whose retrieval nodes search and index workspace knowledge sources
- Implemented by: P6-09
- Affects: `CONTRACTS.ts` §4 `NodeCapability` (one value added), §15 a new Knowledge block (types only), §16 `ExecutionContext` (one optional member); `@flowaid/workflow-core` 0.3.6 → 0.3.7

## Motivation

ARCHITECTURE.md §10.8 puts knowledge bases behind the platform: sources and documents live in
Postgres, chunks in pgvector (or a remote index), and embeddings are paid for through the
workspace's provider credentials. Retrieval nodes (`flowaid.retrieval.*`) need to search those
sources and write documents into them, but the node context had no way to reach them: a node
could only embed text (`ctx.providers.embedding`) and hold vectors itself, which loses the
workspace's index, its hybrid search and its idempotent upserts. Remote index backends (Qdrant,
Pinecone, Weaviate, Milvus, Chroma, Elasticsearch, OpenSearch) also had no shared shape, so every
consumer would have re-invented it.

## Change

- `NodeCapability` gains `'knowledge'`. Nodes that declare it get `ctx.knowledge`; others get an
  accessor that rejects with `FORBIDDEN`, like every other capability-gated service.
- `ExecutionContext.knowledge?: KnowledgeAccess` with
  - `sources(): Promise<KnowledgeSourceSummary[]>`
  - `search(req: KnowledgeSearchRequest): Promise<KnowledgeSearchResult>` — `mode` is
    `vector | keyword | hybrid` (reciprocal rank fusion, k = 60), with `k`, `minScore` and an
    exact-match metadata `filter`; hits carry `sourceId`, `title` and `uri`, plus `usage` and
    `costUsd` for the query embedding.
  - `upsertDocument(doc: KnowledgeDocumentInput): Promise<KnowledgeUpsertResult>` — text is
    normalised, chunked by the source's pipeline and embedded; or pre-made chunks (optionally with
    embeddings) are indexed as given. Unchanged content (by hash) is skipped.
  - `deleteDocument(sourceId, externalId): Promise<boolean>`
- New types: `KnowledgeSearchMode`, `KnowledgeFilter`, `KnowledgeSearchRequest`, `KnowledgeHit`,
  `KnowledgeSearchResult`, `KnowledgeChunkInput`, `KnowledgeDocumentInput`,
  `KnowledgeUpsertResult`, `KnowledgeSourceSummary`, `ChunkerConfig`, `IndexedChunk`, `IndexHit`,
  and the backend contract `VectorIndexAdapter { kind, supportsKeyword, upsert, queryVector,
queryKeyword?, deleteDocument, deleteSource, stats }`. `@flowaid/knowledge` implements the
  service and the remote adapters; `@flowaid/database` implements the pgvector adapter.

## Compatibility

Additive. Existing manifests, plans and definitions are unaffected; `ctx.knowledge` is optional,
so runtimes that do not bind it (an exported code package today) leave retrieval nodes failing
with a clear `BAD_REQUEST` instead of a type error. The database side is migration `0005`
(unsized `vector` column with per-dimension partial HNSW indexes, `documents.content`/`error`).

## Tests

- `contracts-parity.test.ts` keeps `CONTRACTS.ts` and `@flowaid/workflow-core` in step.
- `@flowaid/knowledge/testing` `vectorIndexContract` runs against the memory index and, in
  `apps/worker`, against pgvector; the remote adapters are tested against mocked HTTP.
- Retrieval node harness tests (`nodes-core/src/retrieval`), ingestion idempotency and a
  retrieval run through the worker (Postgres), and the retrieval template in the golden-trace
  harness with a fake embedding provider.
