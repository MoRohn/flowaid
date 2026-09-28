/**
 * Document versions and their indexes (RFC-0022, migration 0010): the lifecycle rules in one
 * place, used by the API (uploads, requests, cancellation, reads) and the worker (the indexing
 * job). Every function takes a tenant transaction and the workspace id; queries also filter by
 * it, so a wrong id is simply not found.
 *
 * - Versions are immutable and deduplicated by sha256 per document.
 * - `requestIndex` joins a live build (or the ready index) of the same version and settings, so
 *   repeated requests never start duplicate work; the partial unique index backs this under races.
 * - `markReady` promotes atomically: the document's previous active index becomes `superseded`
 *   (still readable by runs that pinned it) in the same transaction. A build that was cancelled
 *   or deleted meanwhile is not promoted; the caller removes its upstream document.
 */
import { and, desc, eq, inArray, isNull, max, ne, or, sql } from "drizzle-orm";
import { uuidv7 } from "@flowaid/shared";
import type {
  DocumentIndexCapabilities,
  DocumentIndexState,
  DocumentReference,
  DocumentScope,
  IndexReference,
  JsonObject,
  JsonValue,
} from "@flowaid/workflow-core";
import type { Tx } from "../db.js";
import { documentIndexes, documentVersions, documents } from "../schema.js";

export type DocumentIndexRow = typeof documentIndexes.$inferSelect;
export type DocumentVersionRow = typeof documentVersions.$inferSelect;

/** States from which an index is still being built or is the live result. */
export const LIVE_STATES: readonly DocumentIndexState[] = [
  "queued",
  "running",
  "ready",
  "cancel_requested",
];
/** States a caller may read from (a pinned superseded index stays readable). */
export const READABLE_STATES: readonly DocumentIndexState[] = ["ready", "superseded"];

const ws = (workspaceId: string) => eq(documentIndexes.workspaceId, workspaceId);

export function toDocumentReference(
  doc: { id: string; sourceId: string; title: string | null },
  v: DocumentVersionRow,
): DocumentReference {
  return {
    documentId: doc.id,
    sourceId: doc.sourceId,
    versionId: v.id,
    version: v.version,
    contentSha256: v.sha256,
    displayName: doc.title ?? v.fileName,
    mediaType: v.mediaType,
    bytes: v.bytes,
    pageCount: v.pageCount,
  };
}

export function toIndexReference(
  row: DocumentIndexRow,
  v: Pick<DocumentVersionRow, "version" | "fileName">,
  displayName: string | null,
  capabilities: DocumentIndexCapabilities,
): IndexReference {
  return {
    indexId: row.id,
    documentId: row.documentId,
    sourceId: row.sourceId,
    versionId: row.versionId,
    documentVersion: v.version,
    indexVersion: row.indexVersion,
    displayName: displayName ?? v.fileName,
    state: row.state,
    active: row.active,
    backend: "pageindex",
    mode: "local",
    backendVersion: row.backendVersion,
    configHash: row.configHash,
    indexModel: row.indexModel,
    pageCount: row.pageCount,
    stage: row.stage,
    error: row.error ?? null,
    createdAt: row.createdAt.toISOString(),
    readyAt: row.readyAt ? row.readyAt.toISOString() : null,
    capabilities,
  };
}

/** Records an upload; the same bytes for the same document return the existing version. */
export async function createDocumentVersion(
  tx: Tx,
  input: {
    workspaceId: string;
    documentId: string;
    sha256: string;
    bytes: number;
    mediaType: string;
    fileName: string;
    artifactId: string | null;
    pageCount: number | null;
  },
): Promise<{ version: DocumentVersionRow; created: boolean }> {
  const [existing] = await tx
    .select()
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.workspaceId, input.workspaceId),
        eq(documentVersions.documentId, input.documentId),
        eq(documentVersions.sha256, input.sha256),
      ),
    );
  if (existing) return { version: existing, created: false };
  const [last] = await tx
    .select({ v: max(documentVersions.version) })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, input.documentId));
  const [version] = await tx
    .insert(documentVersions)
    .values({ id: uuidv7(), ...input, version: (last?.v ?? 0) + 1 })
    .returning();
  if (!version) throw new Error("document version insert returned nothing");
  return { version, created: true };
}

export async function latestDocumentVersion(
  tx: Tx,
  workspaceId: string,
  documentId: string,
): Promise<DocumentVersionRow | null> {
  const [v] = await tx
    .select()
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.workspaceId, workspaceId),
        eq(documentVersions.documentId, documentId),
      ),
    )
    .orderBy(desc(documentVersions.version))
    .limit(1);
  return v ?? null;
}

/** Joins the live build (or ready index) of this version and settings, or queues a new one. */
export async function requestDocumentIndex(
  tx: Tx,
  input: {
    workspaceId: string;
    sourceId: string;
    documentId: string;
    versionId: string;
    configHash: string;
    settings: JsonObject;
    indexModel: string;
  },
): Promise<{ row: DocumentIndexRow; created: boolean }> {
  const live = () =>
    tx
      .select()
      .from(documentIndexes)
      .where(
        and(
          ws(input.workspaceId),
          eq(documentIndexes.versionId, input.versionId),
          eq(documentIndexes.configHash, input.configHash),
          inArray(documentIndexes.state, [...LIVE_STATES]),
        ),
      );
  const [found] = await live();
  if (found) return { row: found, created: false };
  const [last] = await tx
    .select({ v: max(documentIndexes.indexVersion) })
    .from(documentIndexes)
    .where(eq(documentIndexes.documentId, input.documentId));
  const inserted = await tx
    .insert(documentIndexes)
    .values({
      id: uuidv7(),
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
      documentId: input.documentId,
      versionId: input.versionId,
      indexVersion: (last?.v ?? 0) + 1,
      configHash: input.configHash,
      settings: input.settings,
      indexModel: input.indexModel,
      jobId: uuidv7(),
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return { row: inserted[0], created: true };
  // another request won the race: join it
  const [raced] = await live();
  if (!raced) throw new Error("the index request lost a race and found nothing to join");
  return { row: raced, created: false };
}

export async function getDocumentIndex(
  tx: Tx,
  workspaceId: string,
  indexId: string,
): Promise<DocumentIndexRow | null> {
  const [row] = await tx
    .select()
    .from(documentIndexes)
    .where(and(ws(workspaceId), eq(documentIndexes.id, indexId)));
  return row ?? null;
}

/** Moves a queued (or retried running) build to running; false when it was cancelled or is gone. */
export async function markIndexRunning(
  tx: Tx,
  workspaceId: string,
  indexId: string,
  stage: string,
): Promise<boolean> {
  const out = await tx
    .update(documentIndexes)
    .set({
      state: "running",
      stage,
      startedAt: sql`coalesce(${documentIndexes.startedAt}, now())`,
      attempts: sql`${documentIndexes.attempts} + 1`,
      error: null,
    })
    .where(
      and(
        ws(workspaceId),
        eq(documentIndexes.id, indexId),
        inArray(documentIndexes.state, ["queued", "running"]),
      ),
    )
    .returning({ id: documentIndexes.id });
  return out.length > 0;
}

export async function setIndexStage(
  tx: Tx,
  workspaceId: string,
  indexId: string,
  stage: string,
): Promise<void> {
  await tx
    .update(documentIndexes)
    .set({ stage })
    .where(
      and(ws(workspaceId), eq(documentIndexes.id, indexId), eq(documentIndexes.state, "running")),
    );
}

/**
 * Publishes a finished build and makes it the document's active index, superseding the previous
 * one in the same transaction. Returns false (and publishes nothing) when the build was
 * cancelled or deleted while it ran.
 */
export async function markIndexReady(
  tx: Tx,
  workspaceId: string,
  indexId: string,
  result: {
    upstreamDocId: string;
    pageCount: number;
    description: string | null;
    outline: JsonValue;
    backendVersion: string;
  },
): Promise<boolean> {
  const [row] = await tx
    .select()
    .from(documentIndexes)
    .where(and(ws(workspaceId), eq(documentIndexes.id, indexId)))
    .for("update");
  if (!row || row.state !== "running") return false;
  await tx
    .update(documentIndexes)
    .set({ active: false, state: "superseded" })
    .where(
      and(
        ws(workspaceId),
        eq(documentIndexes.documentId, row.documentId),
        eq(documentIndexes.active, true),
      ),
    );
  await tx
    .update(documentIndexes)
    .set({
      ...result,
      state: "ready",
      active: true,
      stage: null,
      error: null,
      readyAt: sql`now()`,
      endedAt: sql`now()`,
    })
    .where(eq(documentIndexes.id, indexId));
  await tx
    .update(documentVersions)
    .set({ pageCount: result.pageCount })
    .where(and(eq(documentVersions.id, row.versionId), isNull(documentVersions.pageCount)));
  return true;
}

export async function markIndexFailed(
  tx: Tx,
  workspaceId: string,
  indexId: string,
  error: { code: string; message: string },
): Promise<void> {
  await tx
    .update(documentIndexes)
    .set({ state: "failed", error, stage: null, endedAt: sql`now()` })
    .where(
      and(
        ws(workspaceId),
        eq(documentIndexes.id, indexId),
        inArray(documentIndexes.state, ["queued", "running"]),
      ),
    );
}

/** Asks a queued or running build to stop; a queued one is cancelled at once. */
export async function requestIndexCancel(
  tx: Tx,
  workspaceId: string,
  indexId: string,
): Promise<DocumentIndexRow | null> {
  const [queued] = await tx
    .update(documentIndexes)
    .set({ state: "canceled", cancelRequestedAt: sql`now()`, endedAt: sql`now()`, stage: null })
    .where(
      and(ws(workspaceId), eq(documentIndexes.id, indexId), eq(documentIndexes.state, "queued")),
    )
    .returning();
  if (queued) return queued;
  const [running] = await tx
    .update(documentIndexes)
    .set({ state: "cancel_requested", cancelRequestedAt: sql`now()` })
    .where(
      and(ws(workspaceId), eq(documentIndexes.id, indexId), eq(documentIndexes.state, "running")),
    )
    .returning();
  return running ?? null;
}

export async function markIndexCanceled(
  tx: Tx,
  workspaceId: string,
  indexId: string,
): Promise<void> {
  await tx
    .update(documentIndexes)
    .set({ state: "canceled", stage: null, endedAt: sql`now()` })
    .where(
      and(
        ws(workspaceId),
        eq(documentIndexes.id, indexId),
        inArray(documentIndexes.state, ["cancel_requested", "running", "queued"]),
      ),
    );
}

/** Revokes every index of a document at once (reads stop now; upstream cleanup follows). */
export async function revokeDocumentIndexes(
  tx: Tx,
  workspaceId: string,
  documentId: string,
): Promise<DocumentIndexRow[]> {
  return tx
    .update(documentIndexes)
    .set({
      state: "deleted",
      active: false,
      stage: null,
      endedAt: sql`coalesce(${documentIndexes.endedAt}, now())`,
    })
    .where(
      and(
        ws(workspaceId),
        eq(documentIndexes.documentId, documentId),
        ne(documentIndexes.state, "deleted"),
      ),
    )
    .returning();
}

export async function markIndexRemoteDeleted(
  tx: Tx,
  workspaceId: string,
  indexId: string,
): Promise<void> {
  await tx
    .update(documentIndexes)
    .set({ remoteDeletedAt: sql`now()` })
    .where(and(ws(workspaceId), eq(documentIndexes.id, indexId)));
}

/**
 * Indexes a scope may read: the active ready index of each document in `sourceIds` /
 * `documentIds`, plus exactly the pinned `indexIds` (ready or superseded). Deleted documents and
 * indexes never resolve.
 */
export async function resolveDocumentIndexes(
  tx: Tx,
  workspaceId: string,
  scope: DocumentScope,
): Promise<{ row: DocumentIndexRow; version: DocumentVersionRow; title: string | null }[]> {
  const byDocs =
    (scope.sourceIds?.length ?? 0) > 0 || (scope.documentIds?.length ?? 0) > 0
      ? and(
          eq(documentIndexes.active, true),
          eq(documentIndexes.state, "ready"),
          or(
            scope.sourceIds?.length
              ? inArray(documentIndexes.sourceId, scope.sourceIds)
              : undefined,
            scope.documentIds?.length
              ? inArray(documentIndexes.documentId, scope.documentIds)
              : undefined,
          ),
        )
      : undefined;
  const pinned = scope.indexIds?.length
    ? and(
        inArray(documentIndexes.id, scope.indexIds),
        inArray(documentIndexes.state, [...READABLE_STATES]),
      )
    : undefined;
  if (!byDocs && !pinned) return [];
  const rows = await tx
    .select({ row: documentIndexes, version: documentVersions, title: documents.title })
    .from(documentIndexes)
    .innerJoin(documentVersions, eq(documentVersions.id, documentIndexes.versionId))
    .innerJoin(documents, eq(documents.id, documentIndexes.documentId))
    .where(and(ws(workspaceId), ne(documents.status, "deleted"), or(byDocs, pinned)))
    .orderBy(documents.title, documentIndexes.documentId);
  // a pinned index and the active index of the same document: keep the pinned one
  const pinnedDocs = new Set(
    rows.filter((r) => scope.indexIds?.includes(r.row.id)).map((r) => r.row.documentId),
  );
  return rows.filter(
    (r) => scope.indexIds?.includes(r.row.id) || !pinnedDocs.has(r.row.documentId),
  );
}
