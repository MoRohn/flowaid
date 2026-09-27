/**
 * `ingest.source` (ARCHITECTURE.md §10.8): syncs one knowledge source. Loaders fetch the source's
 * documents (a URL, a sitemap, a GitHub repository) and each is indexed through the source's
 * pipeline — normalise → chunk → embed → index. Uploaded documents (`files`, `text` sources) are
 * re-indexed from their stored content when pending or failed. Unchanged documents are skipped by
 * content hash, so the job is idempotent: a retry or a scheduled re-sync only touches what changed.
 * Documents a loader no longer returns are deleted. The source ends `ready`, or `error` with the
 * message; failing documents are recorded on their row and do not stop the others.
 */
import { eq } from "drizzle-orm";
import { PgKnowledgeStore, knowledgeSources } from "@flowaid/database";
import { loadGithub, loadSitemap, loadUrl, type LoadedDocument } from "@flowaid/knowledge";
import type { JsonObject } from "@flowaid/workflow-core";
import { knowledgeServiceFor, type KnowledgeDeps } from "../services/knowledge.js";

export interface IngestResult {
  indexed: number;
  unchanged: number;
  deleted: number;
  failed: { externalId: string; message: string }[];
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const strings = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;

/** The documents a remote source currently has (null for upload-only sources). */
async function load(
  deps: KnowledgeDeps,
  kind: string,
  config: JsonObject,
  token: string | undefined,
  signal: AbortSignal,
): Promise<{ docs: LoadedDocument[]; errors: { url: string; message: string }[] } | null> {
  switch (kind) {
    case "url": {
      const urls = strings(config.urls) ?? (str(config.url) ? [str(config.url) as string] : []);
      const docs: LoadedDocument[] = [];
      const errors: { url: string; message: string }[] = [];
      for (const url of urls)
        try {
          docs.push(await loadUrl(deps.http, url, { signal }));
        } catch (error) {
          errors.push({ url, message: error instanceof Error ? error.message : String(error) });
        }
      return { docs, errors };
    }
    case "sitemap": {
      const r = await loadSitemap(deps.http, str(config.url) ?? "", {
        signal,
        ...(strings(config.include) ? { include: strings(config.include) as string[] } : {}),
        ...(typeof config.maxPages === "number" ? { maxPages: config.maxPages } : {}),
      });
      return { docs: r.documents, errors: r.errors };
    }
    case "github":
      return {
        docs: await loadGithub(deps.http, {
          signal,
          repo: str(config.repo) ?? "",
          ...(str(config.ref) ? { ref: str(config.ref) } : {}),
          ...(str(config.path) ? { path: str(config.path) } : {}),
          ...(strings(config.extensions) ? { extensions: strings(config.extensions) } : {}),
          ...(typeof config.maxFiles === "number" ? { maxFiles: config.maxFiles } : {}),
          ...(token ? { token } : {}),
        }),
        errors: [],
      };
    default:
      return null;
  }
}

export async function runIngestJob(
  deps: KnowledgeDeps & { signal?: AbortSignal },
  sourceId: string,
): Promise<IngestResult | null> {
  const [row] = await deps.db.system((tx) =>
    tx.select().from(knowledgeSources).where(eq(knowledgeSources.id, sourceId)),
  );
  if (!row) return null; // deleted since it was queued
  const workspaceId = row.workspaceId;
  const store = new PgKnowledgeStore(deps.db, workspaceId);
  const service = knowledgeServiceFor(deps, workspaceId, {
    ...(deps.signal ? { signal: deps.signal } : {}),
    runId: `ingest:${sourceId}`,
  });
  const signal = deps.signal ?? new AbortController().signal;
  const result: IngestResult = { indexed: 0, unchanged: 0, deleted: 0, failed: [] };
  await store.setSourceStatus(sourceId, "syncing");
  try {
    // A GitHub token for private repositories: the source's credential (http.bearer).
    const token =
      row.kind === "github" && row.credentialId
        ? (await deps.credentials.decrypt(row.credentialId)).token
        : undefined;
    const loaded = await load(deps, row.kind, row.config, token, signal);
    const existing = await store.sourceDocuments(sourceId);
    const index = async (
      doc: {
        externalId: string;
        text: string;
        title?: string | null;
        uri?: string | null;
        mimeType?: string | null;
        metadata?: JsonObject;
      },
      force: boolean,
    ) => {
      try {
        const r = await service.upsertDocument(
          {
            sourceId,
            externalId: doc.externalId,
            text: doc.text,
            ...(doc.title ? { title: doc.title } : {}),
            ...(doc.uri ? { uri: doc.uri } : {}),
            ...(doc.mimeType ? { mimeType: doc.mimeType } : {}),
            ...(doc.metadata ? { metadata: doc.metadata } : {}),
          },
          { force, keepContent: !loaded },
        );
        if (r.unchanged) result.unchanged++;
        else result.indexed++;
      } catch (error) {
        result.failed.push({
          externalId: doc.externalId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };
    if (loaded) {
      for (const d of loaded.docs) {
        if (signal.aborted) break;
        await index(d, false);
      }
      for (const e of loaded.errors) result.failed.push({ externalId: e.url, message: e.message });
      // documents the loader no longer returns are gone upstream
      const seen = new Set(loaded.docs.map((d) => d.externalId));
      const failedIds = new Set(loaded.errors.map((e) => e.url));
      for (const d of existing)
        if (!seen.has(d.externalId) && !failedIds.has(d.externalId)) {
          await service.deleteDocument(sourceId, d.externalId);
          result.deleted++;
        }
    } else {
      // uploads: re-index what is not indexed (new, failed, or reset by a pipeline change)
      for (const d of existing) {
        if (signal.aborted) break;
        if (d.status === "indexed" || d.content === null) continue;
        await index({ ...d, text: d.content }, true);
      }
    }
    const stats = await store.getSource(sourceId);
    const failed = result.failed.length;
    await store.setSourceStatus(
      sourceId,
      failed && !result.indexed && !result.unchanged ? "error" : "ready",
      {
        synced: true,
        error: failed
          ? `${failed} document${failed > 1 ? "s" : ""} failed: ${result.failed[0]?.message ?? ""}`
          : null,
        stats: {
          documents: stats?.documents ?? 0,
          chunks: stats?.chunks ?? 0,
          lastRun: {
            indexed: result.indexed,
            unchanged: result.unchanged,
            deleted: result.deleted,
            failed,
          },
        },
      },
    );
    return result;
  } catch (error) {
    await store.setSourceStatus(sourceId, "error", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
