/** Knowledge sources in the web app (API.md §3, `/v1/knowledge/*`): response shapes and form logic. */
import {
  DEFAULT_INDEX_MODEL,
  readConfig,
  type IndexMode,
  type IndexOptimize,
  type IndexProvider,
  type PageIndexConfig,
} from "./pageindex/model";

export type SourceKind = "files" | "text" | "url" | "sitemap" | "github" | "pageindex";
export type SourceStatus = "new" | "syncing" | "ready" | "stale" | "error";
export type SearchMode = "hybrid" | "vector" | "keyword";

export interface KnowledgeSource {
  id: string;
  name: string;
  kind: SourceKind;
  config: Record<string, unknown>;
  pipeline: {
    chunker?: { strategy?: string; chunkTokens?: number; overlapTokens?: number };
    embedding?: { provider: string; model: string } | null;
    index?: { adapter: string };
  };
  credentialId: string | null;
  status: SourceStatus;
  stats: { lastRun?: { indexed: number; unchanged: number; deleted: number; failed: number } };
  documents: number;
  chunks: number;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDocument {
  id: string;
  sourceId: string;
  externalId: string;
  title: string | null;
  uri: string | null;
  mimeType: string | null;
  status: "pending" | "indexed" | "error" | "deleted";
  chunkCount: number;
  metadata: Record<string, unknown>;
  error: string | null;
  updatedAt: string;
}

export interface KnowledgeChunk {
  id: string;
  ordinal: number;
  content: string;
  tokens: number;
  metadata: Record<string, unknown>;
  embedded: boolean;
}

export interface KnowledgeHit {
  chunkId: string;
  documentId: string;
  sourceId: string;
  ordinal: number;
  content: string;
  score: number;
  title: string | null;
  uri: string | null;
  metadata: Record<string, unknown>;
}

export interface QueryResult {
  hits: KnowledgeHit[];
  mode: SearchMode;
  costUsd: number;
}

export const KIND_LABEL: Record<SourceKind, string> = {
  files: "Uploaded files",
  text: "Pasted text",
  url: "Web pages",
  sitemap: "Sitemap",
  github: "GitHub repository",
  pageindex: "PageIndex documents (PDF)",
};

/** PDFs indexed into section trees by the PageIndex service (docs/pageindex/API.md). */
export const isPageIndexKind = (kind: SourceKind): boolean => kind === "pageindex";

/** Uploads are added by hand; the other kinds are fetched by the sync job. */
export const isUploadKind = (kind: SourceKind): boolean => kind === "files" || kind === "text";

export function sourceTone(status: SourceStatus): "ok" | "danger" | "accent" | "warn" | "neutral" {
  if (status === "ready") return "ok";
  if (status === "error") return "danger";
  if (status === "syncing") return "accent";
  if (status === "stale") return "warn";
  return "neutral";
}

export function documentTone(status: KnowledgeDocument["status"]): "ok" | "danger" | "neutral" {
  return status === "indexed" ? "ok" : status === "error" ? "danger" : "neutral";
}

/** One URL per line (blank lines and surrounding space ignored). */
export function parseUrls(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Lines that are not http(s) web addresses (FlowAId only fetches those). */
export function badUrls(text: string): string[] {
  return parseUrls(text).filter((u) => {
    try {
      const url = new URL(u);
      return url.protocol !== "http:" && url.protocol !== "https:";
    } catch {
      return true;
    }
  });
}

const notWeb = (bad: string[]) =>
  `Not a web address (http:// or https://): ${bad.slice(0, 3).join(", ")}${bad.length > 3 ? ` and ${bad.length - 3} more` : ""}`;

/** The field error for a list of page URLs, or a sitemap URL. */
export function urlFieldError(text: string): string | undefined {
  const bad = badUrls(text);
  return bad.length ? notWeb(bad) : undefined;
}

export interface SourceForm {
  name: string;
  kind: SourceKind;
  /** url: one per line; sitemap: the sitemap URL */
  urls: string;
  /** sitemap: URL prefixes to keep, one per line */
  include: string;
  repo: string;
  ref: string;
  path: string;
  /** "" = keyword search only */
  embeddingProvider: string;
  embeddingModel: string;
  strategy: "recursive" | "markdown" | "fixed";
  chunkTokens: number;
  overlapTokens: number;
  credentialId: string | null;
  /** pageindex: the model that writes section summaries */
  indexProvider: IndexProvider;
  indexModel: string;
  /** pageindex: a workspace credential of the model's type (null: the server key) */
  indexCredentialId: string | null;
  indexMode: IndexMode;
  indexOptimize: IndexOptimize;
}

export const EMPTY_SOURCE: SourceForm = {
  name: "",
  kind: "files",
  urls: "",
  include: "",
  repo: "",
  ref: "",
  path: "",
  embeddingProvider: "openai",
  embeddingModel: "text-embedding-3-small",
  strategy: "recursive",
  chunkTokens: 400,
  overlapTokens: 60,
  credentialId: null,
  indexProvider: "ollama",
  indexModel: DEFAULT_INDEX_MODEL.ollama,
  indexCredentialId: null,
  indexMode: "flash",
  indexOptimize: "off",
};

/** What the form is missing (null when it can be submitted). */
export function sourceFormError(f: SourceForm): string | null {
  if (!f.name.trim()) return "Give the source a name";
  if (f.kind === "url" && parseUrls(f.urls).length === 0) return "Add at least one URL";
  if (f.kind === "sitemap" && !f.urls.trim()) return "Add the sitemap URL";
  if ((f.kind === "url" || f.kind === "sitemap") && badUrls(f.urls).length)
    return notWeb(badUrls(f.urls));
  if (f.kind === "github" && !/^[\w.-]+\/[\w.-]+$/.test(f.repo.trim()))
    return "Name the repository as owner/name";
  if (f.kind === "pageindex") return f.indexModel.trim() ? null : "Name the indexing model";
  if (f.embeddingProvider.trim() && !f.embeddingModel.trim()) return "Name the embedding model";
  if (f.overlapTokens >= f.chunkTokens) return "Overlap must be smaller than the chunk size";
  return null;
}

function loaderConfig(f: SourceForm): Record<string, unknown> {
  switch (f.kind) {
    case "url":
      return { urls: parseUrls(f.urls) };
    case "sitemap": {
      const include = parseUrls(f.include);
      return { url: f.urls.trim(), ...(include.length ? { include } : {}) };
    }
    case "github":
      return {
        repo: f.repo.trim(),
        ...(f.ref.trim() ? { ref: f.ref.trim() } : {}),
        ...(f.path.trim() ? { path: f.path.trim() } : {}),
      };
    case "pageindex": {
      const config: PageIndexConfig = {
        indexModel: { provider: f.indexProvider, model: f.indexModel.trim() },
        credentialId: f.indexCredentialId,
        mode: f.indexMode,
        optimize: f.indexOptimize,
      };
      return { ...config };
    }
    case "files":
    case "text":
      return {};
  }
}

/** The `POST /v1/knowledge/sources` body. */
export function sourceBody(f: SourceForm): Record<string, unknown> {
  // PageIndex builds its own section tree: no chunker, embedding or source-level credential
  if (f.kind === "pageindex") return { name: f.name.trim(), kind: f.kind, config: loaderConfig(f) };
  return {
    name: f.name.trim(),
    kind: f.kind,
    config: loaderConfig(f),
    pipeline: {
      chunker: { strategy: f.strategy, chunkTokens: f.chunkTokens, overlapTokens: f.overlapTokens },
      embedding: f.embeddingProvider.trim()
        ? { provider: f.embeddingProvider.trim(), model: f.embeddingModel.trim() }
        : null,
    },
    ...(f.credentialId ? { credentialId: f.credentialId } : {}),
  };
}

const strOf = (v: unknown): string => (typeof v === "string" ? v : "");
const linesOf = (v: unknown): string =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").join("\n") : "";

/** A saved source as the form (the inverse of `sourceBody`), for its Settings. */
export function formOf(src: KnowledgeSource): SourceForm {
  const c = src.config;
  const chunker = src.pipeline.chunker ?? {};
  const embedding = src.pipeline.embedding ?? null;
  const pi = src.kind === "pageindex" ? readConfig(c) : null;
  return {
    ...EMPTY_SOURCE,
    name: src.name,
    kind: src.kind,
    urls:
      src.kind === "url"
        ? linesOf(c.urls) || strOf(c.url)
        : src.kind === "sitemap"
          ? strOf(c.url)
          : "",
    include: src.kind === "sitemap" ? linesOf(c.include) : "",
    repo: src.kind === "github" ? strOf(c.repo) : "",
    ref: src.kind === "github" ? strOf(c.ref) : "",
    path: src.kind === "github" ? strOf(c.path) : "",
    embeddingProvider: embedding?.provider ?? "",
    embeddingModel: embedding?.model ?? "",
    strategy:
      chunker.strategy === "markdown" || chunker.strategy === "fixed"
        ? chunker.strategy
        : "recursive",
    chunkTokens: chunker.chunkTokens ?? EMPTY_SOURCE.chunkTokens,
    overlapTokens: chunker.overlapTokens ?? EMPTY_SOURCE.overlapTokens,
    credentialId: src.credentialId,
    ...(pi
      ? {
          indexProvider: pi.indexModel.provider,
          indexModel: pi.indexModel.model,
          indexCredentialId: pi.credentialId,
          indexMode: pi.mode,
          indexOptimize: pi.optimize,
        }
      : {}),
  };
}

/** The config keys the form edits, per kind (`loaderConfig`). */
const CONFIG_KEYS: Record<SourceKind, readonly string[]> = {
  url: ["urls", "url"],
  sitemap: ["url", "include"],
  github: ["repo", "ref", "path"],
  pageindex: ["indexModel", "credentialId", "mode", "optimize"],
  files: [],
  text: [],
};

/** Key order and missing fields do not make two values differ. */
const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, sorted(x)]),
    );
  return v;
}

export interface SourcePatch {
  /** the `PATCH /v1/knowledge/sources/:id` body: only what changed */
  body: Record<string, unknown>;
  /** chunking or the embedding changed: every document is indexed again */
  reindex: boolean;
  /** where documents come from changed (a fetched kind): they are fetched again */
  refetch: boolean;
}

/**
 * What saving a source's Settings sends. The pipeline goes whole (the API replaces it), keeping
 * what the form doesn't show (a remote index); the embedding's own credential is dropped when the
 * provider changes, since it belongs to the old one.
 */
export function sourcePatch(src: KnowledgeSource, f: SourceForm): SourcePatch {
  const body: Record<string, unknown> = {};
  if (f.name.trim() !== src.name) body.name = f.name.trim();
  // the config keys the form edits are replaced; any other (set through the API) is kept
  const kept = Object.fromEntries(
    Object.entries(src.config).filter(([k]) => !CONFIG_KEYS[src.kind].includes(k)),
  );
  const config = { ...kept, ...loaderConfig(f) };
  if (!isUploadKind(src.kind) && !same(config, src.config)) body.config = config;
  if (src.kind === "github" && (f.credentialId ?? null) !== (src.credentialId ?? null))
    body.credentialId = f.credentialId;
  let reindex = false;
  if (src.kind !== "pageindex") {
    const before = formOf(src);
    const chunker = {
      strategy: f.strategy,
      chunkTokens: f.chunkTokens,
      overlapTokens: f.overlapTokens,
    };
    const embedding = f.embeddingProvider.trim()
      ? { provider: f.embeddingProvider.trim(), model: f.embeddingModel.trim() }
      : null;
    const chunkerChanged =
      chunker.strategy !== before.strategy ||
      chunker.chunkTokens !== before.chunkTokens ||
      chunker.overlapTokens !== before.overlapTokens;
    const embeddingChanged = !same(embedding, src.pipeline.embedding ?? null);
    if (chunkerChanged || embeddingChanged) {
      const { embeddingCredentialId, ...rest } = src.pipeline as Record<string, unknown>;
      const keepCredential =
        embeddingCredentialId !== undefined &&
        embedding?.provider === (src.pipeline.embedding?.provider ?? null);
      body.pipeline = {
        ...rest,
        chunker,
        embedding,
        ...(keepCredential ? { embeddingCredentialId } : {}),
      };
      reindex = true;
    }
  }
  return {
    body,
    reindex,
    refetch: body.config !== undefined && !isUploadKind(src.kind) && src.kind !== "pageindex",
  };
}

/** A MIME type for an uploaded file, by extension (the API accepts these four). */
export function mimeOf(
  filename: string,
): "text/plain" | "text/markdown" | "text/html" | "application/json" {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "md" || ext === "mdx" || ext === "markdown") return "text/markdown";
  if (ext === "html" || ext === "htm") return "text/html";
  if (ext === "json") return "application/json";
  return "text/plain";
}

/** A short "3 documents · 41 chunks" line (PageIndex sources have no chunks). */
export function countsLine(
  s: Pick<KnowledgeSource, "documents" | "chunks"> & { kind?: SourceKind },
): string {
  const p = (n: number, one: string) => `${n.toLocaleString("en-US")} ${one}${n === 1 ? "" : "s"}`;
  if (s.kind === "pageindex") return p(s.documents, "document");
  return `${p(s.documents, "document")} · ${p(s.chunks, "chunk")}`;
}

/** An embedding model a source can use, and whether this workspace can call it yet. */
export interface EmbeddingOption {
  provider: string;
  model: string;
  /** a server key, a workspace credential, or (Ollama) a configured server */
  ready: boolean;
}

/**
 * The embedding models of the registry, ready ones first. A provider is ready with a server key
 * (`configuredOnServer`) or a workspace credential of its type.
 */
export function embeddingOptions(
  models: readonly { provider: string; model: string; kind: string; deprecated?: boolean }[],
  providers: readonly { id: string; configuredOnServer: boolean }[],
  credentialTypes: ReadonlySet<string>,
): EmbeddingOption[] {
  const server = new Set(providers.filter((p) => p.configuredOnServer).map((p) => p.id));
  const keyType = (id: string) => (id === "ollama" ? "ollama.host" : `${id}.api_key`);
  return models
    .filter((m) => m.kind === "embedding" && !m.deprecated)
    .map((m) => ({
      provider: m.provider,
      model: m.model,
      ready: server.has(m.provider) || credentialTypes.has(keyType(m.provider)),
    }))
    .sort(
      (a, b) =>
        Number(b.ready) - Number(a.ready) ||
        a.provider.localeCompare(b.provider) ||
        a.model.localeCompare(b.model),
    );
}

/** What to do about an indexing error: fix a key (Credentials), or retry once the cause is gone. */
export function indexingErrorFix(message: string): "credentials" | "retry" {
  return /credential|api[ _-]?key|unauthori[sz]ed|\b401\b|\b403\b|forbidden/i.test(message)
    ? "credentials"
    : "retry";
}
