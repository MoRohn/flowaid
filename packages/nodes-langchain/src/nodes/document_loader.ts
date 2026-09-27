/**
 * `langchain.document_loader`: loads LangChain documents (`{ pageContent, metadata }`) from inline
 * text, Markdown, JSON, JSON Lines, CSV or HTML, or fetches web pages, sitemaps and GitHub
 * repositories through the node's SSRF-guarded fetch.
 */
import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { BadRequestError, type JsonValue } from "@flowaid/workflow-core";
import { documentSchema, fromDocument, nodeId } from "../common.js";
import { loadGitHub, loadInline, loadSitemap, loadUrls } from "../loaders.js";

const INLINE = ["text", "markdown", "json", "jsonl", "csv", "html"] as const;

export const documentLoaderNode = defineNode({
  id: nodeId("document_loader"),
  version: "1.0.0",
  metadata: {
    name: "Document loader",
    description:
      "Loads documents from text, Markdown, JSON, JSON Lines, CSV or HTML content, or from web pages, a sitemap or a GitHub repository.",
    category: "retrieval",
    icon: "file-text",
    tags: ["langchain", "rag", "loader", "documents"],
    summary: "{{ config.source }}",
  },
  configSchema: z.strictObject({
    source: z
      .enum([...INLINE, "url", "sitemap", "github"])
      .default("text")
      .meta({ "x-ui": { widget: "select" } }),
    sourceName: z
      .string()
      .max(500)
      .default("input")
      .meta({ "x-ui": { help: "`metadata.source` for inline content." } }),
    jsonPointer: z
      .string()
      .regex(/^(\/.*)?$/)
      .default("")
      .meta({
        "x-ui": {
          showWhen: { path: "/source", equals: "json" },
          help: "Pointer to the array (or value) to load.",
        },
      }),
    textField: z
      .string()
      .max(200)
      .optional()
      .meta({
        "x-ui": {
          help: "JSON pointer (json/jsonl) or column (csv) holding the text; default the whole item.",
        },
      }),
    csvDelimiter: z.string().length(1).default(","),
    include: z
      .string()
      .max(2000)
      .optional()
      .meta({
        "x-ui": {
          showWhen: { path: "/source", equals: "sitemap" },
          help: "Only pages whose URL starts with this.",
        },
      }),
    repo: z
      .string()
      .regex(/^[\w.-]+\/[\w.-]+$/)
      .optional()
      .meta({
        "x-ui": { showWhen: { path: "/source", equals: "github" }, placeholder: "owner/name" },
      }),
    ref: z.string().max(200).default("main"),
    path: z.string().max(1000).default(""),
    extensions: z.array(z.string().max(20)).max(50).default([".md", ".mdx", ".txt"]),
    maxPages: z.int().min(1).max(500).default(50),
    maxBytes: z
      .int()
      .min(1024)
      .max(20 * 1024 * 1024)
      .default(2 * 1024 * 1024),
  }),
  inputSchema: z.object({
    content: z.string().optional(),
    urls: z.union([z.string(), z.array(z.string())]).optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  }),
  outputSchema: z.object({ documents: z.array(documentSchema), count: z.int().min(0) }),
  credentials: [
    {
      name: "github",
      types: ["github.token"],
      required: false,
      description: "Token for private repositories and higher GitHub rate limits.",
    },
  ],
  capabilities: ["network", "credentials"],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 120_000 },
  execute: async (ctx, input) => {
    const c = ctx.config;
    const metadata = input.metadata as Record<string, JsonValue>;
    const urls =
      input.urls === undefined ? [] : typeof input.urls === "string" ? [input.urls] : input.urls;
    let docs;
    switch (c.source) {
      case "url":
        if (!urls.length) throw new BadRequestError("the url loader needs `urls`");
        docs = await loadUrls(ctx.http, urls.slice(0, c.maxPages), {
          maxBytes: c.maxBytes,
          metadata,
        });
        break;
      case "sitemap": {
        const sitemap = urls[0];
        if (!sitemap)
          throw new BadRequestError("the sitemap loader needs the sitemap URL in `urls`");
        docs = await loadSitemap(ctx.http, sitemap, {
          maxPages: c.maxPages,
          maxBytes: c.maxBytes,
          ...(c.include ? { include: c.include } : {}),
          metadata,
        });
        break;
      }
      case "github": {
        if (!c.repo) throw new BadRequestError("the github loader needs `repo` (owner/name)");
        const token = ctx.credentials.has("github")
          ? (await ctx.credentials.get("github")).token
          : undefined;
        docs = await loadGitHub(ctx.http, {
          repo: c.repo,
          ref: c.ref,
          path: c.path,
          extensions: c.extensions,
          maxFiles: c.maxPages,
          maxBytes: c.maxBytes,
          ...(token ? { token } : {}),
          metadata,
        });
        break;
      }
      case "text":
      case "markdown":
      case "json":
      case "jsonl":
      case "csv":
      case "html":
        // Absent or empty content loads nothing, so ingestion steps are a no-op without new knowledge.
        docs = loadInline(c.source, input.content ?? "", {
          source: c.sourceName,
          ...(c.jsonPointer ? { jsonPointer: c.jsonPointer } : {}),
          ...(c.textField ? { textField: c.textField } : {}),
          csvDelimiter: c.csvDelimiter,
          metadata,
        });
    }
    const documents = docs.filter((d) => d.pageContent.trim() !== "").map(fromDocument);
    return ok({ documents, count: documents.length });
  },
});
