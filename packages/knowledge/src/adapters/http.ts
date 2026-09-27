/**
 * Remote `VectorIndexAdapter`s over each backend's HTTP API (ARCHITECTURE.md §10.8): Qdrant,
 * Pinecone, Weaviate, Milvus, Chroma, Elasticsearch and OpenSearch. Every call goes through the
 * caller's SSRF-guarded fetch; no vendor SDK is loaded. Each point stores `sourceId`,
 * `documentId`, `ordinal`, `content` and the chunk metadata next to the vector, so documents can
 * be replaced and whole sources dropped by filter. Metadata filters map to the backend's own
 * filter language where it has one for nested values; Weaviate filters are applied after the
 * query (over-fetching 4×). Adapter `stats` count chunks; document counts come from Postgres.
 */
import {
  NetworkError,
  type IndexHit,
  type IndexedChunk,
  type JsonObject,
  type KnowledgeFilter,
  type SafeFetch,
  type VectorIndexAdapter,
} from "@flowaid/workflow-core";
import { matchesFilter } from "./memory.js";

export interface RemoteIndexConfig {
  /** base URL of the service (Pinecone: the index host) */
  url: string;
  apiKey?: string;
  /** collection / index / class name */
  collection: string;
  /** vector size; used when the adapter creates the collection */
  dimensions?: number;
}

type Json = Record<string, unknown>;

class Http {
  constructor(
    private readonly fetch: SafeFetch,
    private readonly base: string,
    private readonly headers: Record<string, string>,
    private readonly signal?: AbortSignal,
  ) {}

  async call(
    method: string,
    path: string,
    body?: unknown,
    o: { ok?: number[]; raw?: string } = {},
  ): Promise<Json> {
    const res = await this.fetch(`${this.base.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        "content-type": o.raw ? "application/x-ndjson" : "application/json",
        ...this.headers,
      },
      ...(o.raw !== undefined
        ? { body: o.raw }
        : body !== undefined
          ? { body: JSON.stringify(body) }
          : {}),
      ...(this.signal ? { signal: this.signal } : {}),
    });
    if (!res.ok && !(o.ok ?? []).includes(res.status)) {
      const text = await res.text().catch(() => "");
      throw new NetworkError(
        `${method} ${path} answered ${res.status}: ${text.slice(0, 300)}`,
        res.status >= 500 || res.status === 429,
      );
    }
    const text = await res.text();
    return text ? (JSON.parse(text) as Json) : {};
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const obj = (v: unknown): JsonObject => {
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as JsonObject;
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" ? (v as JsonObject) : {};
};
const vectorOf = (c: IndexedChunk) => {
  if (!c.embedding)
    throw new NetworkError(
      "this index stores vectors only: the source needs an embedding model",
      false,
    );
  return c.embedding;
};

function hitFrom(p: Json, score: number, id?: unknown): IndexHit {
  return {
    chunkId: str(id ?? p.id ?? p.chunkId),
    documentId: str(p.documentId),
    ordinal: num(p.ordinal),
    content: str(p.content),
    metadata: obj(p.metadata),
    score,
  };
}

// ─── Qdrant ──────────────────────────────────────────────────────────────────────────────

export class QdrantIndex implements VectorIndexAdapter {
  readonly kind = "qdrant";
  readonly supportsKeyword = false;
  private readonly http: Http;
  private ensured = false;
  constructor(
    private readonly c: RemoteIndexConfig,
    fetch: SafeFetch,
    signal?: AbortSignal,
  ) {
    this.http = new Http(fetch, c.url, c.apiKey ? { "api-key": c.apiKey } : {}, signal);
  }
  private coll = () => `/collections/${encodeURIComponent(this.c.collection)}`;
  private must(sourceIds: readonly string[], documentId?: string, filter?: KnowledgeFilter) {
    return {
      must: [
        { key: "sourceId", match: { any: [...sourceIds] } },
        ...(documentId ? [{ key: "documentId", match: { value: documentId } }] : []),
        ...Object.entries(filter ?? {}).map(([k, v]) => ({
          key: `metadata.${k}`,
          match: { value: v },
        })),
      ],
    };
  }
  private async ensure(size: number) {
    if (this.ensured) return;
    await this.http.call(
      "PUT",
      this.coll(),
      { vectors: { size, distance: "Cosine" } },
      { ok: [409] },
    );
    this.ensured = true;
  }
  async upsert(sourceId: string, documentId: string, chunks: IndexedChunk[]) {
    await this.deleteDocument(sourceId, documentId);
    if (!chunks.length) return;
    await this.ensure(this.c.dimensions ?? vectorOf(chunks[0] as IndexedChunk).length);
    await this.http.call("PUT", `${this.coll()}/points?wait=true`, {
      points: chunks.map((ch) => ({
        id: ch.id,
        vector: vectorOf(ch),
        payload: {
          sourceId,
          documentId,
          ordinal: ch.ordinal,
          content: ch.content,
          metadata: ch.metadata,
        },
      })),
    });
  }
  async queryVector(
    sourceIds: readonly string[],
    vector: number[],
    k: number,
    filter?: KnowledgeFilter,
  ) {
    const r = await this.http.call(
      "POST",
      `${this.coll()}/points/search`,
      {
        vector,
        limit: k,
        with_payload: true,
        filter: this.must(sourceIds, undefined, filter),
      },
      { ok: [404] },
    );
    return ((r.result as Json[] | undefined) ?? []).map((p) =>
      hitFrom(obj(p.payload), num(p.score), p.id),
    );
  }
  async deleteDocument(sourceId: string, documentId: string) {
    await this.http.call(
      "POST",
      `${this.coll()}/points/delete?wait=true`,
      { filter: this.must([sourceId], documentId) },
      { ok: [404] },
    );
  }
  async deleteSource(sourceId: string) {
    await this.http.call(
      "POST",
      `${this.coll()}/points/delete?wait=true`,
      { filter: this.must([sourceId]) },
      { ok: [404] },
    );
  }
  async stats(sourceId: string) {
    const r = await this.http.call(
      "POST",
      `${this.coll()}/points/count`,
      { filter: this.must([sourceId]), exact: true },
      { ok: [404] },
    );
    return { documents: 0, chunks: num(obj(r.result).count) };
  }
}

// ─── Pinecone (one namespace per source) ────────────────────────────────────────────────

export class PineconeIndex implements VectorIndexAdapter {
  readonly kind = "pinecone";
  readonly supportsKeyword = false;
  private readonly http: Http;
  constructor(c: RemoteIndexConfig, fetch: SafeFetch, signal?: AbortSignal) {
    this.http = new Http(
      fetch,
      c.url,
      { "Api-Key": c.apiKey ?? "", "X-Pinecone-API-Version": "2025-04" },
      signal,
    );
  }
  async upsert(sourceId: string, documentId: string, chunks: IndexedChunk[]) {
    await this.deleteDocument(sourceId, documentId);
    for (let i = 0; i < chunks.length; i += 100)
      await this.http.call("POST", "/vectors/upsert", {
        namespace: sourceId,
        vectors: chunks.slice(i, i + 100).map((ch) => ({
          id: ch.id,
          values: vectorOf(ch),
          metadata: {
            ...flatMeta(ch.metadata),
            documentId,
            ordinal: ch.ordinal,
            content: ch.content,
            metadata: JSON.stringify(ch.metadata),
          },
        })),
      });
  }
  async queryVector(
    sourceIds: readonly string[],
    vector: number[],
    k: number,
    filter?: KnowledgeFilter,
  ) {
    const hits: IndexHit[] = [];
    for (const ns of sourceIds) {
      const r = await this.http.call("POST", "/query", {
        namespace: ns,
        vector,
        topK: k,
        includeMetadata: true,
        ...(filter && Object.keys(filter).length
          ? {
              filter: Object.fromEntries(
                Object.entries(filter).map(([key, v]) => [`m_${key}`, { $eq: v }]),
              ),
            }
          : {}),
      });
      for (const m of (r.matches as Json[] | undefined) ?? [])
        hits.push(hitFrom(obj(m.metadata), num(m.score), m.id));
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, k);
  }
  async deleteDocument(sourceId: string, documentId: string) {
    await this.http.call(
      "POST",
      "/vectors/delete",
      { namespace: sourceId, filter: { documentId: { $eq: documentId } } },
      { ok: [404] },
    );
  }
  async deleteSource(sourceId: string) {
    await this.http.call(
      "POST",
      "/vectors/delete",
      { namespace: sourceId, deleteAll: true },
      { ok: [404] },
    );
  }
  async stats(sourceId: string) {
    const r = await this.http.call("POST", "/describe_index_stats", {});
    return { documents: 0, chunks: num(obj(obj(r.namespaces)[sourceId]).vectorCount) };
  }
}

function flatMeta(m: JsonObject): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(m))
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[`m_${k}`] = v;
  return out;
}

// ─── Weaviate ────────────────────────────────────────────────────────────────────────────

export class WeaviateIndex implements VectorIndexAdapter {
  readonly kind = "weaviate";
  readonly supportsKeyword = true;
  private readonly http: Http;
  private readonly cls: string;
  constructor(c: RemoteIndexConfig, fetch: SafeFetch, signal?: AbortSignal) {
    this.http = new Http(
      fetch,
      c.url,
      c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {},
      signal,
    );
    // class names are capitalised identifiers
    const name = c.collection.replace(/[^A-Za-z0-9_]/g, "_");
    this.cls = name.charAt(0).toUpperCase() + name.slice(1);
  }
  private where(sourceIds: readonly string[], documentId?: string) {
    const ors = {
      operator: "Or",
      operands: sourceIds.map((s) => ({ path: ["sourceId"], operator: "Equal", valueText: s })),
    };
    return documentId
      ? {
          operator: "And",
          operands: [ors, { path: ["documentId"], operator: "Equal", valueText: documentId }],
        }
      : ors;
  }
  async upsert(sourceId: string, documentId: string, chunks: IndexedChunk[]) {
    await this.deleteDocument(sourceId, documentId);
    if (!chunks.length) return;
    await this.http.call("POST", "/v1/batch/objects", {
      objects: chunks.map((ch) => ({
        class: this.cls,
        id: ch.id,
        vector: vectorOf(ch),
        properties: {
          sourceId,
          documentId,
          ordinal: ch.ordinal,
          content: ch.content,
          metadata: JSON.stringify(ch.metadata),
        },
      })),
    });
  }
  private async get(
    clause: string,
    sourceIds: readonly string[],
    k: number,
    filter?: KnowledgeFilter,
  ) {
    const limit = filter && Object.keys(filter).length ? k * 4 : k;
    const query = `{ Get { ${this.cls}(${clause}, limit: ${limit}, where: ${gql(this.where(sourceIds))}) { sourceId documentId ordinal content metadata _additional { id distance score } } } }`;
    const r = await this.http.call("POST", "/v1/graphql", { query });
    const rows = (obj(obj(r.data).Get)[this.cls] as Json[] | undefined) ?? [];
    return rows
      .map((row) => {
        const add = obj(row._additional);
        const score =
          add.distance !== undefined && add.distance !== null
            ? 1 - num(add.distance)
            : num(add.score);
        return hitFrom(row, score, add.id);
      })
      .filter((h) => matchesFilter(h.metadata, filter))
      .slice(0, k);
  }
  queryVector(sourceIds: readonly string[], vector: number[], k: number, filter?: KnowledgeFilter) {
    return this.get(`nearVector: { vector: ${JSON.stringify(vector)} }`, sourceIds, k, filter);
  }
  queryKeyword(sourceIds: readonly string[], text: string, k: number, filter?: KnowledgeFilter) {
    return this.get(
      `bm25: { query: ${JSON.stringify(text)}, properties: ["content"] }`,
      sourceIds,
      k,
      filter,
    );
  }
  async deleteDocument(sourceId: string, documentId: string) {
    await this.http.call(
      "DELETE",
      "/v1/batch/objects",
      { match: { class: this.cls, where: this.where([sourceId], documentId) } },
      { ok: [404, 422] },
    );
  }
  async deleteSource(sourceId: string) {
    await this.http.call(
      "DELETE",
      "/v1/batch/objects",
      { match: { class: this.cls, where: this.where([sourceId]) } },
      { ok: [404, 422] },
    );
  }
  async stats(sourceId: string) {
    const r = await this.http.call("POST", "/v1/graphql", {
      query: `{ Aggregate { ${this.cls}(where: ${gql(this.where([sourceId]))}) { meta { count } } } }`,
    });
    const rows = (obj(obj(r.data).Aggregate)[this.cls] as Json[] | undefined) ?? [];
    return { documents: 0, chunks: num(obj(rows[0]?.meta).count) };
  }
}

/** A GraphQL input literal (keys unquoted; `operator` enums unquoted). */
function gql(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(gql).join(", ")}]`;
  if (v && typeof v === "object")
    return `{ ${Object.entries(v)
      .map(([k, x]) => `${k}: ${k === "operator" ? String(x) : gql(x)}`)
      .join(", ")} }`;
  return JSON.stringify(v);
}

// ─── Milvus (REST v2) ────────────────────────────────────────────────────────────────────

export class MilvusIndex implements VectorIndexAdapter {
  readonly kind = "milvus";
  readonly supportsKeyword = false;
  private readonly http: Http;
  constructor(
    private readonly c: RemoteIndexConfig,
    fetch: SafeFetch,
    signal?: AbortSignal,
  ) {
    this.http = new Http(
      fetch,
      c.url,
      c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {},
      signal,
    );
  }
  private expr(
    sourceIds: readonly string[],
    documentId?: string,
    filter?: KnowledgeFilter,
  ): string {
    const parts = [`sourceId in ${JSON.stringify([...sourceIds])}`];
    if (documentId) parts.push(`documentId == ${JSON.stringify(documentId)}`);
    for (const [k, v] of Object.entries(filter ?? {}))
      parts.push(`metadata[${JSON.stringify(k)}] == ${JSON.stringify(v)}`);
    return parts.join(" and ");
  }
  private async check(r: Json) {
    if (num(r.code) !== 0)
      throw new NetworkError(`milvus: ${str(r.message) || `code ${num(r.code)}`}`, false);
    return Promise.resolve(r);
  }
  async upsert(sourceId: string, documentId: string, chunks: IndexedChunk[]) {
    await this.deleteDocument(sourceId, documentId);
    if (!chunks.length) return;
    await this.check(
      await this.http.call("POST", "/v2/vectordb/entities/upsert", {
        collectionName: this.c.collection,
        data: chunks.map((ch) => ({
          id: ch.id,
          vector: vectorOf(ch),
          sourceId,
          documentId,
          ordinal: ch.ordinal,
          content: ch.content,
          metadata: ch.metadata,
        })),
      }),
    );
  }
  async queryVector(
    sourceIds: readonly string[],
    vector: number[],
    k: number,
    filter?: KnowledgeFilter,
  ) {
    const r = await this.check(
      await this.http.call("POST", "/v2/vectordb/entities/search", {
        collectionName: this.c.collection,
        data: [vector],
        annsField: "vector",
        limit: k,
        filter: this.expr(sourceIds, undefined, filter),
        outputFields: ["id", "documentId", "ordinal", "content", "metadata"],
        searchParams: { metricType: "COSINE" },
      }),
    );
    return ((r.data as Json[] | undefined) ?? []).map((row) =>
      hitFrom(row, num(row.distance), row.id),
    );
  }
  async deleteDocument(sourceId: string, documentId: string) {
    await this.check(
      await this.http.call("POST", "/v2/vectordb/entities/delete", {
        collectionName: this.c.collection,
        filter: this.expr([sourceId], documentId),
      }),
    );
  }
  async deleteSource(sourceId: string) {
    await this.check(
      await this.http.call("POST", "/v2/vectordb/entities/delete", {
        collectionName: this.c.collection,
        filter: this.expr([sourceId]),
      }),
    );
  }
  async stats(sourceId: string) {
    const r = await this.check(
      await this.http.call("POST", "/v2/vectordb/entities/query", {
        collectionName: this.c.collection,
        filter: this.expr([sourceId]),
        outputFields: ["count(*)"],
      }),
    );
    return { documents: 0, chunks: num(obj((r.data as Json[] | undefined)?.[0])["count(*)"]) };
  }
}

// ─── Chroma ──────────────────────────────────────────────────────────────────────────────

export class ChromaIndex implements VectorIndexAdapter {
  readonly kind = "chroma";
  readonly supportsKeyword = false;
  private readonly http: Http;
  private id: string | null = null;
  constructor(
    private readonly c: RemoteIndexConfig,
    fetch: SafeFetch,
    signal?: AbortSignal,
  ) {
    this.http = new Http(fetch, c.url, c.apiKey ? { "x-chroma-token": c.apiKey } : {}, signal);
  }
  private async coll(): Promise<string> {
    if (this.id) return this.id;
    const r = await this.http.call("POST", "/api/v1/collections", {
      name: this.c.collection,
      get_or_create: true,
      metadata: { "hnsw:space": "cosine" },
    });
    this.id = str(r.id);
    return this.id;
  }
  private where(sourceIds: readonly string[], documentId?: string, filter?: KnowledgeFilter) {
    const clauses: Json[] = [
      sourceIds.length === 1 ? { sourceId: sourceIds[0] } : { sourceId: { $in: [...sourceIds] } },
      ...(documentId ? [{ documentId }] : []),
      ...Object.entries(filter ?? {}).map(([k, v]) => ({ [`m_${k}`]: v })),
    ];
    return clauses.length === 1 ? clauses[0] : { $and: clauses };
  }
  async upsert(sourceId: string, documentId: string, chunks: IndexedChunk[]) {
    await this.deleteDocument(sourceId, documentId);
    if (!chunks.length) return;
    await this.http.call("POST", `/api/v1/collections/${await this.coll()}/upsert`, {
      ids: chunks.map((ch) => ch.id),
      embeddings: chunks.map(vectorOf),
      documents: chunks.map((ch) => ch.content),
      metadatas: chunks.map((ch) => ({
        ...flatMeta(ch.metadata),
        sourceId,
        documentId,
        ordinal: ch.ordinal,
        metadata: JSON.stringify(ch.metadata),
      })),
    });
  }
  async queryVector(
    sourceIds: readonly string[],
    vector: number[],
    k: number,
    filter?: KnowledgeFilter,
  ) {
    const r = await this.http.call("POST", `/api/v1/collections/${await this.coll()}/query`, {
      query_embeddings: [vector],
      n_results: k,
      where: this.where(sourceIds, undefined, filter),
      include: ["documents", "metadatas", "distances"],
    });
    const ids = ((r.ids as unknown[][] | undefined)?.[0] ?? []) as string[];
    const docs = ((r.documents as unknown[][] | undefined)?.[0] ?? []) as string[];
    const metas = ((r.metadatas as unknown[][] | undefined)?.[0] ?? []) as Json[];
    const dists = ((r.distances as unknown[][] | undefined)?.[0] ?? []) as number[];
    return ids.map((id, i) => hitFrom({ ...metas[i], content: docs[i] }, 1 - num(dists[i]), id));
  }
  async deleteDocument(sourceId: string, documentId: string) {
    await this.http.call("POST", `/api/v1/collections/${await this.coll()}/delete`, {
      where: this.where([sourceId], documentId),
    });
  }
  async deleteSource(sourceId: string) {
    await this.http.call("POST", `/api/v1/collections/${await this.coll()}/delete`, {
      where: this.where([sourceId]),
    });
  }
  async stats(sourceId: string) {
    const r = await this.http.call("POST", `/api/v1/collections/${await this.coll()}/get`, {
      where: this.where([sourceId]),
      include: [],
    });
    return { documents: 0, chunks: ((r.ids as unknown[] | undefined) ?? []).length };
  }
}

// ─── Elasticsearch and OpenSearch ────────────────────────────────────────────────────────

abstract class SearchEngineIndex implements VectorIndexAdapter {
  abstract readonly kind: string;
  readonly supportsKeyword = true;
  protected readonly http: Http;
  private ensured = false;
  constructor(
    protected readonly c: RemoteIndexConfig,
    fetch: SafeFetch,
    signal?: AbortSignal,
  ) {
    this.http = new Http(
      fetch,
      c.url,
      c.apiKey
        ? {
            authorization: c.apiKey.includes(":")
              ? `Basic ${btoa(c.apiKey)}`
              : `ApiKey ${c.apiKey}`,
          }
        : {},
      signal,
    );
  }
  protected idx = () => `/${encodeURIComponent(this.c.collection)}`;
  protected filters(
    sourceIds: readonly string[],
    documentId?: string,
    filter?: KnowledgeFilter,
  ): Json[] {
    return [
      { terms: { sourceId: [...sourceIds] } },
      ...(documentId ? [{ term: { documentId } }] : []),
      ...Object.entries(filter ?? {}).map(([k, v]) => ({ term: { [`metadata.${k}`]: v } })),
    ];
  }
  protected abstract mapping(dimensions: number): Json;
  protected abstract knn(vector: number[], k: number, filter: Json[]): Json;
  private async ensure(dimensions: number) {
    if (this.ensured) return;
    await this.http.call("PUT", this.idx(), this.mapping(dimensions), { ok: [400] });
    this.ensured = true;
  }
  async upsert(sourceId: string, documentId: string, chunks: IndexedChunk[]) {
    await this.deleteDocument(sourceId, documentId);
    if (!chunks.length) return;
    await this.ensure(this.c.dimensions ?? vectorOf(chunks[0] as IndexedChunk).length);
    const lines = chunks.flatMap((ch) => [
      JSON.stringify({ index: { _index: this.c.collection, _id: ch.id } }),
      JSON.stringify({
        sourceId,
        documentId,
        ordinal: ch.ordinal,
        content: ch.content,
        metadata: ch.metadata,
        embedding: vectorOf(ch),
      }),
    ]);
    const r = await this.http.call("POST", "/_bulk?refresh=true", undefined, {
      raw: `${lines.join("\n")}\n`,
    });
    if (r.errors === true)
      throw new NetworkError(`${this.kind}: bulk indexing reported errors`, false);
  }
  private async search(body: Json, k: number): Promise<IndexHit[]> {
    const r = await this.http.call(
      "POST",
      `${this.idx()}/_search`,
      { size: k, _source: { excludes: ["embedding"] }, ...body },
      { ok: [404] },
    );
    return ((obj(r.hits).hits as Json[] | undefined) ?? []).map((h) =>
      hitFrom(obj(h._source), num(h._score), h._id),
    );
  }
  queryVector(sourceIds: readonly string[], vector: number[], k: number, filter?: KnowledgeFilter) {
    return this.search(this.knn(vector, k, this.filters(sourceIds, undefined, filter)), k);
  }
  queryKeyword(sourceIds: readonly string[], text: string, k: number, filter?: KnowledgeFilter) {
    return this.search(
      {
        query: {
          bool: {
            must: { match: { content: text } },
            filter: this.filters(sourceIds, undefined, filter),
          },
        },
      },
      k,
    );
  }
  async deleteDocument(sourceId: string, documentId: string) {
    await this.http.call(
      "POST",
      `${this.idx()}/_delete_by_query?refresh=true`,
      { query: { bool: { filter: this.filters([sourceId], documentId) } } },
      { ok: [404] },
    );
  }
  async deleteSource(sourceId: string) {
    await this.http.call(
      "POST",
      `${this.idx()}/_delete_by_query?refresh=true`,
      { query: { bool: { filter: this.filters([sourceId]) } } },
      { ok: [404] },
    );
  }
  async stats(sourceId: string) {
    const r = await this.http.call(
      "POST",
      `${this.idx()}/_count`,
      { query: { bool: { filter: this.filters([sourceId]) } } },
      { ok: [404] },
    );
    return { documents: 0, chunks: num(r.count) };
  }
}

export class ElasticsearchIndex extends SearchEngineIndex {
  readonly kind = "elasticsearch";
  protected mapping(dimensions: number): Json {
    return {
      mappings: {
        properties: {
          sourceId: { type: "keyword" },
          documentId: { type: "keyword" },
          ordinal: { type: "integer" },
          content: { type: "text" },
          metadata: { type: "object" },
          embedding: { type: "dense_vector", dims: dimensions, index: true, similarity: "cosine" },
        },
      },
    };
  }
  protected knn(vector: number[], k: number, filter: Json[]): Json {
    return {
      knn: {
        field: "embedding",
        query_vector: vector,
        k,
        num_candidates: Math.max(50, k * 10),
        filter,
      },
    };
  }
}

export class OpenSearchIndex extends SearchEngineIndex {
  readonly kind = "opensearch";
  protected mapping(dimensions: number): Json {
    return {
      settings: { index: { knn: true } },
      mappings: {
        properties: {
          sourceId: { type: "keyword" },
          documentId: { type: "keyword" },
          ordinal: { type: "integer" },
          content: { type: "text" },
          metadata: { type: "object" },
          embedding: {
            type: "knn_vector",
            dimension: dimensions,
            method: { name: "hnsw", engine: "lucene", space_type: "cosinesimil" },
          },
        },
      },
    };
  }
  protected knn(vector: number[], k: number, filter: Json[]): Json {
    return { query: { knn: { embedding: { vector, k, filter: { bool: { filter } } } } } };
  }
}

export const REMOTE_INDEX_KINDS = [
  "qdrant",
  "pinecone",
  "weaviate",
  "milvus",
  "chroma",
  "elasticsearch",
  "opensearch",
] as const;
export type RemoteIndexKind = (typeof REMOTE_INDEX_KINDS)[number];

/** A remote adapter by kind. */
export function remoteIndex(
  kind: RemoteIndexKind,
  config: RemoteIndexConfig,
  fetch: SafeFetch,
  signal?: AbortSignal,
): VectorIndexAdapter {
  switch (kind) {
    case "qdrant":
      return new QdrantIndex(config, fetch, signal);
    case "pinecone":
      return new PineconeIndex(config, fetch, signal);
    case "weaviate":
      return new WeaviateIndex(config, fetch, signal);
    case "milvus":
      return new MilvusIndex(config, fetch, signal);
    case "chroma":
      return new ChromaIndex(config, fetch, signal);
    case "elasticsearch":
      return new ElasticsearchIndex(config, fetch, signal);
    case "opensearch":
      return new OpenSearchIndex(config, fetch, signal);
  }
}
