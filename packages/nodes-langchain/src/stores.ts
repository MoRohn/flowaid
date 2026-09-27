/**
 * Vector stores for `langchain.vector_store` and `langchain.retriever`: LangChain `VectorStore`
 * subclasses, so they also work as `asRetriever()` in LCEL chains.
 *
 * - `workspace`: durable workspace state (`ctx.state`), exact cosine search — for small corpora
 *   (≤ 5 000 chunks) and zero-setup demos;
 * - `qdrant`: the Qdrant REST API;
 * - `pinecone`: the Pinecone data-plane API (index host).
 *
 * The HTTP stores go through the node's SSRF-guarded `ctx.http`, never a vendor SDK client. Ids are
 * deterministic (UUID-shaped SHA-256 of collection, source and content), so re-ingesting the same
 * document upserts instead of duplicating, and upserts are safe to retry. Every store returns the
 * stored vectors on request, which gives all of them maximal-marginal-relevance search.
 */
import { VectorStore, type MaxMarginalRelevanceSearchOptions } from "@langchain/core/vectorstores";
import { Document, type DocumentInterface } from "@langchain/core/documents";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { maximalMarginalRelevance } from "@langchain/core/utils/math";
import { sha256Hex } from "@flowaid/shared";
import type { StateAccess } from "@flowaid/node-sdk";
import {
  BadRequestError,
  NetworkError,
  type JsonObject,
  type JsonValue,
  type SafeFetch,
} from "@flowaid/workflow-core";

export type MetadataFilter = Record<string, string | number | boolean>;

export interface Hit {
  document: Document;
  score: number;
  vector?: number[];
}

/** UUID-shaped, deterministic id of a chunk in a collection. */
export function chunkId(collection: string, doc: DocumentInterface): string {
  const source = typeof doc.metadata.source === "string" ? doc.metadata.source : "";
  const chunk = doc.metadata.chunk === undefined ? "" : JSON.stringify(doc.metadata.chunk);
  const h = sha256Hex(`${collection}\n${source}\n${chunk}\n${doc.pageContent}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16] ?? "8", 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const matches = (metadata: Record<string, unknown>, filter?: MetadataFilter) =>
  !filter || Object.entries(filter).every(([k, v]) => metadata[k] === v);

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** The shared behaviour: embeddings, deterministic ids, similarity and MMR over `search`. */
export abstract class FlowaidVectorStore extends VectorStore {
  declare FilterType: MetadataFilter;

  constructor(
    embeddings: EmbeddingsInterface,
    readonly collection: string,
  ) {
    super(embeddings, {});
  }

  abstract search(
    query: number[],
    k: number,
    filter?: MetadataFilter,
    withVectors?: boolean,
  ): Promise<Hit[]>;
  abstract upsert(
    rows: { id: string; vector: number[]; document: DocumentInterface }[],
  ): Promise<void>;
  abstract remove(opts: { ids?: string[]; filter?: MetadataFilter }): Promise<number | null>;

  async addVectors(vectors: number[][], documents: DocumentInterface[]): Promise<string[]> {
    const rows = documents.map((document, i) => ({
      id: document.id ?? chunkId(this.collection, document),
      vector: vectors[i] ?? [],
      document,
    }));
    if (rows.some((r) => r.vector.length === 0))
      throw new BadRequestError("every document needs a vector");
    await this.upsert(rows);
    return rows.map((r) => r.id);
  }

  async addDocuments(documents: DocumentInterface[]): Promise<string[]> {
    return this.addVectors(
      await this.embeddings.embedDocuments(documents.map((d) => d.pageContent)),
      documents,
    );
  }

  async similaritySearchVectorWithScore(
    query: number[],
    k: number,
    filter?: MetadataFilter,
  ): Promise<[Document, number][]> {
    return (await this.search(query, k, filter)).map((h) => [h.document, h.score]);
  }

  override async maxMarginalRelevanceSearch(
    query: string,
    options: MaxMarginalRelevanceSearchOptions<MetadataFilter>,
    _callbacks?: unknown,
  ): Promise<Document[]> {
    const embedded = await this.embeddings.embedQuery(query);
    const hits = await this.search(embedded, options.fetchK ?? 20, options.filter, true);
    const withVectors = hits.filter((h) => h.vector?.length);
    if (withVectors.length === 0) return hits.slice(0, options.k).map((h) => h.document);
    const picked = maximalMarginalRelevance(
      embedded,
      withVectors.map((h) => h.vector ?? []),
      options.lambda ?? 0.5,
      options.k,
    );
    return picked.map((i) => {
      const hit = withVectors[i] as Hit;
      hit.document.metadata = { ...hit.document.metadata, score: hit.score };
      return hit.document;
    });
  }

  override async delete(params: { ids?: string[]; filter?: MetadataFilter }): Promise<void> {
    await this.remove(params);
  }
}

const MAX_WORKSPACE_ITEMS = 5000;

interface StoredItem {
  id: string;
  text: string;
  metadata: JsonObject;
  vector: number[];
}

/** Exact cosine search over a collection kept in durable workspace state. */
export class WorkspaceVectorStore extends FlowaidVectorStore {
  constructor(
    embeddings: EmbeddingsInterface,
    collection: string,
    private readonly state: StateAccess,
  ) {
    super(embeddings, collection);
  }

  _vectorstoreType(): string {
    return "flowaid-workspace";
  }

  private get key(): string {
    return `langchain.vectors.${this.collection}`;
  }

  private async load(): Promise<StoredItem[]> {
    const value = await this.state.get("workspace", this.key);
    return Array.isArray((value as { items?: unknown } | null)?.items)
      ? (value as unknown as { items: StoredItem[] }).items
      : [];
  }

  private save(items: StoredItem[]): Promise<void> {
    return this.state.set("workspace", this.key, { v: 1, items } as unknown as JsonValue);
  }

  async upsert(
    rows: { id: string; vector: number[]; document: DocumentInterface }[],
  ): Promise<void> {
    const byId = new Map((await this.load()).map((item) => [item.id, item]));
    for (const r of rows)
      byId.set(r.id, {
        id: r.id,
        text: r.document.pageContent,
        metadata: JSON.parse(JSON.stringify(r.document.metadata)) as JsonObject,
        vector: r.vector.map((x) => Math.round(x * 1e6) / 1e6),
      });
    if (byId.size > MAX_WORKSPACE_ITEMS)
      throw new BadRequestError(
        `the workspace store holds at most ${MAX_WORKSPACE_ITEMS} chunks per collection; use qdrant or pinecone for larger corpora`,
      );
    await this.save([...byId.values()]);
  }

  async search(
    query: number[],
    k: number,
    filter?: MetadataFilter,
    withVectors = false,
  ): Promise<Hit[]> {
    return (await this.load())
      .filter((item) => matches(item.metadata, filter))
      .map((item) => ({
        document: new Document({ pageContent: item.text, metadata: item.metadata, id: item.id }),
        score: cosine(query, item.vector),
        ...(withVectors ? { vector: item.vector } : {}),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  async remove(opts: { ids?: string[]; filter?: MetadataFilter }): Promise<number> {
    const items = await this.load();
    const keep = items.filter(
      (item) =>
        !(opts.ids?.includes(item.id) ?? false) &&
        !(opts.filter && matches(item.metadata, opts.filter)),
    );
    await this.save(keep);
    return items.length - keep.length;
  }
}

async function call(
  http: SafeFetch,
  url: string,
  init: RequestInit,
  what: string,
): Promise<unknown> {
  const res = await http(url, { ...init, maxBytes: 32 * 1024 * 1024 });
  const text = await res.text();
  if (!res.ok) throw new NetworkError(`${what} answered ${res.status}: ${text.slice(0, 300)}`);
  return text ? (JSON.parse(text) as unknown) : null;
}

/** Qdrant over its REST API (`url` like https://xyz.cloud.qdrant.io:6333). */
export class QdrantVectorStore extends FlowaidVectorStore {
  constructor(
    embeddings: EmbeddingsInterface,
    collection: string,
    private readonly opts: { http: SafeFetch; url: string; apiKey?: string },
  ) {
    super(embeddings, collection);
  }

  _vectorstoreType(): string {
    return "qdrant";
  }

  private req(path: string, method: string, body?: unknown) {
    return call(
      this.opts.http,
      `${this.opts.url.replace(/\/$/, "")}/collections/${encodeURIComponent(this.collection)}${path}`,
      {
        method,
        headers: {
          "content-type": "application/json",
          ...(this.opts.apiKey ? { "api-key": this.opts.apiKey } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      `qdrant ${method} ${path || "/"}`,
    );
  }

  private filter(filter?: MetadataFilter) {
    return filter
      ? {
          must: Object.entries(filter).map(([key, value]) => ({
            key: `metadata.${key}`,
            match: { value },
          })),
        }
      : undefined;
  }

  async upsert(
    rows: { id: string; vector: number[]; document: DocumentInterface }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    try {
      await this.req("", "GET");
    } catch {
      await this.req("", "PUT", { vectors: { size: rows[0]?.vector.length, distance: "Cosine" } });
    }
    for (let i = 0; i < rows.length; i += 256)
      await this.req("/points?wait=true", "PUT", {
        points: rows.slice(i, i + 256).map((r) => ({
          id: r.id,
          vector: r.vector,
          payload: { pageContent: r.document.pageContent, metadata: r.document.metadata },
        })),
      });
  }

  async search(
    query: number[],
    k: number,
    filter?: MetadataFilter,
    withVectors = false,
  ): Promise<Hit[]> {
    const out = (await this.req("/points/search", "POST", {
      vector: query,
      limit: k,
      with_payload: true,
      with_vector: withVectors,
      ...(filter ? { filter: this.filter(filter) } : {}),
    })) as {
      result?: {
        id: string | number;
        score: number;
        payload?: Record<string, unknown>;
        vector?: number[];
      }[];
    };
    return (out.result ?? []).map((p) => ({
      document: new Document({
        pageContent: typeof p.payload?.pageContent === "string" ? p.payload.pageContent : "",
        metadata: (p.payload?.metadata as Record<string, unknown> | undefined) ?? {},
        id: String(p.id),
      }),
      score: p.score,
      ...(p.vector ? { vector: p.vector } : {}),
    }));
  }

  async remove(opts: { ids?: string[]; filter?: MetadataFilter }): Promise<null> {
    await this.req(
      "/points/delete?wait=true",
      "POST",
      opts.ids ? { points: opts.ids } : { filter: this.filter(opts.filter) },
    );
    return null;
  }
}

const pineconeValue = (v: unknown): string | number | boolean | string[] =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean"
    ? v
    : Array.isArray(v) && v.every((x) => typeof x === "string")
      ? v
      : JSON.stringify(v);

/** Pinecone over its data-plane API (`url` = the index host, e.g. https://docs-abc123.svc.pinecone.io). */
export class PineconeVectorStore extends FlowaidVectorStore {
  constructor(
    embeddings: EmbeddingsInterface,
    collection: string,
    private readonly opts: { http: SafeFetch; url: string; apiKey: string },
  ) {
    super(embeddings, collection);
  }

  _vectorstoreType(): string {
    return "pinecone";
  }

  private req(path: string, body: unknown) {
    const base = /^https?:\/\//.test(this.opts.url) ? this.opts.url : `https://${this.opts.url}`;
    return call(
      this.opts.http,
      `${base.replace(/\/$/, "")}${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "api-key": this.opts.apiKey,
          "x-pinecone-api-version": "2025-04",
        },
        body: JSON.stringify(body),
      },
      `pinecone ${path}`,
    );
  }

  private filter(filter?: MetadataFilter) {
    return filter
      ? Object.fromEntries(Object.entries(filter).map(([k, v]) => [k, { $eq: v }]))
      : undefined;
  }

  async upsert(
    rows: { id: string; vector: number[]; document: DocumentInterface }[],
  ): Promise<void> {
    for (let i = 0; i < rows.length; i += 100)
      await this.req("/vectors/upsert", {
        namespace: this.collection,
        vectors: rows.slice(i, i + 100).map((r) => ({
          id: r.id,
          values: r.vector,
          metadata: {
            ...Object.fromEntries(
              Object.entries(r.document.metadata).map(([k, v]) => [k, pineconeValue(v)]),
            ),
            pageContent: r.document.pageContent,
          },
        })),
      });
  }

  async search(
    query: number[],
    k: number,
    filter?: MetadataFilter,
    withVectors = false,
  ): Promise<Hit[]> {
    const out = (await this.req("/query", {
      namespace: this.collection,
      vector: query,
      topK: k,
      includeMetadata: true,
      includeValues: withVectors,
      ...(filter ? { filter: this.filter(filter) } : {}),
    })) as {
      matches?: {
        id: string;
        score: number;
        values?: number[];
        metadata?: Record<string, unknown>;
      }[];
    };
    return (out.matches ?? []).map((m) => {
      const { pageContent, ...metadata } = m.metadata ?? {};
      return {
        document: new Document({
          pageContent: typeof pageContent === "string" ? pageContent : "",
          metadata,
          id: m.id,
        }),
        score: m.score,
        ...(m.values?.length ? { vector: m.values } : {}),
      };
    });
  }

  async remove(opts: { ids?: string[]; filter?: MetadataFilter }): Promise<null> {
    await this.req(
      "/vectors/delete",
      opts.ids
        ? { namespace: this.collection, ids: opts.ids }
        : { namespace: this.collection, filter: this.filter(opts.filter) },
    );
    return null;
  }
}
