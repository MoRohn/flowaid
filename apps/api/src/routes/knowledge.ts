/**
 * Knowledge bases (API.md §3, ARCHITECTURE.md §10.8): sources and their pipeline (chunker,
 * embedding model, index), uploads, sync (the worker's `ingest.source` job on the `ingest` queue),
 * documents, chunks, and a query playground over the same service retrieval nodes use.
 */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, asc, desc, eq, lt, ne, or } from "drizzle-orm";
import { chunks, credentials, documents, knowledgeSources, type Tx } from "@flowaid/database";
import { REMOTE_INDEX_KINDS } from "@flowaid/knowledge";
import { uuidv7 } from "@flowaid/shared";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type JsonObject,
} from "@flowaid/workflow-core";
import type { Principal } from "../auth/principal.js";
import type { ApiContext } from "../context.js";
import {
  IdParams,
  ListQuery,
  NoContent,
  PageQuery,
  afterCursor,
  decodeCursor,
  encodeCursor,
  page,
  toPage,
} from "../dto/common.js";
import { indexFor, knowledgeServiceFor } from "../services/knowledge.js";
import {
  checkPageIndexConfig,
  deleteDocument as deletePageIndexDocument,
  deletePageIndexSource,
  requirePageIndex,
} from "../services/pageindex.js";

type SourceRow = typeof knowledgeSources.$inferSelect;
type DocumentRow = typeof documents.$inferSelect;

/** Kinds whose documents are uploaded (the others are fetched by a loader on sync). */
export const UPLOAD_KINDS = ["files", "text"] as const;
/**
 * PageIndex sources (RFC-0022) hold uploaded PDFs indexed by the PageIndex service: no loader,
 * no sync, and their uploads go through `POST /v1/pageindex/sources/:id/documents`.
 */
export const PAGEINDEX_KIND = "pageindex";
const SOURCE_KINDS = [...UPLOAD_KINDS, "url", "sitemap", "github", PAGEINDEX_KIND] as const;
/** Kinds that never sync: their documents arrive by upload. */
const NO_SYNC_KINDS: readonly string[] = [...UPLOAD_KINDS, PAGEINDEX_KIND];

const ModelRefSchema = z.object({ provider: z.string().min(1), model: z.string().min(1) });
const PipelineSchema = z.object({
  chunker: z
    .object({
      strategy: z.enum(["recursive", "markdown", "fixed"]).optional(),
      chunkTokens: z.int().min(20).max(4000).optional(),
      overlapTokens: z.int().min(0).max(1000).optional(),
    })
    .optional(),
  /** null: keyword search only */
  embedding: ModelRefSchema.nullable().optional(),
  /** the credential the embedding model uses (default: the workspace's, then the server's) */
  embeddingCredentialId: z.uuid().optional(),
  index: z
    .object({
      adapter: z.enum(["pgvector", ...REMOTE_INDEX_KINDS]),
      url: z.string().url().optional(),
      collection: z.string().min(1).max(200).optional(),
      dimensions: z.int().min(1).max(8192).optional(),
    })
    .optional(),
});
type Pipeline = z.infer<typeof PipelineSchema>;

export const KnowledgeSourceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.string(),
  config: z.record(z.string(), z.unknown()),
  pipeline: z.record(z.string(), z.unknown()),
  credentialId: z.uuid().nullable(),
  status: z.enum(["new", "syncing", "ready", "stale", "error"]),
  stats: z.record(z.string(), z.unknown()),
  documents: z.int(),
  chunks: z.int(),
  lastSyncAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const KnowledgeDocumentSchema = z.object({
  id: z.uuid(),
  sourceId: z.uuid(),
  externalId: z.string(),
  title: z.string().nullable(),
  uri: z.string().nullable(),
  mimeType: z.string().nullable(),
  status: z.enum(["pending", "indexed", "error", "deleted"]),
  chunkCount: z.int(),
  metadata: z.record(z.string(), z.unknown()),
  error: z.string().nullable(),
  updatedAt: z.string(),
});

const ChunkSchema = z.object({
  id: z.uuid(),
  ordinal: z.int(),
  content: z.string(),
  tokens: z.int(),
  metadata: z.record(z.string(), z.unknown()),
  embedded: z.boolean(),
});

const HitSchema = z.object({
  chunkId: z.string(),
  documentId: z.string(),
  sourceId: z.string(),
  ordinal: z.int(),
  content: z.string(),
  score: z.number(),
  title: z.string().nullable(),
  uri: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

const docDto = (d: DocumentRow) => ({
  id: d.id,
  sourceId: d.sourceId,
  externalId: d.externalId,
  title: d.title,
  uri: d.uri,
  mimeType: d.mimeType,
  status: d.status,
  chunkCount: d.chunkCount,
  metadata: d.metadata,
  error: d.error,
  updatedAt: d.updatedAt.toISOString(),
});

const sourceDto = (s: SourceRow, counts: { documents: number; chunks: number }) => ({
  id: s.id,
  name: s.name,
  kind: s.kind,
  config: s.config,
  pipeline: s.pipeline,
  credentialId: s.credentialId,
  status: s.status,
  stats: s.stats,
  documents: counts.documents,
  chunks: counts.chunks,
  lastSyncAt: s.lastSyncAt?.toISOString() ?? null,
  lastError: s.lastError,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

/**
 * Remote kinds need what their loader reads; pageindex sources need an indexing model (and a
 * credential of its type, when they name one). Returns the config as stored.
 */
async function checkConfig(
  tx: Tx,
  workspaceId: string,
  kind: string,
  config: JsonObject,
): Promise<JsonObject> {
  if (kind === PAGEINDEX_KIND) {
    const c = await checkPageIndexConfig(tx, workspaceId, config);
    return {
      indexModel: { provider: c.indexModel.provider, model: c.indexModel.model },
      credentialId: c.credentialId,
      mode: c.mode,
      optimize: c.optimize,
    };
  }
  const has = (k: string) => typeof config[k] === "string" && config[k] !== "";
  if (kind === "url" && !has("url") && !Array.isArray(config.urls))
    throw new BadRequestError("a url source needs config.url or config.urls");
  if (kind === "sitemap" && !has("url"))
    throw new BadRequestError("a sitemap source needs config.url");
  if (
    kind === "github" &&
    !(typeof config.repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(config.repo))
  )
    throw new BadRequestError("a github source needs config.repo (owner/name)");
  return config;
}

async function checkCredential(tx: Tx, workspaceId: string, id: string | null | undefined) {
  if (!id) return;
  const [c] = await tx
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.workspaceId, workspaceId)));
  if (!c) throw new BadRequestError("credential not found");
}

export function knowledgeRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const need = (p: Principal | null): Principal => {
    if (!p) throw new ForbiddenError("no principal");
    return p;
  };
  const loadSource = async (tx: Tx, p: Principal, id: string) => {
    const [s] = await tx
      .select()
      .from(knowledgeSources)
      .where(and(eq(knowledgeSources.id, id), eq(knowledgeSources.workspaceId, p.workspaceId)));
    if (!s) throw new NotFoundError("knowledge source not found");
    return s;
  };
  const loadDocument = async (tx: Tx, p: Principal, id: string) => {
    const [d] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.workspaceId, p.workspaceId)));
    if (!d) throw new NotFoundError("document not found");
    return d;
  };
  const counts = async (workspaceId: string, id: string) => {
    const s = await knowledgeServiceFor(ctx, workspaceId).sources();
    const c = s.find((x) => x.id === id);
    return { documents: c?.documents ?? 0, chunks: c?.chunks ?? 0 };
  };
  const enqueueSync = (sourceId: string) =>
    ctx.queue.enqueue("ingest", { type: "ingest.source", sourceId });

  r.get(
    "/v1/knowledge/sources",
    {
      config: {
        auth: "session_or_api_key",
        scope: "knowledge:read",
        cli: { noun: "knowledge", verb: "list" },
      },
      schema: {
        tags: ["knowledge"],
        summary: "Knowledge sources with document and chunk counts",
        querystring: PageQuery,
        response: { 200: page(KnowledgeSourceSchema) },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const { limit, cursor } = req.query;
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select()
          .from(knowledgeSources)
          .where(
            and(
              eq(knowledgeSources.workspaceId, p.workspaceId),
              afterCursor(knowledgeSources.name, knowledgeSources.id, cursor),
            ),
          )
          .orderBy(asc(knowledgeSources.name), asc(knowledgeSources.id))
          .limit(limit + 1),
      );
      const summary = new Map(
        (await knowledgeServiceFor(ctx, p.workspaceId).sources()).map((s) => [s.id, s]),
      );
      return toPage(
        rows,
        limit,
        (s) => [s.name, s.id],
        (s) =>
          sourceDto(s, {
            documents: summary.get(s.id)?.documents ?? 0,
            chunks: summary.get(s.id)?.chunks ?? 0,
          }),
      );
    },
  );

  r.post(
    "/v1/knowledge/sources",
    {
      config: {
        auth: "session_or_api_key",
        scope: "knowledge:write",
        audit: { action: "knowledge_source.create", resource: "knowledge_source" },
        cli: { noun: "knowledge", verb: "create" },
      },
      schema: {
        tags: ["knowledge"],
        summary: "Create a knowledge source (remote kinds start syncing)",
        body: z.object({
          name: z.string().min(1).max(200),
          kind: z.enum(SOURCE_KINDS),
          config: z.record(z.string(), z.unknown()).default({}),
          pipeline: PipelineSchema.default({}),
          /** the loader's (GitHub token) or remote index's credential */
          credentialId: z.uuid().nullable().optional(),
        }),
        response: { 201: KnowledgeSourceSchema },
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const b = req.body;
      // PageIndex sources are indexed by the PageIndex service, so they need it configured
      if (b.kind === PAGEINDEX_KIND) requirePageIndex(ctx.config);
      if (b.pipeline.index && b.pipeline.index.adapter !== "pgvector" && !b.pipeline.index.url)
        throw new BadRequestError("a remote index needs pipeline.index.url");
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const config = await checkConfig(tx, p.workspaceId, b.kind, b.config as JsonObject);
        const [dup] = await tx
          .select({ id: knowledgeSources.id })
          .from(knowledgeSources)
          .where(
            and(eq(knowledgeSources.workspaceId, p.workspaceId), eq(knowledgeSources.name, b.name)),
          );
        if (dup) throw new ConflictError(`a knowledge source named ${b.name} exists`);
        await checkCredential(tx, p.workspaceId, b.credentialId);
        await checkCredential(tx, p.workspaceId, b.pipeline.embeddingCredentialId);
        const [created] = await tx
          .insert(knowledgeSources)
          .values({
            id: uuidv7(),
            workspaceId: p.workspaceId,
            name: b.name,
            kind: b.kind,
            config,
            pipeline: b.pipeline as JsonObject,
            credentialId: b.credentialId ?? null,
          })
          .returning();
        return created as SourceRow;
      });
      req.audit.resourceId = row.id;
      if (!NO_SYNC_KINDS.includes(row.kind)) await enqueueSync(row.id);
      return reply.code(201).send(sourceDto(row, { documents: 0, chunks: 0 }));
    },
  );

  r.get(
    "/v1/knowledge/sources/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "knowledge:read",
        cli: { noun: "knowledge", verb: "get", positional: ["id"] },
      },
      schema: {
        tags: ["knowledge"],
        params: IdParams,
        response: { 200: KnowledgeSourceSchema },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const s = await ctx.db.tenant(p.workspaceId, (tx) => loadSource(tx, p, req.params.id));
      return sourceDto(s, await counts(p.workspaceId, s.id));
    },
  );

  r.patch(
    "/v1/knowledge/sources/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "knowledge:write",
        audit: { action: "knowledge_source.update", resource: "knowledge_source" },
        cli: { noun: "knowledge", verb: "update", positional: ["id"] },
      },
      schema: {
        tags: ["knowledge"],
        summary: "Rename or reconfigure a source; a pipeline change re-indexes it",
        params: IdParams,
        body: z.object({
          name: z.string().min(1).max(200).optional(),
          config: z.record(z.string(), z.unknown()).optional(),
          pipeline: PipelineSchema.optional(),
          credentialId: z.uuid().nullable().optional(),
        }),
        response: { 200: KnowledgeSourceSchema },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const b = req.body;
      const { row, reindex } = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const s = await loadSource(tx, p, req.params.id);
        const config = b.config
          ? await checkConfig(tx, p.workspaceId, s.kind, b.config as JsonObject)
          : undefined;
        await checkCredential(tx, p.workspaceId, b.credentialId);
        await checkCredential(tx, p.workspaceId, b.pipeline?.embeddingCredentialId);
        // a pageindex source's settings apply to the next index request; nothing syncs
        const pipelineChanged =
          s.kind !== PAGEINDEX_KIND &&
          b.pipeline !== undefined &&
          JSON.stringify(b.pipeline) !== JSON.stringify(s.pipeline);
        const [updated] = await tx
          .update(knowledgeSources)
          .set({
            ...(b.name ? { name: b.name } : {}),
            ...(config ? { config } : {}),
            ...(b.pipeline ? { pipeline: b.pipeline } : {}),
            ...(b.credentialId !== undefined ? { credentialId: b.credentialId } : {}),
            ...(pipelineChanged ? { status: "stale" as const } : {}),
            updatedAt: new Date(),
          })
          .where(eq(knowledgeSources.id, s.id))
          .returning();
        // new chunking or embeddings: every document is indexed again on the next sync
        if (pipelineChanged)
          await tx
            .update(documents)
            .set({ status: "pending", updatedAt: new Date() })
            .where(eq(documents.sourceId, s.id));
        return {
          row: updated as SourceRow,
          reindex: s.kind !== PAGEINDEX_KIND && (pipelineChanged || b.config !== undefined),
        };
      });
      req.audit.resourceId = row.id;
      if (reindex) await enqueueSync(row.id);
      return sourceDto(row, await counts(p.workspaceId, row.id));
    },
  );

  r.delete(
    "/v1/knowledge/sources/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "knowledge:write",
        audit: { action: "knowledge_source.delete", resource: "knowledge_source" },
        cli: { noun: "knowledge", verb: "delete", positional: ["id"] },
      },
      schema: { tags: ["knowledge"], params: IdParams, response: { 204: NoContent } },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const s = await ctx.db.tenant(p.workspaceId, (tx) => loadSource(tx, p, req.params.id));
      // PageIndex documents leave indexes upstream and files in storage: revoke, clean up, then
      // delete the row (see deletePageIndexSource for the order)
      if (s.kind === PAGEINDEX_KIND) {
        await deletePageIndexSource(ctx, p.workspaceId, s.id);
        return reply.code(204).send(null);
      }
      // remote indexes keep their own copy; pgvector chunks cascade with the row
      if (
        (s.pipeline as Pipeline).index?.adapter &&
        (s.pipeline as Pipeline).index?.adapter !== "pgvector"
      )
        await (
          await indexFor(ctx, p.workspaceId, { id: s.id, pipeline: s.pipeline })
        )
          .deleteSource(s.id)
          .catch((error: unknown) => req.log.warn({ err: error }, "remote index delete failed"));
      await ctx.db.tenant(p.workspaceId, (tx) =>
        tx.delete(knowledgeSources).where(eq(knowledgeSources.id, s.id)),
      );
      return reply.code(204).send(null);
    },
  );

  r.post(
    "/v1/knowledge/sources/:id/sync",
    {
      config: {
        auth: "session_or_api_key",
        scope: "knowledge:write",
        audit: { action: "knowledge_source.sync", resource: "knowledge_source" },
        cli: { noun: "knowledge", verb: "sync", positional: ["id"] },
      },
      schema: {
        tags: ["knowledge"],
        summary: "Queue a sync: load, chunk, embed and index what changed",
        params: IdParams,
        response: { 202: z.object({ id: z.uuid(), status: z.string() }) },
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const s = await ctx.db.tenant(p.workspaceId, (tx) => loadSource(tx, p, req.params.id));
      if (s.kind === PAGEINDEX_KIND)
        throw new BadRequestError(
          "a pageindex source does not sync; index a document with POST /v1/pageindex/documents/:documentId/index",
        );
      await enqueueSync(s.id);
      return reply.code(202).send({ id: s.id, status: "queued" });
    },
  );

  r.get(
    "/v1/knowledge/sources/:id/documents",
    {
      config: {
        auth: "session_or_api_key",
        scope: "knowledge:read",
        cli: { noun: "knowledge", verb: "documents", positional: ["id"] },
      },
      schema: {
        tags: ["knowledge"],
        params: IdParams,
        querystring: ListQuery,
        response: { 200: page(KnowledgeDocumentSchema) },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const cursor = decodeCursor(req.query.cursor);
      const rows = await ctx.db.tenant(p.workspaceId, async (tx) => {
        await loadSource(tx, p, req.params.id);
        return tx
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.sourceId, req.params.id),
              cursor
                ? or(
                    lt(documents.updatedAt, new Date(String(cursor[0]))),
                    and(
                      eq(documents.updatedAt, new Date(String(cursor[0]))),
                      lt(documents.id, cursor[1]),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(documents.updatedAt), desc(documents.id))
          .limit(req.query.limit + 1);
      });
      const items = rows.slice(0, req.query.limit);
      const last = items.at(-1);
      return {
        items: items.map(docDto),
        next_cursor:
          rows.length > req.query.limit && last
            ? encodeCursor(last.updatedAt.toISOString(), last.id)
            : null,
      };
    },
  );

  r.post(
    "/v1/knowledge/sources/:id/documents",
    {
      config: {
        auth: "session_or_api_key",
        scope: "knowledge:write",
        audit: { action: "knowledge_document.upload", resource: "knowledge_source" },
        cli: { noun: "knowledge", verb: "upload", positional: ["id"] },
      },
      schema: {
        tags: ["knowledge"],
        summary: "Upload text documents to a files or text source; they index on the next sync",
        params: IdParams,
        body: z.object({
          documents: z
            .array(
              z.object({
                externalId: z.string().min(1).max(500).optional(),
                title: z.string().max(500).optional(),
                uri: z.string().max(2000).optional(),
                mimeType: z
                  .enum(["text/plain", "text/markdown", "text/html", "application/json"])
                  .default("text/plain"),
                text: z.string().min(1).max(2_000_000),
                metadata: z
                  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
                  .default({}),
              }),
            )
            .min(1)
            .max(100),
        }),
        response: { 202: z.object({ documents: z.array(KnowledgeDocumentSchema) }) },
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const rows = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const s = await loadSource(tx, p, req.params.id);
        if (s.kind === PAGEINDEX_KIND)
          throw new BadRequestError(
            "a pageindex source takes PDFs: upload the file itself with POST /v1/pageindex/sources/:sourceId/documents",
          );
        if (!(UPLOAD_KINDS as readonly string[]).includes(s.kind))
          throw new BadRequestError(`a ${s.kind} source loads its own documents; sync it instead`);
        const out: DocumentRow[] = [];
        for (const d of req.body.documents) {
          const values = {
            title: d.title ?? d.externalId ?? null,
            uri: d.uri ?? null,
            mimeType: d.mimeType,
            // the sync hashes the normalised text; until then the document is pending
            contentHash: "",
            metadata: d.metadata,
            status: "pending" as const,
            content: d.text,
            error: null,
            updatedAt: new Date(),
          };
          const [row] = await tx
            .insert(documents)
            .values({
              id: uuidv7(),
              workspaceId: p.workspaceId,
              sourceId: s.id,
              externalId: d.externalId ?? d.title ?? uuidv7(),
              ...values,
            })
            .onConflictDoUpdate({ target: [documents.sourceId, documents.externalId], set: values })
            .returning();
          out.push(row as DocumentRow);
        }
        return out;
      });
      req.audit.resourceId = req.params.id;
      await enqueueSync(req.params.id);
      return reply.code(202).send({ documents: rows.map(docDto) });
    },
  );

  r.delete(
    "/v1/knowledge/documents/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "knowledge:write",
        audit: { action: "knowledge_document.delete", resource: "knowledge_document" },
        cli: { noun: "knowledge", verb: "delete-document", positional: ["id"] },
      },
      schema: { tags: ["knowledge"], params: IdParams, response: { 204: NoContent } },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const { d, s } = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const d = await loadDocument(tx, p, req.params.id);
        return { d, s: await loadSource(tx, p, d.sourceId) };
      });
      // a PageIndex document is revoked and cleaned up like DELETE /v1/pageindex/documents/:id
      if (s.kind === PAGEINDEX_KIND) await deletePageIndexDocument(ctx, p.workspaceId, d.id);
      else await knowledgeServiceFor(ctx, p.workspaceId).deleteDocument(d.sourceId, d.externalId);
      // an upload source in error because of its failed documents is no longer in error once the
      // last of them is removed (a fetched source's error is its last sync's, so it stays)
      if ((UPLOAD_KINDS as readonly string[]).includes(s.kind) && s.status === "error")
        await ctx.db.tenant(p.workspaceId, async (tx) => {
          const left = await tx
            .select({ status: documents.status })
            .from(documents)
            .where(and(eq(documents.sourceId, s.id), ne(documents.status, "deleted")));
          if (left.some((x) => x.status === "error")) return;
          await tx
            .update(knowledgeSources)
            .set({
              status:
                left.length === 0
                  ? "new"
                  : left.some((x) => x.status === "pending")
                    ? "stale"
                    : "ready",
              lastError: null,
              updatedAt: new Date(),
            })
            .where(eq(knowledgeSources.id, s.id));
        });
      return reply.code(204).send(null);
    },
  );

  r.get(
    "/v1/knowledge/documents/:id/chunks",
    {
      config: {
        auth: "session_or_api_key",
        scope: "knowledge:read",
        cli: { noun: "knowledge", verb: "chunks", positional: ["id"] },
      },
      schema: {
        tags: ["knowledge"],
        summary: "A document's chunks (pgvector sources; remote indexes keep their own)",
        params: IdParams,
        response: { 200: z.array(ChunkSchema) },
      },
    },
    async (req) => {
      const p = need(req.principal);
      return ctx.db.tenant(p.workspaceId, async (tx) => {
        await loadDocument(tx, p, req.params.id);
        const rows = await tx
          .select({
            id: chunks.id,
            ordinal: chunks.ordinal,
            content: chunks.content,
            tokens: chunks.tokens,
            metadata: chunks.metadata,
            embedding: chunks.embedding,
          })
          .from(chunks)
          .where(eq(chunks.documentId, req.params.id))
          .orderBy(asc(chunks.ordinal))
          .limit(1000);
        return rows.map(({ embedding, ...c }) => ({ ...c, embedded: embedding !== null }));
      });
    },
  );

  r.post(
    "/v1/knowledge/sources/:id/query",
    {
      config: {
        auth: "session_or_api_key",
        scope: "knowledge:read",
        audit: false,
        cli: { noun: "knowledge", verb: "query", positional: ["id"] },
      },
      schema: {
        tags: ["knowledge"],
        summary: "Search a source (the playground): vector, keyword or hybrid",
        params: IdParams,
        body: z.object({
          text: z.string().min(1).max(4000),
          topK: z.int().min(1).max(50).default(5),
          /** hybrid (the default) fuses vector and keyword rankings */
          mode: z.enum(["vector", "keyword", "hybrid"]).optional(),
          hybrid: z.boolean().optional(),
          filter: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
        }),
        response: {
          200: z.object({
            hits: z.array(HitSchema),
            mode: z.enum(["vector", "keyword", "hybrid"]),
            costUsd: z.number(),
          }),
        },
      },
    },
    async (req) => {
      const p = need(req.principal);
      await ctx.db.tenant(p.workspaceId, (tx) => loadSource(tx, p, req.params.id));
      const b = req.body;
      const mode = b.mode ?? (b.hybrid === false ? "vector" : "hybrid");
      const r = await knowledgeServiceFor(ctx, p.workspaceId).search({
        sourceIds: [req.params.id],
        query: b.text,
        mode,
        k: b.topK,
        ...(b.filter ? { filter: b.filter } : {}),
      });
      return {
        hits: r.hits.map((h) => ({
          chunkId: h.chunkId,
          documentId: h.documentId,
          sourceId: h.sourceId,
          ordinal: h.ordinal,
          content: h.content,
          score: h.score,
          title: h.title ?? null,
          uri: h.uri ?? null,
          metadata: h.metadata,
        })),
        mode: r.mode,
        costUsd: r.costUsd,
      };
    },
  );
}
