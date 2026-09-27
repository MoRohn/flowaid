/**
 * §15 Knowledge (RFC-0021; ARCHITECTURE.md §10.8): what retrieval nodes ask of a knowledge base,
 * and the `VectorIndexAdapter` every index backend implements (pgvector first; Qdrant, Pinecone,
 * Weaviate, Milvus, Chroma, Elasticsearch and OpenSearch through `@flowaid/knowledge`). The
 * runtime binds a workspace-scoped `KnowledgeAccess` into `ExecutionContext.knowledge` for nodes
 * that declare the `knowledge` capability.
 */
import type { JsonObject } from "./json.js";
import type { TokenUsage } from "./decision.js";

/** `vector`: embedding similarity; `keyword`: full-text rank; `hybrid`: both fused (reciprocal rank fusion). */
export type KnowledgeSearchMode = "vector" | "keyword" | "hybrid";

/** Equality filter on chunk metadata (every key must match). */
export type KnowledgeFilter = Record<string, string | number | boolean>;

/** One chunk as an index stores it. `embedding` is null for keyword-only sources. */
export interface IndexedChunk {
  id: string;
  documentId: string;
  ordinal: number;
  content: string;
  tokens: number;
  metadata: JsonObject;
  embedding: number[] | null;
}

/** A match from one index query; `score` is the backend's similarity or rank (higher is better). */
export interface IndexHit {
  chunkId: string;
  documentId: string;
  ordinal: number;
  content: string;
  metadata: JsonObject;
  score: number;
}

/** A vector index backend (ARCHITECTURE.md §10.8). All calls are scoped to one workspace by the adapter. */
export interface VectorIndexAdapter {
  readonly kind: string;
  /** full-text search is available (`queryKeyword`); hybrid search falls back to vector-only otherwise */
  readonly supportsKeyword: boolean;
  /** replaces every chunk of the document (idempotent) */
  upsert(sourceId: string, documentId: string, chunks: IndexedChunk[]): Promise<void>;
  queryVector(
    sourceIds: readonly string[],
    vector: number[],
    k: number,
    filter?: KnowledgeFilter,
  ): Promise<IndexHit[]>;
  queryKeyword?(
    sourceIds: readonly string[],
    text: string,
    k: number,
    filter?: KnowledgeFilter,
  ): Promise<IndexHit[]>;
  deleteDocument(sourceId: string, documentId: string): Promise<void>;
  deleteSource(sourceId: string): Promise<void>;
  stats(sourceId: string): Promise<{ documents: number; chunks: number }>;
}

/** A search over one or more knowledge sources. */
export interface KnowledgeSearchRequest {
  /** source ids; empty means every ready source of the workspace */
  sourceIds: string[];
  query: string;
  /** default `hybrid` (vector when the index has no full-text search; keyword when a source has no embedding model) */
  mode?: KnowledgeSearchMode;
  /** results to return (default 5, at most 100) */
  k?: number;
  filter?: KnowledgeFilter;
  /** drop hits whose score is below this (applied to the mode's own score) */
  minScore?: number;
}

export interface KnowledgeHit extends IndexHit {
  sourceId: string;
  title: string | null;
  uri: string | null;
}

export interface KnowledgeSearchResult {
  hits: KnowledgeHit[];
  /** the mode actually used */
  mode: KnowledgeSearchMode;
  usage: TokenUsage | null;
  costUsd: number;
}

/** A chunk handed to `upsertDocument` (from a chunker node); `embedding` optional. */
export interface KnowledgeChunkInput {
  content: string;
  tokens?: number;
  metadata?: JsonObject;
  embedding?: number[];
}

/** A document to index: whole `text` (chunked by the source's pipeline) or pre-made `chunks`. */
export interface KnowledgeDocumentInput {
  sourceId: string;
  externalId: string;
  title?: string;
  uri?: string;
  mimeType?: string;
  metadata?: JsonObject;
  text?: string;
  chunks?: KnowledgeChunkInput[];
}

export interface KnowledgeUpsertResult {
  documentId: string;
  chunks: number;
  /** the content hash matched the indexed version, so nothing was re-embedded */
  unchanged: boolean;
  usage: TokenUsage | null;
  costUsd: number;
}

export interface KnowledgeSourceSummary {
  id: string;
  name: string;
  kind: string;
  status: "new" | "syncing" | "ready" | "stale" | "error";
  /** the embedding model, or null for a keyword-only source */
  embedding: { provider: string; model: string } | null;
  documents: number;
  chunks: number;
}

/** Chunking settings of a source's pipeline (recursive by tokens with overlap). */
export interface ChunkerConfig {
  strategy: "recursive" | "markdown" | "fixed";
  chunkTokens: number;
  overlapTokens: number;
}
