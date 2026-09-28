/**
 * PageIndex behind the API's routes (docs/pageindex/API.md, RFC-0022): source settings, PDF
 * uploads into immutable document versions, index requests, deletion, and the query playground
 * (retrieval by navigating section trees with the workspace's decision chain, then an optional
 * answer whose citations are checked against the evidence).
 *
 * The lifecycle rules live in `PgDocumentIndexes` (database); this module only composes them.
 * The indexing itself is the worker's `pageindex.index` job; upstream cleanup is its
 * `pageindex.cleanup` job, except when a whole source goes (see `deletePageIndexSource`).
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import {
  artifacts,
  createDocumentVersion,
  credentials,
  documentIndexes,
  documentVersions,
  documents,
  knowledgeSources,
  markIndexRemoteDeleted,
  requestDocumentIndex,
  resolveDocumentIndexes,
  revokeDocumentIndexes,
  toDocumentReference,
  toIndexReference,
  type DocumentIndexRow,
  type DocumentVersionRow,
  type Tx,
} from "@flowaid/database";
import {
  ANSWER_INSTRUCTIONS,
  INSUFFICIENT_MARKER,
  LOCAL_CAPABILITIES,
  PageIndexServiceClient,
  PageIndexServiceError,
  PageIndexSourceConfigSchema,
  checkCitations,
  evidenceForPrompt,
  indexRequestFromSource,
  retrieveEvidence,
  type Navigator,
  type PageIndexSourceConfig,
  type RetrievalBudget,
  type SupportJudge,
} from "@flowaid/pageindex";
import { uuidv7, wrapUntrusted } from "@flowaid/shared";
import {
  LocalArtifactStore,
  S3ArtifactStore,
  artifactStorage,
  type ArtifactStorage,
  type ArtifactStore,
} from "@flowaid/storage";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  toFlowaidError,
  type DecisionCallContext,
  type DecisionProvider,
  type DocumentReference,
  type DocumentScope,
  type GroundedAnswer,
  type IndexReference,
  type JsonObject,
  type ModelRef,
  type OutlineNode,
  type RetrievalResult,
} from "@flowaid/workflow-core";
import type { ApiConfig, ApiContext } from "../context.js";
import { OutlineNodeSchema } from "../dto/pageindex.js";
import { ApiError } from "../plugins/errors.js";
import { advisorModel, registryOf, resolveContext, workspaceDecisionHops } from "./advisor.js";

type DocumentRow = typeof documents.$inferSelect;
type SourceRow = typeof knowledgeSources.$inferSelect;

/** Uploads are PDFs of at most 50 MiB. */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;
/** Documents one query may navigate (RetrievalBudget.maxDocuments). */
export const MAX_QUERY_DOCUMENTS = 5;
const PDF_MAGIC = Buffer.from("%PDF-", "latin1");

// ── configuration ─────────────────────────────────────────────────────────────────────────

export function pageIndexEnabled(config: ApiConfig): boolean {
  return config.pageIndex !== null && !config.featuresDisabled.includes("pageindex");
}

/** The service's URL and token; 409 PAGEINDEX_DISABLED when it is not configured. */
export function requirePageIndex(config: ApiConfig): { url: string; token: string } {
  if (!config.pageIndex || !pageIndexEnabled(config))
    throw new ApiError(
      409,
      "PAGEINDEX_DISABLED",
      "PageIndex is off: set FLOWAID_PAGEINDEX_URL and FLOWAID_PAGEINDEX_TOKEN (or start with --pageindex)",
    );
  return config.pageIndex;
}

export function serviceClient(config: ApiConfig, timeoutMs?: number): PageIndexServiceClient {
  const { url, token } = requirePageIndex(config);
  return new PageIndexServiceClient({
    baseUrl: url,
    token,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
}

/** The artifact storage the worker reads uploads from (S3 when configured, else local). */
export function apiArtifactStorage(config: ApiConfig): ArtifactStorage | null {
  const stores: ArtifactStore[] = [
    ...(config.s3 ? [new S3ArtifactStore(config.s3)] : []),
    ...(config.artifactsDir ? [new LocalArtifactStore(config.artifactsDir)] : []),
  ];
  const [primary, ...others] = stores;
  return primary ? artifactStorage(primary, ...others) : null;
}

/** A service failure as the API reports it: 503 PAGEINDEX_UNAVAILABLE when it did not answer. */
function serviceFailure(error: unknown): unknown {
  if (error instanceof PageIndexServiceError && (error.transient || error.status >= 500))
    return new ApiError(503, "PAGEINDEX_UNAVAILABLE", error.message, true);
  return error;
}

// ── source settings ───────────────────────────────────────────────────────────────────────

const CREDENTIAL_TYPES: Record<PageIndexSourceConfig["indexModel"]["provider"], string[]> = {
  openai: ["openai.api_key"],
  anthropic: ["anthropic.api_key"],
  ollama: ["ollama.host", "ollama.none"],
};

/**
 * Validates a `pageindex` source's config (`PageIndexSourceConfigSchema`, shared with the
 * worker) and its credential, which must be the workspace's and of the model's type. Returns
 * the config normalised (defaults filled in).
 */
export async function checkPageIndexConfig(
  tx: Tx,
  workspaceId: string,
  raw: unknown,
): Promise<PageIndexSourceConfig> {
  const parsed = PageIndexSourceConfigSchema.safeParse(raw);
  if (!parsed.success)
    throw new BadRequestError(
      `a pageindex source needs config.indexModel ({ provider: openai | anthropic | ollama, model }); ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "config"}: ${i.message}`)
        .join("; ")}`,
    );
  const config = parsed.data;
  if (config.credentialId) {
    const [c] = await tx
      .select({ type: credentials.type })
      .from(credentials)
      .where(
        and(eq(credentials.id, config.credentialId), eq(credentials.workspaceId, workspaceId)),
      );
    if (!c) throw new BadRequestError("credential not found");
    const accepted = CREDENTIAL_TYPES[config.indexModel.provider];
    if (!accepted.includes(c.type))
      throw new BadRequestError(
        `a ${config.indexModel.provider} index model needs a ${accepted.join(" or ")} credential, not ${c.type}`,
      );
  }
  return config;
}

/**
 * What `requestDocumentIndex` records for a source's current settings (the same parser and
 * hash the worker uses). A source whose stored config is not a PageIndex one fails clearly.
 */
function indexSettings(source: SourceRow): {
  configHash: string;
  settings: JsonObject;
  indexModel: string;
} {
  let request: ReturnType<typeof indexRequestFromSource>;
  try {
    request = indexRequestFromSource(source.config);
  } catch (error) {
    throw new ConflictError(
      `the source ${source.name} has no valid PageIndex settings: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const s = request.settings;
  return {
    configHash: request.configHash,
    settings: {
      model: { provider: s.model.provider, model: s.model.model },
      mode: s.mode,
      optimize: s.optimize,
      credentialId: s.credentialId,
    },
    indexModel: request.indexModel,
  };
}

// ── references ────────────────────────────────────────────────────────────────────────────

export function indexReference(
  row: DocumentIndexRow,
  version: Pick<DocumentVersionRow, "version" | "fileName">,
  title: string | null,
): IndexReference {
  return toIndexReference(row, version, title, LOCAL_CAPABILITIES);
}

export interface DocumentSummary {
  documentId: string;
  title: string;
  status: DocumentRow["status"];
  versions: number;
  latestVersion: DocumentReference;
  activeIndex: IndexReference | null;
  latestIndex: IndexReference | null;
}

export interface DocumentDetail {
  document: DocumentSummary;
  versions: DocumentReference[];
  indexes: IndexReference[];
}

/** Summaries (with every version and index) of documents, in the order given. */
async function details(
  tx: Tx,
  workspaceId: string,
  docs: DocumentRow[],
): Promise<DocumentDetail[]> {
  if (!docs.length) return [];
  const ids = docs.map((d) => d.id);
  const versions = await tx
    .select()
    .from(documentVersions)
    .where(
      and(eq(documentVersions.workspaceId, workspaceId), inArray(documentVersions.documentId, ids)),
    )
    .orderBy(desc(documentVersions.version));
  const indexes = await tx
    .select()
    .from(documentIndexes)
    .where(
      and(eq(documentIndexes.workspaceId, workspaceId), inArray(documentIndexes.documentId, ids)),
    )
    .orderBy(desc(documentIndexes.indexVersion));
  const out: DocumentDetail[] = [];
  for (const d of docs) {
    const vs = versions.filter((v) => v.documentId === d.id);
    const latest = vs[0];
    // a document row without a version is a failed upload: nothing to show
    if (!latest) continue;
    const byId = new Map(vs.map((v) => [v.id, v]));
    const refs = indexes
      .filter((i) => i.documentId === d.id)
      .flatMap((i) => {
        const v = byId.get(i.versionId);
        return v ? [indexReference(i, v, d.title)] : [];
      });
    out.push({
      document: {
        documentId: d.id,
        title: d.title ?? latest.fileName,
        status: d.status,
        versions: vs.length,
        latestVersion: toDocumentReference(d, latest),
        activeIndex: refs.find((r) => r.active) ?? null,
        latestIndex: refs[0] ?? null,
      },
      versions: vs.map((v) => toDocumentReference(d, v)),
      indexes: refs,
    });
  }
  return out;
}

export async function loadPageIndexSource(
  tx: Tx,
  workspaceId: string,
  sourceId: string,
): Promise<SourceRow> {
  const [s] = await tx
    .select()
    .from(knowledgeSources)
    .where(and(eq(knowledgeSources.id, sourceId), eq(knowledgeSources.workspaceId, workspaceId)));
  if (!s) throw new NotFoundError("knowledge source not found");
  if (s.kind !== "pageindex")
    throw new BadRequestError(`the source ${s.name} is a ${s.kind} source, not a pageindex one`);
  return s;
}

/** A live (not deleted) document of a pageindex source in this workspace. */
async function loadDocument(tx: Tx, workspaceId: string, documentId: string) {
  const [row] = await tx
    .select({ doc: documents, source: knowledgeSources })
    .from(documents)
    .innerJoin(knowledgeSources, eq(knowledgeSources.id, documents.sourceId))
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.workspaceId, workspaceId),
        eq(knowledgeSources.kind, "pageindex"),
        ne(documents.status, "deleted"),
      ),
    );
  if (!row) throw new NotFoundError("document not found");
  return row;
}

export async function listDocuments(
  tx: Tx,
  workspaceId: string,
  sourceId: string,
): Promise<DocumentSummary[]> {
  await loadPageIndexSource(tx, workspaceId, sourceId);
  const docs = await tx
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.workspaceId, workspaceId),
        eq(documents.sourceId, sourceId),
        ne(documents.status, "deleted"),
      ),
    )
    // ids are uuidv7: newest first
    .orderBy(desc(documents.id))
    .limit(1000);
  return (await details(tx, workspaceId, docs)).map((d) => d.document);
}

export async function documentDetail(
  tx: Tx,
  workspaceId: string,
  documentId: string,
): Promise<DocumentDetail> {
  const { doc } = await loadDocument(tx, workspaceId, documentId);
  const [out] = await details(tx, workspaceId, [doc]);
  if (!out) throw new NotFoundError("document not found");
  return out;
}

/** An index of a live document in this workspace, with its version and the document title. */
export async function loadIndex(tx: Tx, workspaceId: string, indexId: string) {
  const [row] = await tx
    .select({ row: documentIndexes, version: documentVersions, title: documents.title })
    .from(documentIndexes)
    .innerJoin(documentVersions, eq(documentVersions.id, documentIndexes.versionId))
    .innerJoin(documents, eq(documents.id, documentIndexes.documentId))
    .where(
      and(
        eq(documentIndexes.workspaceId, workspaceId),
        eq(documentIndexes.id, indexId),
        ne(documents.status, "deleted"),
      ),
    );
  if (!row) throw new NotFoundError("index not found");
  return row;
}

/** The stored section tree of an index (titles, spans, summaries; no page text). */
export function outlineOf(row: DocumentIndexRow): OutlineNode[] {
  const parsed = z.array(OutlineNodeSchema).safeParse(row.outline ?? []);
  if (!parsed.success) throw new ConflictError("the index's outline is not readable");
  return parsed.data;
}

// ── uploads and index requests ───────────────────────────────────────────────────────────

/** `X-File-Name`: URL-decoded, no path, no control characters, at most 255 characters. */
export function cleanFileName(header: unknown): string {
  if (typeof header !== "string" || !header.trim()) return "document.pdf";
  let name = header;
  try {
    name = decodeURIComponent(header);
  } catch {
    // not URL-encoded: use it as sent
  }
  name = (name.split(/[/\\]/).pop() ?? "")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || name === "." || name === "..") return "document.pdf";
  return [...name].slice(0, 255).join("");
}

export function isPdf(bytes: Buffer): boolean {
  return bytes.length >= PDF_MAGIC.length && bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
}

export interface UploadResult {
  document: DocumentSummary;
  version: DocumentReference;
  index: IndexReference;
  /** a new version was stored (false: the same bytes were uploaded before) */
  created: boolean;
}

/**
 * Stores a PDF as a new version of a document (a new document unless `documentId` is given) and
 * requests its index with the source's settings. The same bytes again return the existing
 * version (and join its index). The bytes are written to artifact storage before the rows, and
 * removed again when the rows are not written.
 */
export async function uploadDocument(
  ctx: ApiContext,
  workspaceId: string,
  input: { sourceId: string; documentId?: string | undefined; fileName: string; bytes: Buffer },
): Promise<UploadResult> {
  requirePageIndex(ctx.config);
  if (!isPdf(input.bytes))
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "the body is not a PDF (no %PDF- header)");
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");

  const prior = await ctx.db.tenant(workspaceId, async (tx) => {
    const source = await loadPageIndexSource(tx, workspaceId, input.sourceId);
    let doc: DocumentRow | null = null;
    if (input.documentId) {
      const found = await loadDocument(tx, workspaceId, input.documentId);
      if (found.doc.sourceId !== source.id) throw new NotFoundError("document not found");
      doc = found.doc;
    }
    const [existing] = await tx
      .select({ version: documentVersions, doc: documents })
      .from(documentVersions)
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .where(
        and(
          eq(documentVersions.workspaceId, workspaceId),
          eq(documentVersions.sha256, sha256),
          doc
            ? eq(documentVersions.documentId, doc.id)
            : and(eq(documents.sourceId, source.id), ne(documents.status, "deleted")),
        ),
      )
      .limit(1);
    if (!existing) return { source, doc, done: null };
    const index = await requestDocumentIndex(tx, {
      workspaceId,
      sourceId: source.id,
      documentId: existing.doc.id,
      versionId: existing.version.id,
      ...indexSettings(source),
    });
    return { source, doc, done: { ...existing, index } };
  });

  let outcome: {
    doc: DocumentRow;
    version: DocumentVersionRow;
    index: { row: DocumentIndexRow; created: boolean };
    created: boolean;
  };
  if (prior.done) {
    outcome = { ...prior.done, created: false };
  } else {
    const storage = apiArtifactStorage(ctx.config);
    if (!storage)
      throw new ApiError(
        503,
        "STORAGE_UNAVAILABLE",
        "artifact storage is not available to the API",
      );
    const artifactId = uuidv7();
    const key = `ws/${workspaceId}/${artifactId}`;
    await storage.primary.put(key, input.bytes, "application/pdf");
    let keep = false;
    try {
      outcome = await ctx.db.tenant(workspaceId, async (tx) => {
        await tx.insert(artifacts).values({
          id: artifactId,
          workspaceId,
          name: input.fileName,
          mimeType: "application/pdf",
          bytes: input.bytes.byteLength,
          sha256,
          storage: storage.primary.kind,
          storageKey: key,
          kind: "upload",
          status: "ready",
        });
        let doc = prior.doc;
        if (doc) {
          const [updated] = await tx
            .update(documents)
            .set({ contentHash: sha256, updatedAt: new Date() })
            .where(eq(documents.id, doc.id))
            .returning();
          doc = updated ?? doc;
        } else {
          const [inserted] = await tx
            .insert(documents)
            .values({
              id: uuidv7(),
              workspaceId,
              sourceId: prior.source.id,
              externalId: uuidv7(),
              title: input.fileName,
              mimeType: "application/pdf",
              contentHash: sha256,
              status: "pending",
            })
            .returning();
          if (!inserted) throw new Error("document insert returned nothing");
          doc = inserted;
        }
        const { version, created } = await createDocumentVersion(tx, {
          workspaceId,
          documentId: doc.id,
          sha256,
          bytes: input.bytes.byteLength,
          mediaType: "application/pdf",
          fileName: input.fileName,
          artifactId,
          pageCount: null,
        });
        // a concurrent upload of the same bytes won: this copy is not needed
        if (!created) await tx.delete(artifacts).where(eq(artifacts.id, artifactId));
        keep = created;
        const index = await requestDocumentIndex(tx, {
          workspaceId,
          sourceId: prior.source.id,
          documentId: doc.id,
          versionId: version.id,
          ...indexSettings(prior.source),
        });
        return { doc, version, index, created };
      });
    } finally {
      if (!keep) await storage.primary.delete(key).catch(() => undefined);
    }
  }
  if (outcome.index.created) await enqueueIndex(ctx, workspaceId, outcome.index.row.id);
  const detail = await ctx.db.tenant(workspaceId, (tx) =>
    documentDetail(tx, workspaceId, outcome.doc.id),
  );
  return {
    document: detail.document,
    version: toDocumentReference(outcome.doc, outcome.version),
    index: indexReference(outcome.index.row, outcome.version, outcome.doc.title),
    created: outcome.created,
  };
}

function enqueueIndex(ctx: ApiContext, workspaceId: string, indexId: string): Promise<void> {
  return ctx.queue.enqueue(
    "ingest",
    { type: "pageindex.index", workspaceId, indexId },
    { jobId: `pageindex:${indexId}` },
  );
}

function enqueueCleanup(ctx: ApiContext, workspaceId: string, documentId: string): Promise<void> {
  return ctx.queue.enqueue(
    "ingest",
    { type: "pageindex.cleanup", workspaceId, documentId },
    { jobId: `pageindex-cleanup:${documentId}` },
  );
}

/** Builds (or joins) the index of the document's latest version with the source's settings. */
export async function requestIndex(
  ctx: ApiContext,
  workspaceId: string,
  documentId: string,
): Promise<{ index: IndexReference; created: boolean }> {
  requirePageIndex(ctx.config);
  const out = await ctx.db.tenant(workspaceId, async (tx) => {
    const { doc, source } = await loadDocument(tx, workspaceId, documentId);
    const [version] = await tx
      .select()
      .from(documentVersions)
      .where(
        and(eq(documentVersions.workspaceId, workspaceId), eq(documentVersions.documentId, doc.id)),
      )
      .orderBy(desc(documentVersions.version))
      .limit(1);
    if (!version) throw new NotFoundError("the document has no uploaded version");
    const index = await requestDocumentIndex(tx, {
      workspaceId,
      sourceId: source.id,
      documentId: doc.id,
      versionId: version.id,
      ...indexSettings(source),
    });
    return { index: indexReference(index.row, version, doc.title), created: index.created };
  });
  if (out.created) await enqueueIndex(ctx, workspaceId, out.index.indexId);
  return out;
}

// ── deletion ──────────────────────────────────────────────────────────────────────────────

/**
 * Revokes a document at once (its indexes become `deleted`, the document `deleted`, reads stop)
 * and queues the upstream cleanup. Nothing is removed from the service or storage here.
 */
export async function deleteDocument(
  ctx: ApiContext,
  workspaceId: string,
  documentId: string,
): Promise<void> {
  await ctx.db.tenant(workspaceId, async (tx) => {
    await loadDocument(tx, workspaceId, documentId);
    await revokeDocumentIndexes(tx, workspaceId, documentId);
    await tx
      .update(documents)
      .set({ status: "deleted", updatedAt: new Date() })
      .where(and(eq(documents.id, documentId), eq(documents.workspaceId, workspaceId)));
  });
  await enqueueCleanup(ctx, workspaceId, documentId);
}

/**
 * Deletes a pageindex source without losing track of what it left upstream. The source row's
 * cascade removes the document and index rows the worker's `pageindex.cleanup` job reads, so
 * the source cannot simply go first. The order:
 *
 * 1. revoke every document (indexes `deleted`, documents `deleted`) and queue its cleanup job,
 *    so access stops at once and the cleanup is on record even if the rest fails;
 * 2. do what the cleanup job does, here and now: remove every upstream document (and stop
 *    service jobs of builds that were submitted), then the stored files;
 * 3. delete the source row once nothing is left upstream (the queued cleanups then find no
 *    document and skip).
 *
 * When the service is off or does not answer, step 2 fails with 409 / 503: the source stays,
 * its documents revoked and their cleanup jobs queued (the worker finishes them, or deleting the
 * source again does). A build still running when its row disappears is not promoted; the
 * worker's index job removes its upstream document.
 */
export async function deletePageIndexSource(
  ctx: ApiContext,
  workspaceId: string,
  sourceId: string,
): Promise<void> {
  const docIds = await ctx.db.tenant(workspaceId, async (tx) => {
    const docs = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.workspaceId, workspaceId), eq(documents.sourceId, sourceId)));
    for (const d of docs) await revokeDocumentIndexes(tx, workspaceId, d.id);
    await tx
      .update(documents)
      .set({ status: "deleted", updatedAt: new Date() })
      .where(
        and(
          eq(documents.workspaceId, workspaceId),
          eq(documents.sourceId, sourceId),
          ne(documents.status, "deleted"),
        ),
      );
    return docs.map((d) => d.id);
  });
  for (const id of docIds) await enqueueCleanup(ctx, workspaceId, id);

  const { upstream, files } = await ctx.db.tenant(workspaceId, async (tx) => ({
    // indexes whose upstream document exists, or whose build reached the service
    upstream: await tx
      .select({
        id: documentIndexes.id,
        docId: documentIndexes.upstreamDocId,
        jobId: documentIndexes.jobId,
      })
      .from(documentIndexes)
      .where(
        and(
          eq(documentIndexes.workspaceId, workspaceId),
          eq(documentIndexes.sourceId, sourceId),
          isNull(documentIndexes.remoteDeletedAt),
          or(isNotNull(documentIndexes.upstreamDocId), isNotNull(documentIndexes.startedAt)),
        ),
      ),
    files: docIds.length
      ? await tx
          .select({ id: artifacts.id, storage: artifacts.storage, key: artifacts.storageKey })
          .from(documentVersions)
          .innerJoin(artifacts, eq(artifacts.id, documentVersions.artifactId))
          .where(
            and(
              eq(documentVersions.workspaceId, workspaceId),
              inArray(documentVersions.documentId, docIds),
            ),
          )
      : [],
  }));
  if (upstream.length) {
    if (!pageIndexEnabled(ctx.config))
      throw new ApiError(
        409,
        "PAGEINDEX_DISABLED",
        "access to the source's documents is revoked, but their indexes cannot be removed from the PageIndex service while it is off; turn it on and delete the source again",
      );
    const client = serviceClient(ctx.config);
    // already gone upstream counts as removed
    const tolerate404 = async <T>(call: () => Promise<T>): Promise<T | null> => {
      try {
        return await call();
      } catch (error) {
        if (error instanceof PageIndexServiceError && error.status === 404) return null;
        throw serviceFailure(error);
      }
    };
    for (const u of upstream) {
      if (u.docId) {
        const docId = u.docId;
        await tolerate404(() => client.deleteDocument(workspaceId, docId));
      } else {
        const stopped = await tolerate404(() => client.cancelJob(workspaceId, u.jobId));
        const produced = stopped?.result?.docId;
        if (produced) await tolerate404(() => client.deleteDocument(workspaceId, produced));
      }
      await ctx.db.tenant(workspaceId, (tx) => markIndexRemoteDeleted(tx, workspaceId, u.id));
    }
  }
  if (files.length) {
    const storage = apiArtifactStorage(ctx.config);
    if (!storage)
      throw new ApiError(
        503,
        "STORAGE_UNAVAILABLE",
        "artifact storage is not available to the API",
      );
    for (const f of files) {
      await storage.forKind(f.storage).delete(f.key);
      await ctx.db.tenant(workspaceId, (tx) =>
        tx
          .delete(artifacts)
          .where(and(eq(artifacts.workspaceId, workspaceId), eq(artifacts.id, f.id))),
      );
    }
  }
  await ctx.db.tenant(workspaceId, (tx) =>
    tx
      .delete(knowledgeSources)
      .where(and(eq(knowledgeSources.id, sourceId), eq(knowledgeSources.workspaceId, workspaceId))),
  );
}

// ── the query playground ─────────────────────────────────────────────────────────────────

export interface QueryInput {
  query: string;
  scope: DocumentScope;
  answer: boolean;
  budget?: Partial<RetrievalBudget> | undefined;
}

export interface QueryOutput {
  retrieval: RetrievalResult;
  answer: GroundedAnswer | null;
  model: ModelRef | null;
  /** navigation, generation and citation checks together */
  costUsd: number;
}

const callCtx = (signal: AbortSignal): DecisionCallContext => ({
  signal,
  runId: "pageindex-query",
  nodeRunId: uuidv7(),
  idempotencyKey: null,
});

/** The workspace's decision chain as one provider (with failover); null when none resolves. */
async function decisionChain(
  ctx: ApiContext,
  workspaceId: string,
  signal: AbortSignal,
): Promise<{ provider: DecisionProvider | null; reason: string | null }> {
  const hops = await ctx.db.tenant(workspaceId, (tx) => workspaceDecisionHops(tx, workspaceId));
  if (!hops.length)
    return { provider: null, reason: "the decision chain has only human or rule hops" };
  try {
    return {
      provider: await registryOf(ctx).chain(hops, resolveContext(ctx, workspaceId, signal)),
      reason: null,
    };
  } catch (error) {
    return { provider: null, reason: toFlowaidError(error).message };
  }
}

/**
 * Every id a scope names must exist in this workspace (and not be deleted): a wrong id is a 404,
 * not an empty result. Named documents without a ready index simply contribute no evidence.
 */
async function checkScope(tx: Tx, workspaceId: string, scope: DocumentScope): Promise<void> {
  const sourceIds = [...new Set(scope.sourceIds ?? [])];
  const documentIds = [...new Set(scope.documentIds ?? [])];
  const indexIds = [...new Set(scope.indexIds ?? [])];
  if (sourceIds.length) {
    const found = await tx
      .select({ id: knowledgeSources.id })
      .from(knowledgeSources)
      .where(
        and(
          eq(knowledgeSources.workspaceId, workspaceId),
          eq(knowledgeSources.kind, "pageindex"),
          inArray(knowledgeSources.id, sourceIds),
        ),
      );
    if (found.length !== sourceIds.length) throw new NotFoundError("knowledge source not found");
  }
  if (documentIds.length) {
    const found = await tx
      .select({ id: documents.id })
      .from(documents)
      .innerJoin(knowledgeSources, eq(knowledgeSources.id, documents.sourceId))
      .where(
        and(
          eq(documents.workspaceId, workspaceId),
          eq(knowledgeSources.kind, "pageindex"),
          ne(documents.status, "deleted"),
          inArray(documents.id, documentIds),
        ),
      );
    if (found.length !== documentIds.length) throw new NotFoundError("document not found");
  }
  if (indexIds.length) {
    const found = await tx
      .select({ id: documentIndexes.id })
      .from(documentIndexes)
      .innerJoin(documents, eq(documents.id, documentIndexes.documentId))
      .where(
        and(
          eq(documentIndexes.workspaceId, workspaceId),
          ne(documents.status, "deleted"),
          inArray(documentIndexes.id, indexIds),
        ),
      );
    if (found.length !== indexIds.length) throw new NotFoundError("index not found");
  }
}

/** Retrieves evidence from the scope's ready indexes and, if asked, writes a checked answer. */
export async function runQuery(
  ctx: ApiContext,
  workspaceId: string,
  input: QueryInput,
  signal: AbortSignal,
): Promise<QueryOutput> {
  const client = serviceClient(ctx.config);
  const resolved = await ctx.db.tenant(workspaceId, async (tx) => {
    await checkScope(tx, workspaceId, input.scope);
    return resolveDocumentIndexes(tx, workspaceId, input.scope);
  });
  if (resolved.length > MAX_QUERY_DOCUMENTS)
    throw new BadRequestError(
      `a query covers at most ${MAX_QUERY_DOCUMENTS} documents; the scope resolves to ${resolved.length}`,
    );
  const model = input.answer ? await advisorModel(ctx, workspaceId) : null;
  if (input.answer && !model)
    throw new ConflictError(
      "No generation model is available to answer: add an Anthropic, OpenAI or Ollama credential, or set the workspace's advisorModel",
    );

  const rows = new Map(resolved.map((r) => [r.row.id, r.row]));
  const indexes = resolved.map((r) => indexReference(r.row, r.version, r.title));
  const chain = resolved.length ? await decisionChain(ctx, workspaceId, signal) : null;
  const decider = chain?.provider ?? null;
  if (resolved.length && !decider)
    throw new ConflictError(
      `The workspace's decision chain cannot navigate documents: ${chain?.reason ?? "no provider"}`,
    );

  const navigate: Navigator = async (choice) => {
    if (!decider) throw new ConflictError("no decision provider");
    const d = await decider.decideChoice(
      choice.state,
      { kind: "choice", instructions: choice.instructions, options: choice.options },
      callCtx(signal),
    );
    return {
      value: d.value,
      probabilities: d.probabilities,
      confidence: d.confidence,
      provider: d.provider,
      usage: d.usage,
      costUsd: d.costUsd,
    };
  };

  const retrieval = await retrieveEvidence({
    query: input.query,
    indexes,
    navigate,
    budget: { ...input.budget, maxDocuments: MAX_QUERY_DOCUMENTS },
    outline: (indexId) => {
      const row = rows.get(indexId);
      if (!row) return Promise.reject(new NotFoundError("index not found"));
      return Promise.resolve(outlineOf(row));
    },
    readPages: async (indexId, pages) => {
      const row = rows.get(indexId);
      if (!row?.upstreamDocId) throw new NotFoundError("index not found");
      const count = row.pageCount ?? 0;
      const valid = pages.filter((p) => Number.isInteger(p) && p >= 1 && p <= count);
      if (!valid.length) throw new RangeError(`pages ${pages.join(", ")} are outside the document`);
      try {
        return await client.pages(workspaceId, row.upstreamDocId, valid, signal);
      } catch (error) {
        throw serviceFailure(error);
      }
    },
  });
  let costUsd = retrieval.costUsd;
  if (!input.answer || !model) return { retrieval, answer: null, model: null, costUsd };

  const runId = uuidv7();
  if (!retrieval.evidence.length) {
    const answer = await checkCitations({
      answer: `${INSUFFICIENT_MARKER} No section of the documents in scope was relevant to the question.`,
      evidence: [],
      runId,
    });
    return { retrieval, answer, model: model.ref, costUsd };
  }
  const generator = await registryOf(ctx).generation(
    model.ref,
    resolveContext(ctx, workspaceId, signal),
  );
  const generated = await generator.generate(
    {
      messages: [
        { role: "system", content: ANSWER_INSTRUCTIONS },
        {
          role: "user",
          content: `Question: ${input.query}\n\nEvidence:\n${wrapUntrusted(
            evidenceForPrompt(retrieval.evidence),
            { label: "document excerpts" },
          )}`,
        },
      ],
      maxOutputTokens: 1500,
    },
    callCtx(signal),
  );
  costUsd += generated.costUsd;

  let judgeCost = 0;
  const judge: SupportJudge | undefined = decider
    ? (checks) =>
        Promise.all(
          checks.map(async (c) => {
            const d = await decider.decideBoolean(
              c.evidence.excerpt,
              {
                kind: "boolean",
                instructions: `Does the text support this statement? Statement: ${c.claim}`,
              },
              callCtx(signal),
            );
            judgeCost += d.costUsd;
            return { id: c.id, supported: d.value, score: d.pYes };
          }),
        )
    : undefined;
  let answer: GroundedAnswer;
  try {
    answer = await checkCitations({
      answer: generated.text,
      evidence: retrieval.evidence,
      runId,
      judge,
    });
  } catch (error) {
    // the judge failed: check lexically rather than returning an unchecked answer
    answer = await checkCitations({ answer: generated.text, evidence: retrieval.evidence, runId });
    answer.limitations.push(
      `the decision provider could not check the citations (${toFlowaidError(error).message}); they were checked lexically`,
    );
  }
  costUsd += judgeCost;
  return { retrieval, answer, model: model.ref, costUsd: Number(costUsd.toFixed(6)) };
}

/** Whether the service answers (2 s), and what it runs. */
export async function serviceStatus(
  config: ApiConfig,
): Promise<{ reachable: boolean; sdkVersion: string | null }> {
  if (!pageIndexEnabled(config)) return { reachable: false, sdkVersion: null };
  try {
    const h = await serviceClient(config, 2_000).health();
    return { reachable: h.ok, sdkVersion: h.sdk };
  } catch {
    return { reachable: false, sdkVersion: null };
  }
}
