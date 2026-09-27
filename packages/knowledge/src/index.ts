/**
 * `@flowaid/knowledge` — knowledge bases and retrieval (ARCHITECTURE.md §10.8): loaders,
 * normalisation, the token chunker, reciprocal rank fusion, the knowledge service behind
 * `ctx.knowledge`, and the remote `VectorIndexAdapter`s. The pgvector adapter lives in
 * `@flowaid/database` next to the tables it uses.
 */
export { DEFAULT_CHUNKER, chunkText, estimateTokens, type TextChunk } from "./chunk.js";
export {
  contentHash,
  decodeEntities,
  htmlTitle,
  htmlToMarkdown,
  normalize,
  tidy,
} from "./normalize.js";
export {
  loadGithub,
  loadSitemap,
  loadText,
  loadUrl,
  sitemapLocations,
  type GithubOptions,
  type LoadOptions,
  type LoadedDocument,
  type SitemapOptions,
} from "./loaders.js";
export { RRF_K, reciprocalRankFusion } from "./fusion.js";
export { MemoryIndex, cosine, matchesFilter, terms } from "./adapters/memory.js";
export {
  ChromaIndex,
  ElasticsearchIndex,
  MilvusIndex,
  OpenSearchIndex,
  PineconeIndex,
  QdrantIndex,
  REMOTE_INDEX_KINDS,
  WeaviateIndex,
  remoteIndex,
  type RemoteIndexConfig,
  type RemoteIndexKind,
} from "./adapters/http.js";
export {
  KnowledgeService,
  type DocumentRecord,
  type DocumentWrite,
  type KnowledgeServiceDeps,
  type KnowledgeStore,
  type SourcePipeline,
  type SourceRecord,
} from "./service.js";
export { MemoryKnowledgeStore } from "./memoryStore.js";
export { fakeEmbeddingProvider, hashedEmbedding } from "./fakeEmbedding.js";
