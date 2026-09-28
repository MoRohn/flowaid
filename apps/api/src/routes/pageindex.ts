/**
 * PageIndex documents (docs/pageindex/API.md, RFC-0022): PDF uploads into `pageindex` knowledge
 * sources, their versions and indexes, the original files, deletion, and the query playground.
 * Every route is workspace-scoped (other workspaces' ids answer 404) and answers 409
 * `PAGEINDEX_DISABLED` while the service is not configured, except `status`, which reports it.
 *
 * The upload takes the PDF itself as the body, so it lives in its own scope with a raw parser
 * and a 50 MiB limit; the rest of the API keeps JSON bodies and the 2 MiB limit.
 */
import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { artifacts, documentVersions, requestIndexCancel } from "@flowaid/database";
import { MODES, PROTOCOL_VERSION } from "@flowaid/pageindex";
import { ConflictError, ForbiddenError, NotFoundError } from "@flowaid/workflow-core";
import type { Principal } from "../auth/principal.js";
import type { ApiContext } from "../context.js";
import {
  DocumentReferenceSchema,
  DocumentScopeSchema,
  DocumentSummarySchema,
  GroundedAnswerSchema,
  IndexReferenceSchema,
  OutlineNodeSchema,
  PageIndexStatusSchema,
  RetrievalBudgetSchema,
  RetrievalResultSchema,
} from "../dto/pageindex.js";
import { ApiError } from "../plugins/errors.js";
import {
  MAX_PDF_BYTES,
  apiArtifactStorage,
  cleanFileName,
  deleteDocument,
  documentDetail,
  indexReference,
  listDocuments,
  loadIndex,
  outlineOf,
  pageIndexEnabled,
  requestIndex,
  requirePageIndex,
  runQuery,
  serviceStatus,
  uploadDocument,
} from "../services/pageindex.js";

const SourceParams = z.object({ sourceId: z.uuid() });
const DocumentParams = z.object({ documentId: z.uuid() });
const VersionParams = z.object({ documentId: z.uuid(), versionId: z.uuid() });
const IndexParams = z.object({ indexId: z.uuid() });

const UploadResultSchema = z.object({
  document: DocumentSummarySchema,
  version: DocumentReferenceSchema,
  index: IndexReferenceSchema,
  created: z.boolean(),
});
const IndexRequestSchema = z.object({ index: IndexReferenceSchema, created: z.boolean() });

/** Queries (navigation, and generation when answering) a principal may run per minute. */
const QUERIES_PER_MINUTE = 20;

export function pageIndexRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const need = (p: Principal | null): Principal => {
    if (!p) throw new ForbiddenError("no principal");
    requirePageIndex(ctx.config);
    return p;
  };

  r.get(
    "/v1/pageindex/status",
    {
      config: {
        auth: "session_or_api_key",
        scope: "knowledge:read",
        cli: { noun: "pageindex", verb: "status" },
      },
      schema: {
        tags: ["pageindex"],
        summary: "Whether PageIndex is configured and its service answers, and what it can do",
        response: { 200: PageIndexStatusSchema },
      },
    },
    async (req) => {
      if (!req.principal) throw new ForbiddenError("no principal");
      const { reachable, sdkVersion } = await serviceStatus(ctx.config);
      return {
        enabled: pageIndexEnabled(ctx.config),
        reachable,
        sdkVersion,
        protocol: PROTOCOL_VERSION,
        modes: {
          local: { ...MODES.local, capabilities: { ...MODES.local.capabilities } },
          cloud: MODES.cloud,
        },
      };
    },
  );

  r.get(
    "/v1/pageindex/sources/:sourceId/documents",
    {
      config: {
        auth: "session_or_api_key",
        scope: "knowledge:read",
        cli: { noun: "pageindex", verb: "documents", positional: ["sourceId"] },
      },
      schema: {
        tags: ["pageindex"],
        summary: "A pageindex source's documents, newest first",
        params: SourceParams,
        response: { 200: z.object({ items: z.array(DocumentSummarySchema) }) },
      },
    },
    async (req) => {
      const p = need(req.principal);
      return {
        items: await ctx.db.tenant(p.workspaceId, (tx) =>
          listDocuments(tx, p.workspaceId, req.params.sourceId),
        ),
      };
    },
  );

  void app.register((scope, _opts, done) => {
    // the body is the PDF itself: raw bytes up to 50 MiB, whatever the declared type
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      "*",
      { parseAs: "buffer", bodyLimit: MAX_PDF_BYTES },
      (_req, body, next) => next(null, body),
    );
    scope.withTypeProvider<ZodTypeProvider>().post(
      "/v1/pageindex/sources/:sourceId/documents",
      {
        bodyLimit: MAX_PDF_BYTES,
        config: {
          auth: "session_or_api_key",
          scope: "knowledge:write",
          audit: { action: "pageindex_document.upload", resource: "knowledge_source" },
          cli: { noun: "pageindex", verb: "upload", positional: ["sourceId"] },
        },
        schema: {
          tags: ["pageindex"],
          summary:
            "Upload a PDF (the body, at most 50 MiB; X-File-Name URL-encoded) and index it; ?documentId= adds a version",
          params: SourceParams,
          querystring: z.object({ documentId: z.uuid().optional() }),
          response: { 200: UploadResultSchema, 201: UploadResultSchema },
        },
      },
      async (req, reply) => {
        const p = need(req.principal);
        const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const out = await uploadDocument(ctx, p.workspaceId, {
          sourceId: req.params.sourceId,
          documentId: req.query.documentId,
          fileName: cleanFileName(req.headers["x-file-name"]),
          bytes,
        });
        req.audit = {
          resourceId: req.params.sourceId,
          details: {
            documentId: out.document.documentId,
            versionId: out.version.versionId,
            indexId: out.index.indexId,
            bytes: out.version.bytes,
            created: out.created,
          },
        };
        return reply.code(out.created ? 201 : 200).send(out);
      },
    );
    done();
  });

  r.get(
    "/v1/pageindex/documents/:documentId",
    {
      config: {
        auth: "session_or_api_key",
        scope: "knowledge:read",
        cli: { noun: "pageindex", verb: "document", positional: ["documentId"] },
      },
      schema: {
        tags: ["pageindex"],
        summary: "A document with its versions and indexes",
        params: DocumentParams,
        response: {
          200: z.object({
            document: DocumentSummarySchema,
            versions: z.array(DocumentReferenceSchema),
            indexes: z.array(IndexReferenceSchema),
          }),
        },
      },
    },
    async (req) => {
      const p = need(req.principal);
      return ctx.db.tenant(p.workspaceId, (tx) =>
        documentDetail(tx, p.workspaceId, req.params.documentId),
      );
    },
  );

  r.get(
    "/v1/pageindex/documents/:documentId/versions/:versionId/file",
    {
      config: {
        auth: "session_or_api_key",
        scope: "knowledge:read",
        cli: { noun: "pageindex", verb: "file", positional: ["documentId", "versionId"] },
      },
      schema: {
        tags: ["pageindex"],
        summary: "The original PDF of one version, inline",
        params: VersionParams,
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const found = await ctx.db.tenant(p.workspaceId, async (tx) => {
        // 404 for deleted documents and anything outside the workspace
        await documentDetail(tx, p.workspaceId, req.params.documentId);
        const [row] = await tx
          .select({ version: documentVersions, artifact: artifacts })
          .from(documentVersions)
          .innerJoin(artifacts, eq(artifacts.id, documentVersions.artifactId))
          .where(
            and(
              eq(documentVersions.id, req.params.versionId),
              eq(documentVersions.documentId, req.params.documentId),
              eq(documentVersions.workspaceId, p.workspaceId),
              eq(artifacts.workspaceId, p.workspaceId),
            ),
          );
        return row ?? null;
      });
      if (!found) throw new NotFoundError("document version not found");
      const storage = apiArtifactStorage(ctx.config);
      if (!storage)
        throw new ApiError(
          503,
          "STORAGE_UNAVAILABLE",
          "artifact storage is not available to the API",
        );
      const object = await storage.forKind(found.artifact.storage).open(found.artifact.storageKey);
      const name = found.version.fileName;
      void reply
        .header("content-type", "application/pdf")
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "private, no-store")
        .header(
          "content-disposition",
          `inline; filename="${name.replace(/[^A-Za-z0-9._-]+/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        );
      if (object.size >= 0) void reply.header("content-length", object.size);
      return reply.send(Readable.fromWeb(object.body));
    },
  );

  r.post(
    "/v1/pageindex/documents/:documentId/index",
    {
      config: {
        auth: "session_or_api_key",
        scope: "knowledge:write",
        audit: {
          action: "pageindex_index.request",
          resource: "pageindex_document",
          idParam: "documentId",
        },
        cli: { noun: "pageindex", verb: "index", positional: ["documentId"] },
      },
      schema: {
        tags: ["pageindex"],
        summary:
          "Build (or join) the latest version's index with the source's settings; retries a failed build",
        params: DocumentParams,
        response: { 200: IndexRequestSchema, 202: IndexRequestSchema },
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const out = await requestIndex(ctx, p.workspaceId, req.params.documentId);
      req.audit = { details: { indexId: out.index.indexId, created: out.created } };
      return reply.code(out.created ? 202 : 200).send(out);
    },
  );

  r.delete(
    "/v1/pageindex/documents/:documentId",
    {
      config: {
        auth: "session_or_api_key",
        scope: "knowledge:write",
        audit: {
          action: "pageindex_document.delete",
          resource: "pageindex_document",
          idParam: "documentId",
        },
        cli: { noun: "pageindex", verb: "delete", positional: ["documentId"] },
      },
      schema: {
        tags: ["pageindex"],
        summary: "Revoke a document and its indexes now; upstream cleanup runs as a job",
        params: DocumentParams,
        response: { 202: z.object({ documentId: z.uuid(), status: z.literal("deleted") }) },
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      await deleteDocument(ctx, p.workspaceId, req.params.documentId);
      return reply.code(202).send({ documentId: req.params.documentId, status: "deleted" });
    },
  );

  r.get(
    "/v1/pageindex/indexes/:indexId",
    {
      config: {
        auth: "session_or_api_key",
        scope: "knowledge:read",
        cli: { noun: "pageindex", verb: "get-index", positional: ["indexId"] },
      },
      schema: {
        tags: ["pageindex"],
        params: IndexParams,
        response: { 200: IndexReferenceSchema },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const i = await ctx.db.tenant(p.workspaceId, (tx) =>
        loadIndex(tx, p.workspaceId, req.params.indexId),
      );
      return indexReference(i.row, i.version, i.title);
    },
  );

  r.get(
    "/v1/pageindex/indexes/:indexId/outline",
    {
      config: {
        auth: "session_or_api_key",
        scope: "knowledge:read",
        cli: { noun: "pageindex", verb: "outline", positional: ["indexId"] },
      },
      schema: {
        tags: ["pageindex"],
        summary: "The section tree of a ready (or superseded) index",
        params: IndexParams,
        response: { 200: z.object({ outline: z.array(OutlineNodeSchema) }) },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const i = await ctx.db.tenant(p.workspaceId, (tx) =>
        loadIndex(tx, p.workspaceId, req.params.indexId),
      );
      if (i.row.state !== "ready" && i.row.state !== "superseded")
        throw new ApiError(409, "INDEX_NOT_READY", `the index is ${i.row.state}, not ready`);
      return { outline: outlineOf(i.row) };
    },
  );

  r.post(
    "/v1/pageindex/indexes/:indexId/cancel",
    {
      config: {
        auth: "session_or_api_key",
        scope: "knowledge:write",
        audit: {
          action: "pageindex_index.cancel",
          resource: "pageindex_index",
          idParam: "indexId",
        },
        cli: { noun: "pageindex", verb: "cancel", positional: ["indexId"] },
      },
      schema: {
        tags: ["pageindex"],
        summary: "Cancel a build: a queued one at once, a running one when the worker next checks",
        params: IndexParams,
        response: { 200: IndexReferenceSchema },
      },
    },
    async (req) => {
      const p = need(req.principal);
      return ctx.db.tenant(p.workspaceId, async (tx) => {
        const i = await loadIndex(tx, p.workspaceId, req.params.indexId);
        const row = await requestIndexCancel(tx, p.workspaceId, i.row.id);
        if (!row)
          throw new ConflictError(
            `the index is ${i.row.state}; only queued or running builds can be canceled`,
          );
        return indexReference(row, i.version, i.title);
      });
    },
  );

  r.post(
    "/v1/pageindex/query",
    {
      config: {
        auth: "session_or_api_key",
        scope: "knowledge:read",
        audit: { action: "pageindex.query", resource: "workspace" },
        rateLimit: { max: QUERIES_PER_MINUTE, timeWindow: 60_000 },
        cli: { noun: "pageindex", verb: "query" },
      },
      schema: {
        tags: ["pageindex"],
        summary:
          "Retrieve evidence by navigating the scope's indexes; optionally answer with checked citations",
        body: z.object({
          query: z.string().trim().min(1).max(4000),
          scope: DocumentScopeSchema,
          answer: z.boolean().default(false),
          budget: RetrievalBudgetSchema.optional(),
        }),
        response: {
          200: z.object({
            retrieval: RetrievalResultSchema,
            answer: GroundedAnswerSchema.nullable(),
            model: z.object({ provider: z.string(), model: z.string() }).nullable(),
          }),
        },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const controller = new AbortController();
      req.raw.once("close", () => {
        if (!req.raw.complete) controller.abort();
      });
      const b = req.body;
      const out = await runQuery(
        ctx,
        p.workspaceId,
        {
          query: b.query,
          scope: b.scope,
          answer: b.answer,
          ...(b.budget ? { budget: b.budget } : {}),
        },
        controller.signal,
      );
      // counts and cost only: the question and the evidence stay out of the audit log
      req.audit = {
        resourceId: p.workspaceId,
        details: {
          documents: out.retrieval.activity.documents,
          evidence: out.retrieval.evidence.length,
          decisions: out.retrieval.activity.decisions,
          pagesRead: out.retrieval.activity.pagesRead,
          status: out.retrieval.status,
          answered: out.answer !== null,
          answerStatus: out.answer?.status ?? null,
          citations: out.answer?.citations.length ?? 0,
          costUsd: out.costUsd,
          model: out.model ? `${out.model.provider}/${out.model.model}` : null,
        },
      };
      return { retrieval: out.retrieval, answer: out.answer, model: out.model };
    },
  );
}
