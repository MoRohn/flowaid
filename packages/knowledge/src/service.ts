/**
 * The knowledge service (ARCHITECTURE.md §10.8): what `ctx.knowledge`, the ingestion job and the
 * API's query playground call. It owns the pipeline — normalise → chunk → metadata → embed →
 * index — and search: `vector` (embedding similarity), `keyword` (full-text rank) or `hybrid`
 * (both, fused with reciprocal rank fusion). Document metadata lives in a `KnowledgeStore`
 * (Postgres in production), vectors in the source's `VectorIndexAdapter`; embedding providers
 * come from the caller, already bound to the workspace's credentials.
 *
 * Idempotency: a document whose content hash matches the indexed version is not re-chunked or
 * re-embedded; re-ingesting a whole source only touches changed documents.
 */
import {
  BadRequestError,
  NotFoundError,
  type ChunkerConfig,
  type DecisionCallContext,
  type EmbeddingProvider,
  type IndexHit,
  type IndexedChunk,
  type JsonObject,
  type KnowledgeChunkInput,
  type KnowledgeDocumentInput,
  type KnowledgeHit,
  type KnowledgeSearchMode,
  type KnowledgeSearchRequest,
  type KnowledgeSearchResult,
  type KnowledgeSourceSummary,
  type KnowledgeUpsertResult,
  type ModelRef,
  type TokenUsage,
  type VectorIndexAdapter,
} from "@flowaid/workflow-core";
import { DEFAULT_CHUNKER, chunkText, estimateTokens } from "./chunk.js";
import { reciprocalRankFusion } from "./fusion.js";
import { contentHash, normalize } from "./normalize.js";

/** A source's pipeline (`knowledge_sources.pipeline`). */
export interface SourcePipeline {
  chunker?: Partial<ChunkerConfig>;
  /** null: keyword-only source */
  embedding?: ModelRef | null;
  index?: { adapter: string; [key: string]: unknown };
}

export interface SourceRecord {
  id: string;
  name: string;
  kind: string;
  status: KnowledgeSourceSummary["status"];
  pipeline: SourcePipeline;
  documents: number;
  chunks: number;
}

export interface DocumentRecord {
  id: string;
  sourceId: string;
  externalId: string;
  contentHash: string;
  status: "pending" | "indexed" | "error" | "deleted";
  chunkCount: number;
  title: string | null;
  uri: string | null;
}

export interface DocumentWrite {
  sourceId: string;
  externalId: string;
  title: string | null;
  uri: string | null;
  mimeType: string | null;
  contentHash: string;
  metadata: JsonObject;
  chunkCount: number;
  status: DocumentRecord["status"];
  /** kept for inline sources so the source can be re-indexed after a pipeline change */
  content?: string | null;
}

/** Document metadata storage, scoped to one workspace by the implementation. */
export interface KnowledgeStore {
  listSources(): Promise<SourceRecord[]>;
  getSource(id: string): Promise<SourceRecord | null>;
  getDocument(sourceId: string, externalId: string): Promise<DocumentRecord | null>;
  /** inserts or updates by (sourceId, externalId); returns the document id */
  saveDocument(doc: DocumentWrite): Promise<string>;
  deleteDocument(sourceId: string, externalId: string): Promise<string | null>;
  documentsById(
    ids: readonly string[],
  ): Promise<Map<string, { title: string | null; uri: string | null; sourceId: string }>>;
}

export interface KnowledgeServiceDeps {
  store: KnowledgeStore;
  /** the index a source's chunks live in (remote indexes may resolve their credential first) */
  index(source: SourceRecord): VectorIndexAdapter | Promise<VectorIndexAdapter>;
  /** an embedding provider for the model, bound to the workspace's credentials */
  embedder(ref: ModelRef): Promise<EmbeddingProvider>;
  /** ids for new chunks (uuid v7 in production) */
  newId(): string;
  call?: Partial<DecisionCallContext>;
}

const EMBED_BATCH = 64;
const MAX_K = 100;

function addUsage(a: TokenUsage | null, b: TokenUsage): TokenUsage {
  return {
    ...(a ?? {}),
    inputTokens: (a?.inputTokens ?? 0) + b.inputTokens,
    outputTokens: (a?.outputTokens ?? 0) + b.outputTokens,
  };
}

export class KnowledgeService {
  constructor(private readonly deps: KnowledgeServiceDeps) {}

  private callCtx(): DecisionCallContext {
    return {
      signal: this.deps.call?.signal ?? new AbortController().signal,
      runId: this.deps.call?.runId ?? "knowledge",
      nodeRunId: this.deps.call?.nodeRunId ?? "knowledge",
      idempotencyKey: this.deps.call?.idempotencyKey ?? null,
    };
  }

  async sources(): Promise<KnowledgeSourceSummary[]> {
    return (await this.deps.store.listSources()).map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      status: s.status,
      embedding: s.pipeline.embedding ?? null,
      documents: s.documents,
      chunks: s.chunks,
    }));
  }

  private async source(id: string): Promise<SourceRecord> {
    const s = await this.deps.store.getSource(id);
    if (!s) throw new NotFoundError(`knowledge source ${id} not found`);
    return s;
  }

  /** Embeds texts in batches; returns vectors and the summed usage and cost. */
  async embed(
    ref: ModelRef,
    texts: string[],
  ): Promise<{ vectors: number[][]; usage: TokenUsage | null; costUsd: number }> {
    if (texts.length === 0) return { vectors: [], usage: null, costUsd: 0 };
    const provider = await this.deps.embedder(ref);
    const vectors: number[][] = [];
    let usage: TokenUsage | null = null;
    let costUsd = 0;
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const r = await provider.embed(texts.slice(i, i + EMBED_BATCH), this.callCtx());
      vectors.push(...r.vectors);
      usage = addUsage(usage, r.usage);
      costUsd += r.costUsd;
    }
    return { vectors, usage, costUsd };
  }

  /** Indexes one document through the source's pipeline (or its given chunks). */
  async upsertDocument(
    doc: KnowledgeDocumentInput,
    o: { force?: boolean; keepContent?: boolean } = {},
  ): Promise<KnowledgeUpsertResult> {
    const source = await this.source(doc.sourceId);
    if (!doc.externalId) throw new BadRequestError("externalId is required");
    if (doc.text === undefined && !doc.chunks) throw new BadRequestError("give text or chunks");
    const text = doc.text !== undefined ? normalize(doc.text, doc.mimeType ?? "text/plain") : null;
    const hash = contentHash(
      text ?? JSON.stringify(doc.chunks?.map((c) => [c.content, c.metadata ?? null]) ?? []),
    );
    const existing = await this.deps.store.getDocument(source.id, doc.externalId);
    const base: Omit<DocumentWrite, "chunkCount" | "status"> = {
      sourceId: source.id,
      externalId: doc.externalId,
      title: doc.title ?? null,
      uri: doc.uri ?? null,
      mimeType: doc.mimeType ?? null,
      contentHash: hash,
      metadata: doc.metadata ?? {},
      ...(o.keepContent && text !== null ? { content: text } : {}),
    };
    if (existing && existing.status === "indexed" && existing.contentHash === hash && !o.force)
      return {
        documentId: existing.id,
        chunks: existing.chunkCount,
        unchanged: true,
        usage: null,
        costUsd: 0,
      };

    const made: KnowledgeChunkInput[] =
      doc.chunks ??
      chunkText(text ?? "", { ...DEFAULT_CHUNKER, ...source.pipeline.chunker }).map((c) => ({
        content: c.content,
        tokens: c.tokens,
        metadata: { ...(c.heading ? { heading: c.heading } : {}) },
      }));
    const documentId = await this.deps.store.saveDocument({
      ...base,
      chunkCount: 0,
      status: "pending",
    });
    try {
      const ref = source.pipeline.embedding ?? null;
      const missing = made.map((c, i) => (c.embedding ? -1 : i)).filter((i) => i >= 0);
      const embedded = ref
        ? await this.embed(
            ref,
            missing.map((i) => made[i]?.content ?? ""),
          )
        : { vectors: [], usage: null, costUsd: 0 };
      const vectorAt = new Map(missing.map((i, j) => [i, embedded.vectors[j]]));
      const chunks: IndexedChunk[] = made.map((c, i) => ({
        id: this.deps.newId(),
        documentId,
        ordinal: i,
        content: c.content,
        tokens: c.tokens ?? estimateTokens(c.content),
        metadata: {
          ...(doc.metadata ?? {}),
          ...(c.metadata ?? {}),
          ...(doc.title ? { title: doc.title } : {}),
        },
        embedding: c.embedding ?? (ref ? (vectorAt.get(i) ?? null) : null),
      }));
      await (await this.deps.index(source)).upsert(source.id, documentId, chunks);
      await this.deps.store.saveDocument({ ...base, chunkCount: chunks.length, status: "indexed" });
      return {
        documentId,
        chunks: chunks.length,
        unchanged: false,
        usage: embedded.usage,
        costUsd: embedded.costUsd,
      };
    } catch (error) {
      await this.deps.store
        .saveDocument({ ...base, chunkCount: 0, status: "error" })
        .catch(() => undefined);
      throw error;
    }
  }

  async deleteDocument(sourceId: string, externalId: string): Promise<boolean> {
    const source = await this.source(sourceId);
    const id = await this.deps.store.deleteDocument(sourceId, externalId);
    if (!id) return false;
    await (await this.deps.index(source)).deleteDocument(sourceId, id);
    return true;
  }

  async search(req: KnowledgeSearchRequest): Promise<KnowledgeSearchResult> {
    if (!req.query.trim()) throw new BadRequestError("query is empty");
    const k = Math.min(Math.max(1, req.k ?? 5), MAX_K);
    const all = await this.deps.store.listSources();
    const sources = req.sourceIds.length
      ? req.sourceIds.map((id) => {
          const s = all.find((x) => x.id === id);
          if (!s) throw new NotFoundError(`knowledge source ${id} not found`);
          return s;
        })
      : all.filter((s) => s.status === "ready" || s.status === "stale");
    if (sources.length === 0)
      return { hits: [], mode: req.mode ?? "hybrid", usage: null, costUsd: 0 };

    // Group the sources by (index, embedding model): each group is one query per mode.
    const groups = new Map<
      string,
      { index: VectorIndexAdapter; ref: ModelRef | null; ids: string[] }
    >();
    for (const s of sources) {
      const index = await this.deps.index(s);
      const ref = s.pipeline.embedding ?? null;
      const key = `${index.kind}|${JSON.stringify(s.pipeline.index ?? {})}|${ref ? `${ref.provider}/${ref.model}` : "-"}`;
      const g = groups.get(key) ?? { index, ref, ids: [] };
      g.ids.push(s.id);
      groups.set(key, g);
    }

    const requested = req.mode ?? "hybrid";
    const fetchK = requested === "hybrid" ? Math.min(MAX_K, k * 4) : k;
    const vectorLists: IndexHit[][] = [];
    const keywordLists: IndexHit[][] = [];
    let usage: TokenUsage | null = null;
    let costUsd = 0;
    const embeddings = new Map<string, number[]>();
    let usedVector = false;
    let usedKeyword = false;
    for (const g of groups.values()) {
      const canVector = g.ref !== null;
      const canKeyword = g.index.supportsKeyword && typeof g.index.queryKeyword === "function";
      const doVector = canVector && requested !== "keyword";
      const doKeyword = canKeyword && (requested === "keyword" || requested === "hybrid");
      if (!doVector && !doKeyword)
        throw new BadRequestError(
          requested === "keyword"
            ? `the ${g.index.kind} index has no full-text search: use vector search`
            : "these sources have no embedding model: use keyword search",
        );
      if (doVector && g.ref) {
        const key = `${g.ref.provider}/${g.ref.model}`;
        let vector = embeddings.get(key);
        if (!vector) {
          const e = await this.embed(g.ref, [req.query]);
          vector = e.vectors[0] ?? [];
          embeddings.set(key, vector);
          if (e.usage) usage = addUsage(usage, e.usage);
          costUsd += e.costUsd;
        }
        vectorLists.push(await g.index.queryVector(g.ids, vector, fetchK, req.filter));
        usedVector = true;
      }
      if (doKeyword && g.index.queryKeyword) {
        keywordLists.push(await g.index.queryKeyword(g.ids, req.query, fetchK, req.filter));
        usedKeyword = true;
      }
    }

    const mode: KnowledgeSearchMode =
      usedVector && usedKeyword ? "hybrid" : usedVector ? "vector" : "keyword";
    let ranked: IndexHit[];
    if (mode === "hybrid") {
      const merge = (lists: IndexHit[][]) => lists.flat().sort((a, b) => b.score - a.score);
      ranked = reciprocalRankFusion(
        [merge(vectorLists), merge(keywordLists)],
        (h) => h.chunkId,
      ).map(({ item, score }) => ({ ...item, score }));
    } else {
      ranked = [...vectorLists, ...keywordLists].flat().sort((a, b) => b.score - a.score);
    }
    if (req.minScore !== undefined) ranked = ranked.filter((h) => h.score >= (req.minScore ?? 0));
    ranked = ranked.slice(0, k);

    const docs = await this.deps.store.documentsById([...new Set(ranked.map((h) => h.documentId))]);
    const hits: KnowledgeHit[] = ranked.flatMap((h) => {
      const d = docs.get(h.documentId);
      // a hit whose document was deleted since it was indexed is dropped
      return d ? [{ ...h, sourceId: d.sourceId, title: d.title, uri: d.uri }] : [];
    });
    return { hits, mode, usage, costUsd };
  }
}
