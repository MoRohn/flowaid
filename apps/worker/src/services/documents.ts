/**
 * `ctx.documents` in the worker (RFC-0022): a workspace's PageIndex document indexes, bound to
 * the calling node's workspace and signal. Resolution, index metadata and outlines are read from
 * PostgreSQL (the outline is stored with the index); only page text comes from the PageIndex
 * service. Every id outside the workspace, and every deleted document, is `NOT_FOUND`; an index
 * that is not ready (or a superseded one a run pinned) is `CONFLICT` with `INDEX_NOT_READY`.
 *
 * Without the service (FLOWAID_PAGEINDEX_URL/TOKEN unset) every call is a `BAD_REQUEST` saying
 * so, and nothing else in the worker changes.
 */
import { and, eq, ne } from "drizzle-orm";
import {
  READABLE_STATES,
  documentIndexes,
  documentVersions,
  documents,
  knowledgeSources,
  latestDocumentVersion,
  requestDocumentIndex,
  resolveDocumentIndexes,
  toIndexReference,
  type Database,
  type DocumentIndexRow,
  type Tx,
} from "@flowaid/database";
import type { DocumentIndexAccess } from "@flowaid/node-sdk";
import {
  LOCAL_CAPABILITIES,
  PageIndexServiceError,
  indexRequestFromSource,
  type PageIndexServiceClient,
} from "@flowaid/pageindex";
import {
  BadRequestError,
  ConflictError,
  InternalError,
  NetworkError,
  NotFoundError,
  type IndexReference,
  type OutlineNode,
  type QueueDriver,
} from "@flowaid/workflow-core";

export const PAGEINDEX_NOT_CONFIGURED =
  "PageIndex is not configured on this FlowAId: set FLOWAID_PAGEINDEX_URL and FLOWAID_PAGEINDEX_TOKEN";
/** pages one `readPages` call may ask for */
export const MAX_PAGES_PER_READ = 20;

export interface DocumentDeps {
  db: Database;
  queue: QueueDriver;
  /** null when PageIndex is not configured */
  client: PageIndexServiceClient | null;
}

/** Queues the build of a newly requested index (the job id deduplicates repeated requests). */
export function enqueueIndexJob(
  queue: QueueDriver,
  workspaceId: string,
  indexId: string,
  opts: { delayMs?: number; jobId?: string } = {},
): Promise<void> {
  return queue.enqueue(
    "ingest",
    { type: "pageindex.index", workspaceId, indexId },
    {
      jobId: opts.jobId ?? `pageindex:${indexId}`,
      ...(opts.delayMs ? { delayMs: opts.delayMs } : {}),
    },
  );
}

/** A service failure as a FlowaidError a node can report (never the service's internals). */
export function serviceFailure(error: unknown): unknown {
  if (!(error instanceof PageIndexServiceError)) return error;
  if (error.transient)
    return new NetworkError(`the PageIndex service is unavailable: ${error.message}`);
  if (error.status === 404) return new NotFoundError(`PageIndex: ${error.message}`);
  if (error.status === 400) return new BadRequestError(`PageIndex: ${error.message}`);
  return new InternalError(`PageIndex answered ${error.code}: ${error.message}`);
}

const notReady = (row: DocumentIndexRow) =>
  new ConflictError(`index ${row.id} is ${row.state}, not ready`, {
    code: "INDEX_NOT_READY",
    state: row.state,
  });

/** An index with its version and title, when its document is not deleted. */
async function loadIndex(tx: Tx, workspaceId: string, indexId: string) {
  const [hit] = await tx
    .select({ row: documentIndexes, version: documentVersions, title: documents.title })
    .from(documentIndexes)
    .innerJoin(documentVersions, eq(documentVersions.id, documentIndexes.versionId))
    .innerJoin(documents, eq(documents.id, documentIndexes.documentId))
    .where(
      and(
        eq(documentIndexes.workspaceId, workspaceId),
        eq(documentIndexes.id, indexId),
        ne(documents.status, "deleted"),
        ne(documentIndexes.state, "deleted"),
      ),
    );
  if (!hit) throw new NotFoundError(`index ${indexId} not found`);
  return hit;
}

function unconfigured(): DocumentIndexAccess {
  const refuse = () => Promise.reject(new BadRequestError(PAGEINDEX_NOT_CONFIGURED));
  return {
    resolve: refuse,
    getIndex: refuse,
    outline: refuse,
    readPages: refuse,
    requestIndex: refuse,
  };
}

export function documentIndexAccessFor(
  deps: DocumentDeps,
  call: { workspaceId: string; signal?: AbortSignal },
): DocumentIndexAccess {
  const client = deps.client;
  if (!client) return unconfigured();
  const ws = call.workspaceId;
  const tenant = <T>(fn: (tx: Tx) => Promise<T>) => deps.db.tenant(ws, fn);
  const readable = (row: DocumentIndexRow) => READABLE_STATES.includes(row.state);

  return {
    resolve: async (scope) => {
      const rows = await tenant((tx) => resolveDocumentIndexes(tx, ws, scope));
      return rows.map((r): IndexReference =>
        toIndexReference(r.row, r.version, r.title, LOCAL_CAPABILITIES),
      );
    },
    getIndex: async (indexId) => {
      const hit = await tenant((tx) => loadIndex(tx, ws, indexId));
      return toIndexReference(hit.row, hit.version, hit.title, LOCAL_CAPABILITIES);
    },
    outline: async (indexId) => {
      const { row } = await tenant((tx) => loadIndex(tx, ws, indexId));
      if (!readable(row)) throw notReady(row);
      // written from the service's validated tree when the index was published
      return Array.isArray(row.outline) ? (row.outline as unknown as OutlineNode[]) : [];
    },
    readPages: async (indexId, pages) => {
      const { row } = await tenant((tx) => loadIndex(tx, ws, indexId));
      if (!readable(row)) throw notReady(row);
      if (pages.length === 0) return [];
      if (pages.length > MAX_PAGES_PER_READ)
        throw new BadRequestError(
          `read at most ${MAX_PAGES_PER_READ} pages per call (asked for ${pages.length})`,
        );
      const last = row.pageCount ?? 0;
      const bad = pages.filter((p) => !Number.isInteger(p) || p < 1 || p > last);
      if (bad.length)
        throw new BadRequestError(
          `pages ${bad.join(", ")} are outside 1..${last} of index ${indexId}`,
        );
      if (!row.upstreamDocId || row.remoteDeletedAt)
        throw new NotFoundError(`index ${indexId} has no document in the PageIndex service`);
      try {
        return await client.pages(ws, row.upstreamDocId, [...new Set(pages)], call.signal);
      } catch (error) {
        throw serviceFailure(error);
      }
    },
    requestIndex: async (documentId) => {
      const out = await tenant(async (tx) => {
        const [doc] = await tx
          .select({
            id: documents.id,
            title: documents.title,
            sourceId: documents.sourceId,
            config: knowledgeSources.config,
          })
          .from(documents)
          .innerJoin(knowledgeSources, eq(knowledgeSources.id, documents.sourceId))
          .where(
            and(
              eq(documents.workspaceId, ws),
              eq(documents.id, documentId),
              eq(knowledgeSources.kind, "pageindex"),
              ne(documents.status, "deleted"),
            ),
          );
        if (!doc) throw new NotFoundError(`document ${documentId} not found`);
        const version = await latestDocumentVersion(tx, ws, documentId);
        if (!version)
          throw new ConflictError(`document ${documentId} has no uploaded version to index`);
        let request: ReturnType<typeof indexRequestFromSource>;
        try {
          request = indexRequestFromSource(doc.config);
        } catch (error) {
          throw new BadRequestError(error instanceof Error ? error.message : String(error));
        }
        const { row, created } = await requestDocumentIndex(tx, {
          workspaceId: ws,
          sourceId: doc.sourceId,
          documentId,
          versionId: version.id,
          configHash: request.configHash,
          settings: { ...request.settings },
          indexModel: request.indexModel,
        });
        return {
          created,
          index: toIndexReference(row, version, doc.title, LOCAL_CAPABILITIES),
        };
      });
      // after the commit, so the job always finds its row (a lost enqueue is reconciled)
      if (out.created) await enqueueIndexJob(deps.queue, ws, out.index.indexId);
      return out;
    },
  };
}
