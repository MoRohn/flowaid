/**
 * PageIndex jobs on the `ingest` queue (RFC-0022; docs/pageindex/ADR.md):
 *
 * - `pageindex.index` builds one index. It resolves the indexing model's key (the source's
 *   credential, else the server's key; Ollama needs only its host), reads the version's bytes
 *   from artifact storage and checks their sha256, submits the job to the service (idempotent by
 *   the row's `jobId`, so a restarted service that forgot the job simply gets it again) and polls
 *   it, copying the service's stage onto the row. Each poll re-reads the row: a cancellation or a
 *   deletion stops the service's job and removes anything it produced. A finished build is
 *   published with `markIndexReady` (promotion supersedes the previous index atomically); a build
 *   cancelled or deleted meanwhile is not published and its upstream document is removed.
 *   Failures the service reports (SCANNED_PDF, UNSUPPORTED, …) are final. When the service cannot
 *   be reached the job queues itself again with backoff (both queue drivers, since BullMQ jobs run
 *   once) and the row's `attempts` bound the retries; the last one fails the index with
 *   `PAGEINDEX_UNAVAILABLE`. Runs waiting on `pageindex.index.<indexId>` are then resumed with
 *   `{ indexId, state }`, as `POST /v1/events/:eventName` would.
 * - `pageindex.cleanup` removes a deleted document: its upstream documents (and service jobs still
 *   running), the stored bytes of every version, then the document row (versions and indexes
 *   cascade). Failures throw and the queue retries.
 * - `reconcilePageIndex` (every worker start) re-queues builds without a pending job and the
 *   cleanups of documents still marked deleted.
 *
 * What an operator sees while something is stuck: builds in `document_indexes` with state
 * `queued`/`running`/`cancel_requested` (the `stage`, `attempts` and `error` columns say where),
 * and deleted documents that remain as `documents.status = 'deleted'` with index rows whose
 * `remote_deleted_at` is null until the service confirmed their removal; the queue row's
 * `last_error` (Postgres queue) says why the last cleanup attempt failed.
 *
 * Model keys travel to the service in the job submission only; nothing here logs them.
 */
import { and, eq, inArray, isNull, sql, type AnyColumn } from "drizzle-orm";
import type { CredentialService } from "@flowaid/credentials";
import {
  artifacts,
  credentials,
  documentIndexes,
  documentVersions,
  documents,
  eventSubscriptions,
  getDocumentIndex,
  knowledgeSources,
  markIndexCanceled,
  markIndexFailed,
  markIndexReady,
  markIndexRemoteDeleted,
  markIndexRunning,
  queueJobs,
  setIndexStage,
  type Database,
  type DocumentIndexRow,
  type Tx,
} from "@flowaid/database";
import {
  PageIndexServiceError,
  StoredIndexSettingsSchema,
  litellmModel,
  type IndexModelSpec,
  type JobStatus,
  type PageIndexServiceClient,
  type StoredIndexSettings,
  type SubmitJobInput,
} from "@flowaid/pageindex";
import { sha256Hex } from "@flowaid/shared";
import type { ArtifactStorage } from "@flowaid/storage";
import type { DocumentIndexState, JsonValue, QueueDriver } from "@flowaid/workflow-core";
import { enqueueIndexJob } from "../services/documents.js";
import type { ServerKeys } from "../services/credentials.js";
import type { WorkerLogger } from "../worker.js";

export interface PageIndexJobDeps {
  db: Database;
  queue: QueueDriver;
  client: PageIndexServiceClient;
  credentials: Pick<CredentialService, "decrypt">;
  storage: ArtifactStorage;
  serverKeys: ServerKeys;
  log: WorkerLogger;
  /** between service polls (default 2 s) */
  pollMs?: number;
  /** first retry delay after the service could not be reached; doubles per attempt (default 5 s) */
  retryDelayMs?: number;
  /** builds give up after this many attempts (default 5) */
  maxAttempts?: number;
  /** a build's time limit when its settings name none (default 30 min) */
  timeoutMs?: number;
  /** aborted when the worker stops: the job ends and is picked up again later */
  signal?: AbortSignal;
}

export type IndexJobOutcome =
  "ready" | "failed" | "canceled" | "discarded" | "retrying" | "skipped";

/** A failure retrying cannot fix: the index fails with this code. */
class PermanentIndexError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const BUILDING: readonly DocumentIndexState[] = ["queued", "running", "cancel_requested"];

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isNotFound = (error: unknown) =>
  error instanceof PageIndexServiceError && error.status === 404;

const abortReason = (signal?: AbortSignal): Error =>
  signal?.reason instanceof Error ? signal.reason : new Error("aborted");

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Resumes the runs waiting for this index (nodes suspend on `pageindex.index.<indexId>`): the
 * same signal `POST /v1/events/:eventName` sends to its uncorrelated subscriptions.
 */
export async function deliverIndexEvent(
  db: Database,
  queue: QueueDriver,
  workspaceId: string,
  indexId: string,
  state: DocumentIndexState,
): Promise<string[]> {
  const eventName = `pageindex.index.${indexId}`;
  const subs = await db.tenant(workspaceId, (tx) =>
    tx
      .select({ runId: eventSubscriptions.runId })
      .from(eventSubscriptions)
      .where(
        and(
          eq(eventSubscriptions.workspaceId, workspaceId),
          eq(eventSubscriptions.eventName, eventName),
          isNull(eventSubscriptions.correlationKey),
        ),
      ),
  );
  const runIds = [...new Set(subs.map((s) => s.runId))];
  for (const runId of runIds)
    await queue.enqueue(
      "run:general",
      {
        type: "run.signal",
        runId,
        signal: { type: "event", eventName, payload: { indexId, state } },
      },
      { jobId: `${eventName}:${runId}` },
    );
  return runIds;
}

/** The indexing model with its key or host, from the index's settings (never logged). */
async function modelSpec(
  deps: PageIndexJobDeps,
  workspaceId: string,
  settings: StoredIndexSettings,
): Promise<IndexModelSpec> {
  let litellm: string;
  try {
    litellm = litellmModel(settings.model);
  } catch (error) {
    throw new PermanentIndexError("UNSUPPORTED_MODEL", message(error));
  }
  let secret: Record<string, string> = {};
  if (settings.credentialId) {
    const id = settings.credentialId;
    const [owned] = await deps.db.tenant(workspaceId, (tx) =>
      tx
        .select({ id: credentials.id })
        .from(credentials)
        .where(and(eq(credentials.workspaceId, workspaceId), eq(credentials.id, id))),
    );
    if (!owned)
      throw new PermanentIndexError(
        "CREDENTIAL_NOT_FOUND",
        "the source's indexing credential no longer exists; choose another one and index again",
      );
    secret = await deps.credentials.decrypt(id);
  }
  const provider = settings.model.provider;
  if (provider === "ollama") {
    const apiBase = secret.host ?? secret.baseUrl ?? deps.serverKeys.ollamaHost;
    return { litellm, ...(apiBase ? { apiBase } : {}) };
  }
  const serverKey = provider === "openai" ? deps.serverKeys.openai : deps.serverKeys.anthropic;
  const apiKey = secret.apiKey ?? secret.key ?? secret.token ?? serverKey;
  if (!apiKey)
    throw new PermanentIndexError(
      "MODEL_CREDENTIAL_MISSING",
      `indexing with ${provider} needs a key: choose a credential on the source or set ${
        provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"
      }`,
    );
  const apiBase = secret.baseUrl;
  return { litellm, apiKey, ...(apiBase ? { apiBase } : {}) };
}

/** The version's original bytes, checked against the sha256 recorded at upload. */
async function versionBytes(
  deps: PageIndexJobDeps,
  workspaceId: string,
  row: DocumentIndexRow,
): Promise<{ bytes: Uint8Array; sha256: string; fileName: string }> {
  const [hit] = await deps.db.tenant(workspaceId, (tx) =>
    tx
      .select({ version: documentVersions, artifact: artifacts })
      .from(documentVersions)
      .leftJoin(artifacts, eq(artifacts.id, documentVersions.artifactId))
      .where(
        and(eq(documentVersions.workspaceId, workspaceId), eq(documentVersions.id, row.versionId)),
      ),
  );
  if (!hit?.artifact)
    throw new PermanentIndexError("DOCUMENT_MISSING", "the uploaded file of this version is gone");
  let bytes: Uint8Array;
  try {
    bytes = await deps.storage.forKind(hit.artifact.storage).get(hit.artifact.storageKey);
  } catch (error) {
    if ((error as { code?: unknown }).code === "NOT_FOUND")
      throw new PermanentIndexError(
        "DOCUMENT_MISSING",
        "the uploaded file of this version is gone",
      );
    throw error;
  }
  if (sha256Hex(bytes) !== hit.version.sha256)
    throw new PermanentIndexError(
      "CHECKSUM_MISMATCH",
      "the stored file does not match the sha256 recorded when it was uploaded",
    );
  return { bytes, sha256: hit.version.sha256, fileName: hit.version.fileName };
}

/** Stops a service job, ignoring one the service does not know; the status when it answered. */
async function cancelUpstream(
  deps: PageIndexJobDeps,
  workspaceId: string,
  jobId: string,
): Promise<JobStatus | null> {
  try {
    return await deps.client.cancelJob(workspaceId, jobId);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function deleteUpstream(
  deps: PageIndexJobDeps,
  workspaceId: string,
  docId: string,
): Promise<void> {
  try {
    await deps.client.deleteDocument(workspaceId, docId);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

/** Builds one index; safe to deliver more than once (every step is idempotent). */
export async function runIndexJob(
  deps: PageIndexJobDeps,
  job: { workspaceId: string; indexId: string },
): Promise<IndexJobOutcome> {
  const { workspaceId: ws, indexId } = job;
  const tenant = <T>(fn: (tx: Tx) => Promise<T>) => deps.db.tenant(ws, fn);
  const reload = () => tenant((tx) => getDocumentIndex(tx, ws, indexId));
  const finish = async (state: DocumentIndexState, outcome: IndexJobOutcome) => {
    const resumed = await deliverIndexEvent(deps.db, deps.queue, ws, indexId, state);
    deps.log.info(
      { workspaceId: ws, indexId, state, resumedRuns: resumed.length },
      "document index build ended",
    );
    return outcome;
  };

  const row = await reload();
  if (!row) return "skipped"; // deleted with its document
  if (row.state === "cancel_requested") {
    await cancelUpstream(deps, ws, row.jobId);
    await tenant((tx) => markIndexCanceled(tx, ws, indexId));
    return finish("canceled", "canceled");
  }
  if (row.state !== "queued" && row.state !== "running") {
    // a re-delivery of a finished build: runs still waiting for it (a delivery that failed
    // after the build ended) hear about it now
    if (row.state !== "deleted")
      await deliverIndexEvent(deps.db, deps.queue, ws, indexId, row.state);
    return "skipped";
  }
  if (!(await tenant((tx) => markIndexRunning(tx, ws, indexId, "submitting")))) return "skipped";
  const attempts = row.attempts + 1;
  const maxAttempts = deps.maxAttempts ?? 5;

  try {
    const parsed = StoredIndexSettingsSchema.safeParse(row.settings);
    if (!parsed.success)
      throw new PermanentIndexError("BAD_SETTINGS", "the index's recorded settings are invalid");
    const settings: StoredIndexSettings = parsed.data;
    const model = await modelSpec(deps, ws, settings);
    const file = await versionBytes(deps, ws, row);
    const spec: SubmitJobInput = {
      jobId: row.jobId,
      workspaceId: ws,
      fileName: file.fileName,
      contentSha256: file.sha256,
      mode: settings.mode,
      optimize: settings.optimize,
      model,
      indexId,
      pdf: file.bytes,
    };
    const startedAt = row.startedAt?.getTime() ?? Date.now();
    const deadline = startedAt + (settings.timeoutMs ?? deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let status = await deps.client.submitJob(spec, deps.signal);
    let stage = row.stage;

    while (status.state === "queued" || status.state === "running") {
      if (status.stage && status.stage !== stage) {
        stage = status.stage;
        const s = stage;
        await tenant((tx) => setIndexStage(tx, ws, indexId, s));
      }
      if (Date.now() > deadline) {
        await cancelUpstream(deps, ws, row.jobId);
        await tenant((tx) =>
          markIndexFailed(tx, ws, indexId, {
            code: "TIMEOUT",
            message: `indexing did not finish within ${Math.round((deadline - startedAt) / 60_000)} minutes`,
          }),
        );
        return finish("failed", "failed");
      }
      await sleep(deps.pollMs ?? 2_000, deps.signal);
      // FlowAId's side first: a cancellation or deletion stops the service's job
      const current = await reload();
      if (current && current.state !== "running" && current.state !== "cancel_requested")
        return "skipped"; // another delivery of this job already finished it
      if (!current || current.state !== "running") {
        const stopped = await cancelUpstream(deps, ws, row.jobId);
        if (stopped?.result) await deleteUpstream(deps, ws, stopped.result.docId);
        if (current?.state === "cancel_requested")
          await tenant((tx) => markIndexCanceled(tx, ws, indexId));
        return finish(current?.state === "cancel_requested" ? "canceled" : "deleted", "discarded");
      }
      try {
        status = await deps.client.getJob(ws, row.jobId, deps.signal);
      } catch (error) {
        if (!isNotFound(error)) throw error;
        // the service restarted and forgot the job: submit it again under the same id
        deps.log.warn({ workspaceId: ws, indexId }, "PageIndex lost the job; resubmitting");
        status = await deps.client.submitJob(spec, deps.signal);
      }
    }

    if (status.state === "ready" && status.result) {
      const result = status.result;
      const published = await tenant((tx) =>
        markIndexReady(tx, ws, indexId, {
          upstreamDocId: result.docId,
          pageCount: result.pageCount,
          description: result.description,
          outline: result.tree as unknown as JsonValue,
          backendVersion: `pageindex ${result.sdkVersion}`,
        }),
      );
      if (published) return finish("ready", "ready");
      // cancelled or deleted while it ran: nothing is published, and its document goes
      const current = await reload();
      if (current?.upstreamDocId !== result.docId) await deleteUpstream(deps, ws, result.docId);
      if (current?.state === "cancel_requested")
        await tenant((tx) => markIndexCanceled(tx, ws, indexId));
      return finish(current?.state ?? "deleted", "discarded");
    }
    if (status.state === "canceled") {
      const current = await reload();
      if (current?.state === "cancel_requested") {
        await tenant((tx) => markIndexCanceled(tx, ws, indexId));
        return finish("canceled", "canceled");
      }
      await tenant((tx) =>
        markIndexFailed(tx, ws, indexId, {
          code: "CANCELED_UPSTREAM",
          message: "the PageIndex service stopped the build",
        }),
      );
      return finish("failed", "failed");
    }
    await tenant((tx) =>
      markIndexFailed(
        tx,
        ws,
        indexId,
        status.error ?? { code: "INDEX_FAILED", message: "the PageIndex service failed the build" },
      ),
    );
    return finish("failed", "failed");
  } catch (error) {
    if (deps.signal?.aborted) throw error; // the worker is stopping; the build resumes later
    if (error instanceof PermanentIndexError) {
      await tenant((tx) =>
        markIndexFailed(tx, ws, indexId, { code: error.code, message: error.message }),
      );
      return finish("failed", "failed");
    }
    if (error instanceof PageIndexServiceError && !error.transient) {
      await tenant((tx) =>
        markIndexFailed(tx, ws, indexId, { code: error.code, message: error.message }),
      );
      return finish("failed", "failed");
    }
    // the service (or storage, or a key service) could not be reached: try again later
    if (attempts >= maxAttempts) {
      await tenant((tx) =>
        markIndexFailed(tx, ws, indexId, {
          code: "PAGEINDEX_UNAVAILABLE",
          message: `indexing failed ${attempts} times: ${message(error)}`,
        }),
      );
      return finish("failed", "failed");
    }
    const delayMs = (deps.retryDelayMs ?? 5_000) * 2 ** (attempts - 1);
    deps.log.warn(
      { workspaceId: ws, indexId, attempts, delayMs, err: message(error) },
      "document index build will be retried",
    );
    await tenant((tx) => setIndexStage(tx, ws, indexId, "waiting to retry"));
    await enqueueIndexJob(deps.queue, ws, indexId, {
      delayMs,
      jobId: `pageindex:${indexId}:retry-${attempts}`,
    });
    return "retrying";
  }
}

/** Removes a deleted document everywhere; throws (and is retried) until everything is gone. */
export async function runCleanupJob(
  deps: PageIndexJobDeps,
  job: { workspaceId: string; documentId: string },
): Promise<"removed" | "skipped"> {
  const { workspaceId: ws, documentId } = job;
  const tenant = <T>(fn: (tx: Tx) => Promise<T>) => deps.db.tenant(ws, fn);
  const [doc] = await tenant((tx) =>
    tx
      .select({ status: documents.status })
      .from(documents)
      .where(and(eq(documents.workspaceId, ws), eq(documents.id, documentId))),
  );
  if (!doc || doc.status !== "deleted") return "skipped";
  const indexes = await tenant((tx) =>
    tx
      .select()
      .from(documentIndexes)
      .where(and(eq(documentIndexes.workspaceId, ws), eq(documentIndexes.documentId, documentId))),
  );
  for (const row of indexes) {
    if (row.remoteDeletedAt) continue;
    // a build still running in the service stops, and anything it produced goes with it
    if (!row.upstreamDocId) {
      const stopped = await cancelUpstream(deps, ws, row.jobId);
      if (stopped?.result) await deleteUpstream(deps, ws, stopped.result.docId);
    } else await deleteUpstream(deps, ws, row.upstreamDocId);
    await tenant((tx) => markIndexRemoteDeleted(tx, ws, row.id));
  }
  const versions = await tenant((tx) =>
    tx
      .select({ artifact: artifacts })
      .from(documentVersions)
      .innerJoin(artifacts, eq(artifacts.id, documentVersions.artifactId))
      .where(
        and(eq(documentVersions.workspaceId, ws), eq(documentVersions.documentId, documentId)),
      ),
  );
  for (const { artifact } of versions) {
    await deps.storage.forKind(artifact.storage).delete(artifact.storageKey);
    await tenant((tx) =>
      tx.delete(artifacts).where(and(eq(artifacts.workspaceId, ws), eq(artifacts.id, artifact.id))),
    );
  }
  // versions and indexes cascade
  await tenant((tx) =>
    tx.delete(documents).where(and(eq(documents.workspaceId, ws), eq(documents.id, documentId))),
  );
  deps.log.info(
    { workspaceId: ws, documentId, indexes: indexes.length, files: versions.length },
    "deleted document removed",
  );
  return "removed";
}

/**
 * Re-queues work a crash or a lost enqueue left behind: builds with no pending job (the Postgres
 * queue is checked; with Redis the job id deduplicates, and a duplicate delivery is harmless) and
 * cleanups of documents still marked deleted. Cheap to run again.
 */
export async function reconcilePageIndex(deps: {
  db: Database;
  queue: QueueDriver;
}): Promise<{ indexes: number; cleanups: number }> {
  const pending = (type: string, key: string, column: AnyColumn) =>
    sql`not exists (select 1 from ${queueJobs} where ${queueJobs.doneAt} is null
      and ${queueJobs.payload}->>'type' = ${type} and ${queueJobs.payload}->>${key} = ${column}::text)`;
  const { builds, deleted } = await deps.db.system(async (tx) => ({
    builds: await tx
      .select({ id: documentIndexes.id, workspaceId: documentIndexes.workspaceId })
      .from(documentIndexes)
      .where(
        and(
          inArray(documentIndexes.state, [...BUILDING]),
          pending("pageindex.index", "indexId", documentIndexes.id),
        ),
      ),
    deleted: await tx
      .select({ id: documents.id, workspaceId: documents.workspaceId })
      .from(documents)
      .innerJoin(knowledgeSources, eq(knowledgeSources.id, documents.sourceId))
      .where(
        and(
          eq(documents.status, "deleted"),
          eq(knowledgeSources.kind, "pageindex"),
          pending("pageindex.cleanup", "documentId", documents.id),
        ),
      ),
  }));
  for (const b of builds) await enqueueIndexJob(deps.queue, b.workspaceId, b.id);
  for (const d of deleted)
    await deps.queue.enqueue(
      "ingest",
      { type: "pageindex.cleanup", workspaceId: d.workspaceId, documentId: d.id },
      { jobId: `pageindex-cleanup:${d.id}` },
    );
  return { indexes: builds.length, cleanups: deleted.length };
}
