/**
 * Ingestion nodes (ARCHITECTURE.md §10.8): `loader` (URL, sitemap, GitHub repository or inline
 * text → normalised documents), `chunker` (documents → token chunks with overlap), `embed`
 * (chunks → chunks with vectors) and `upsert` (documents or chunks → a knowledge source, idempotent
 * by content hash). Together they are the `ingest.source` pipeline as a workflow.
 */
import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { BadRequestError, type JsonObject } from "@flowaid/workflow-core";
import {
  chunkText,
  loadGithub,
  loadSitemap,
  loadText,
  loadUrl,
  type LoadedDocument,
} from "@flowaid/knowledge";
import { callCtx, modelRef, usageSchema } from "../common.js";
import { chunkSchema, documentSchema } from "./common.js";

const asDocuments = (docs: LoadedDocument[]) =>
  docs.map((d) => ({
    externalId: d.externalId,
    ...(d.title ? { title: d.title } : {}),
    ...(d.uri ? { uri: d.uri } : {}),
    mimeType: d.mimeType,
    text: d.text,
    metadata: d.metadata,
  }));

export const loaderNode = defineNode({
  id: "flowaid.retrieval.loader",
  version: "1.0.0",
  metadata: {
    name: "Load documents",
    description:
      "Loads documents from a web page, a sitemap, a GitHub repository or inline text, normalised to markdown for chunking.",
    category: "retrieval",
    icon: "file-down",
    tags: ["retrieval", "rag", "ingest", "loader"],
    summary: "{{ config.kind }}",
  },
  configSchema: z.strictObject({
    kind: z.enum(["url", "sitemap", "github", "text"]).default("url"),
    url: z
      .string()
      .max(2000)
      .optional()
      .meta({ "x-ui": { showWhen: { path: "/kind", oneOf: ["url", "sitemap"] } } }),
    include: z
      .array(z.string().max(200))
      .max(50)
      .optional()
      .meta({
        "x-ui": {
          help: "Sitemap: only pages whose path starts with one of these.",
          showWhen: { path: "/kind", equals: "sitemap" },
        },
      }),
    maxPages: z.int().min(1).max(2000).default(200),
    repo: z
      .string()
      .max(200)
      .optional()
      .meta({ "x-ui": { help: "owner/name", showWhen: { path: "/kind", equals: "github" } } }),
    ref: z
      .string()
      .max(200)
      .optional()
      .meta({ "x-ui": { showWhen: { path: "/kind", equals: "github" } } }),
    path: z
      .string()
      .max(500)
      .optional()
      .meta({ "x-ui": { showWhen: { path: "/kind", equals: "github" } } }),
    extensions: z
      .array(z.string().max(20))
      .max(30)
      .optional()
      .meta({ "x-ui": { showWhen: { path: "/kind", equals: "github" } } }),
    maxFiles: z.int().min(1).max(5000).default(500),
  }),
  inputSchema: z.object({
    /** overrides config.url */
    url: z.string().optional(),
    /** kind text: the document */
    text: z.string().optional(),
    title: z.string().optional(),
    /** kind text: the document's id in the source (default: one per node run) */
    external_id: z.string().optional(),
  }),
  outputSchema: z.object({
    documents: z.array(documentSchema),
    errors: z.array(z.object({ url: z.string(), message: z.string() })),
  }),
  credentials: [
    {
      name: "github",
      types: ["http.bearer"],
      required: false,
      description: "A GitHub token: private repositories and a higher rate limit.",
    },
  ],
  capabilities: ["network", "credentials"],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 300000 },
  execute: async (ctx, input) => {
    const c = ctx.config;
    const opts = { signal: ctx.signal };
    switch (c.kind) {
      case "text": {
        if (input.text === undefined) throw new BadRequestError("bind text for the text loader");
        const doc = loadText({
          externalId: input.external_id ?? `text:${ctx.node.nodeRunId}`,
          text: input.text,
          ...(input.title ? { title: input.title } : {}),
        });
        return ok({ documents: asDocuments([doc]), errors: [] });
      }
      case "url": {
        const url = input.url ?? c.url;
        if (!url) throw new BadRequestError("set url (config or input)");
        return ok({ documents: asDocuments([await loadUrl(ctx.http, url, opts)]), errors: [] });
      }
      case "sitemap": {
        const url = input.url ?? c.url;
        if (!url) throw new BadRequestError("set the sitemap url (config or input)");
        const r = await loadSitemap(ctx.http, url, {
          ...opts,
          maxPages: c.maxPages,
          ...(c.include ? { include: c.include } : {}),
        });
        return ok({ documents: asDocuments(r.documents), errors: r.errors });
      }
      case "github": {
        if (!c.repo) throw new BadRequestError("set repo (owner/name)");
        const token = ctx.credentials.has("github")
          ? (await ctx.credentials.get("github")).token
          : undefined;
        const docs = await loadGithub(ctx.http, {
          ...opts,
          repo: c.repo,
          maxFiles: c.maxFiles,
          ...(c.ref ? { ref: c.ref } : {}),
          ...(c.path ? { path: c.path } : {}),
          ...(c.extensions ? { extensions: c.extensions } : {}),
          ...(token ? { token } : {}),
        });
        return ok({ documents: asDocuments(docs), errors: [] });
      }
    }
  },
});

export const chunkerNode = defineNode({
  id: "flowaid.retrieval.chunker",
  version: "1.0.0",
  metadata: {
    name: "Chunk text",
    description:
      "Splits documents into chunks by tokens with overlap: recursive (paragraphs, lines, sentences, words), markdown-aware (by heading) or fixed windows.",
    category: "retrieval",
    icon: "scissors",
    tags: ["retrieval", "rag", "chunker", "splitter"],
    summary: "{{ config.strategy }} · {{ config.chunkTokens }} tokens",
  },
  configSchema: z.strictObject({
    strategy: z.enum(["recursive", "markdown", "fixed"]).default("recursive"),
    chunkTokens: z.int().min(16).max(8000).default(400),
    overlapTokens: z.int().min(0).max(2000).default(60),
  }),
  inputSchema: z.object({
    documents: z.array(documentSchema).optional(),
    /** a single text (its chunks get externalId "text") */
    text: z.string().optional(),
  }),
  outputSchema: z.object({ chunks: z.array(chunkSchema), count: z.int().min(0) }),
  capabilities: [],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 60000 },
  execute: (ctx, input) => {
    if (ctx.config.overlapTokens >= ctx.config.chunkTokens)
      throw new BadRequestError("overlapTokens must be below chunkTokens");
    const docs =
      input.documents ??
      (input.text !== undefined ? [{ externalId: "text", text: input.text, metadata: {} }] : []);
    const chunks = docs.flatMap((d) =>
      chunkText(d.text, ctx.config).map((c) => ({
        externalId: d.externalId,
        ordinal: c.ordinal,
        content: c.content,
        tokens: c.tokens,
        metadata: {
          ...(d.metadata as JsonObject),
          ...("title" in d && d.title ? { title: d.title } : {}),
          ...(c.heading ? { heading: c.heading } : {}),
        },
      })),
    );
    return Promise.resolve(ok({ chunks, count: chunks.length }));
  },
});

export const embedNode = defineNode({
  id: "flowaid.retrieval.embed",
  version: "1.0.0",
  metadata: {
    name: "Embed chunks",
    description: "Adds an embedding vector to each chunk with an embedding model (batched).",
    category: "retrieval",
    icon: "binary",
    tags: ["retrieval", "rag", "embeddings"],
    summary: "{{ config.model.provider }}/{{ config.model.model }}",
  },
  configSchema: z.strictObject({
    model: modelRef,
    batchSize: z.int().min(1).max(2048).default(64),
  }),
  inputSchema: z.object({ chunks: z.array(chunkSchema) }),
  outputSchema: z.object({
    chunks: z.array(chunkSchema),
    dimensions: z.int().min(0),
    usage: usageSchema,
  }),
  credentials: [{ name: "llm", types: ["openai.api_key", "ollama.none"], required: true }],
  capabilities: ["generation", "credentials"],
  idempotency: "safe",
  generation: true,
  defaultPolicy: { timeoutMs: 300000 },
  execute: async (ctx, input) => {
    const provider = ctx.providers.embedding(ctx.config.model, { credentialSlot: "llm" });
    const usage = { inputTokens: 0, outputTokens: 0 };
    let costUsd = 0;
    const out = input.chunks.map((c) => ({ ...c }));
    for (let i = 0; i < out.length; i += ctx.config.batchSize) {
      const batch = out.slice(i, i + ctx.config.batchSize);
      const r = await provider.embed(
        batch.map((c) => c.content),
        callCtx(ctx),
      );
      batch.forEach((c, j) => {
        c.embedding = r.vectors[j] ?? [];
      });
      usage.inputTokens += r.usage.inputTokens;
      usage.outputTokens += r.usage.outputTokens;
      costUsd += r.costUsd;
    }
    return ok(
      { chunks: out, dimensions: out[0]?.embedding?.length ?? provider.dimensions, usage },
      { usage, costUsd },
    );
  },
});

export const upsertNode = defineNode({
  id: "flowaid.retrieval.upsert",
  version: "1.0.0",
  metadata: {
    name: "Index into knowledge",
    description:
      "Indexes documents (chunked and embedded by the source's pipeline) or ready-made chunks into a knowledge source. Unchanged documents are skipped by content hash, so re-running is cheap.",
    category: "retrieval",
    icon: "database-zap",
    tags: ["retrieval", "rag", "ingest", "vector store"],
  },
  configSchema: z.strictObject({
    sourceId: z
      .string()
      .min(1)
      .meta({ "x-ui": { help: "The knowledge source to index into (its id)." } }),
    /** re-index even when the content hash matches */
    force: z.boolean().default(false),
  }),
  inputSchema: z.object({
    documents: z.array(documentSchema).optional(),
    chunks: z.array(chunkSchema).optional(),
  }),
  outputSchema: z.object({
    documents: z.array(
      z.object({
        externalId: z.string(),
        documentId: z.string(),
        chunks: z.int().min(0),
        unchanged: z.boolean(),
      }),
    ),
    indexed: z.int().min(0),
    unchanged: z.int().min(0),
  }),
  capabilities: ["knowledge"],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 600000 },
  execute: async (ctx, input) => {
    const kb = ctx.knowledge;
    if (!kb) throw new BadRequestError("this runtime has no knowledge base");
    if (!input.documents && !input.chunks) throw new BadRequestError("bind documents or chunks");
    const results: {
      externalId: string;
      documentId: string;
      chunks: number;
      unchanged: boolean;
    }[] = [];
    let costUsd = 0;
    const usage = { inputTokens: 0, outputTokens: 0 };
    const record = (externalId: string, r: Awaited<ReturnType<typeof kb.upsertDocument>>) => {
      results.push({
        externalId,
        documentId: r.documentId,
        chunks: r.chunks,
        unchanged: r.unchanged,
      });
      costUsd += r.costUsd;
      if (r.usage) {
        usage.inputTokens += r.usage.inputTokens;
        usage.outputTokens += r.usage.outputTokens;
      }
    };
    for (const d of input.documents ?? []) {
      record(
        d.externalId,
        await kb.upsertDocument({
          sourceId: ctx.config.sourceId,
          externalId: d.externalId,
          text: d.text,
          mimeType: d.mimeType,
          metadata: d.metadata as JsonObject,
          ...(d.title ? { title: d.title } : {}),
          ...(d.uri ? { uri: d.uri } : {}),
        }),
      );
    }
    const byDoc = new Map<string, z.infer<typeof chunkSchema>[]>();
    for (const c of input.chunks ?? [])
      byDoc.set(c.externalId, [...(byDoc.get(c.externalId) ?? []), c]);
    for (const [externalId, list] of byDoc)
      record(
        externalId,
        await kb.upsertDocument({
          sourceId: ctx.config.sourceId,
          externalId,
          chunks: list
            .sort((a, b) => a.ordinal - b.ordinal)
            .map((c) => ({
              content: c.content,
              tokens: c.tokens,
              metadata: c.metadata as JsonObject,
              ...(c.embedding ? { embedding: c.embedding } : {}),
            })),
        }),
      );
    const unchanged = results.filter((r) => r.unchanged).length;
    return ok(
      { documents: results, indexed: results.length - unchanged, unchanged },
      { costUsd, ...(usage.inputTokens ? { usage } : {}) },
    );
  },
});
