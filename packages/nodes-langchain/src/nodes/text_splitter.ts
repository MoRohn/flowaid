/**
 * `langchain.text_splitter`: `@langchain/textsplitters` over documents or text — recursive
 * character (the default), character, Markdown-aware and code-aware (per language) splitting.
 * Chunks keep the source metadata plus `chunk` (index within the source document) and
 * `chunkOf` (the source document's index), so retrieved chunks can be cited.
 */
import { z } from "zod";
import {
  CharacterTextSplitter,
  MarkdownTextSplitter,
  RecursiveCharacterTextSplitter,
  SupportedTextSplitterLanguages,
  type TextSplitter,
} from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import { defineNode, ok } from "@flowaid/node-sdk";
import { BadRequestError } from "@flowaid/workflow-core";
import { documentSchema, fromDocument, nodeId, toDocument } from "../common.js";

const LANGUAGES = SupportedTextSplitterLanguages as readonly string[] as [string, ...string[]];

export const textSplitterNode = defineNode({
  id: nodeId("text_splitter"),
  version: "1.0.0",
  metadata: {
    name: "Text splitter",
    description:
      "Splits documents or text into overlapping chunks (recursive character, character, Markdown or code-aware) for embedding and retrieval.",
    category: "retrieval",
    icon: "scissors",
    tags: ["langchain", "rag", "chunking"],
    summary: "{{ config.splitter }} · {{ config.chunkSize }}/{{ config.chunkOverlap }}",
  },
  configSchema: z.strictObject({
    splitter: z
      .enum(["recursive", "character", "markdown", "code"])
      .default("recursive")
      .meta({ "x-ui": { widget: "select" } }),
    chunkSize: z.int().min(50).max(32_000).default(1000),
    chunkOverlap: z.int().min(0).max(8000).default(150),
    separator: z
      .string()
      .max(20)
      .default("\n\n")
      .meta({ "x-ui": { showWhen: { path: "/splitter", equals: "character" } } }),
    language: z
      .enum(LANGUAGES)
      .default("js")
      .meta({ "x-ui": { widget: "select", showWhen: { path: "/splitter", equals: "code" } } }),
  }),
  inputSchema: z.object({
    documents: z.array(documentSchema).optional(),
    text: z.string().optional(),
  }),
  outputSchema: z.object({ chunks: z.array(documentSchema), count: z.int().min(0) }),
  capabilities: [],
  idempotency: "safe",
  execute: async (ctx, input) => {
    const c = ctx.config;
    if (c.chunkOverlap >= c.chunkSize)
      throw new BadRequestError("chunkOverlap must be smaller than chunkSize");
    const base = { chunkSize: c.chunkSize, chunkOverlap: c.chunkOverlap };
    const splitter: TextSplitter =
      c.splitter === "character"
        ? new CharacterTextSplitter({ ...base, separator: c.separator })
        : c.splitter === "markdown"
          ? new MarkdownTextSplitter(base)
          : c.splitter === "code"
            ? RecursiveCharacterTextSplitter.fromLanguage(
                c.language as (typeof SupportedTextSplitterLanguages)[number],
                base,
              )
            : new RecursiveCharacterTextSplitter(base);
    const sources = [
      ...(input.documents ?? []).map(toDocument),
      ...(input.text !== undefined
        ? [new Document({ pageContent: input.text, metadata: { source: "input" } })]
        : []),
    ];
    const chunks: Document[] = [];
    for (const [i, doc] of sources.entries()) {
      const parts = await splitter.splitDocuments([doc]);
      parts.forEach((part, j) => {
        part.metadata = { ...part.metadata, chunk: j, chunkOf: i };
        chunks.push(part);
      });
    }
    return ok({ chunks: chunks.map(fromDocument), count: chunks.length });
  },
});
