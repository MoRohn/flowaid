/**
 * The agent's read-only document tools (RFC-0022), bound when `flowaid.ai.agent` has a `documents`
 * scope: `document_outline`, `document_read_pages` and `document_search`. They run in the node
 * over `ctx.documents` (not through `ctx.tools`), against the ready indexes the scope resolved to
 * when the node started. Every id a model passes is checked against that set first: anything else
 * (another document, another workspace, a display name) is refused without a lookup. There are
 * no tools that index, change or delete.
 */
import { z } from "zod";
import type { ExecutionContext } from "@flowaid/node-sdk";
import { evidenceForPrompt, retrieveEvidence } from "@flowaid/pageindex";
import {
  BadRequestError,
  type IndexReference,
  type JsonValue,
  type OutlineNode,
  type TokenUsage,
  type ToolDefinition,
} from "@flowaid/workflow-core";
import {
  checkSignal,
  documentsOf,
  navigatorFor,
  resolveScoped,
  type DocumentScopeConfig,
} from "../retrieval/documents.js";

export const DOCUMENT_TOOL_NAMES = [
  "document_outline",
  "document_read_pages",
  "document_search",
] as const;
export type DocumentToolName = (typeof DOCUMENT_TOOL_NAMES)[number];

/** Pages one `document_read_pages` call may read. */
export const MAX_READ_PAGES = 10;
/** The small budget of one `document_search` (the agent's own caps bound the calls). */
export const SEARCH_BUDGET = { maxSections: 4, maxPages: 8, maxDecisions: 12 } as const;
/** Documents `document_search` covers at once (retrieval's own limit). */
const MAX_SEARCH_DOCUMENTS = 5;
const SUMMARY_CHARS = 280;

export const DOCUMENTS_NOTICE =
  "You can read the documents you were given with document_outline, document_read_pages and document_search. When you use them, cite the document and page for each fact (for example: Policy.pdf, p. 3).";

const outlineArgs = z.strictObject({ documentId: z.string().min(1).max(100).optional() });
const readArgs = z.strictObject({
  indexId: z.string().min(1).max(100),
  pages: z.array(z.int().min(1)).min(1).max(MAX_READ_PAGES),
});
const searchArgs = z.strictObject({ query: z.string().min(1).max(2000) });

const builtin = (
  name: DocumentToolName,
  description: string,
  inputSchema: ToolDefinition["inputSchema"],
): ToolDefinition => ({
  name,
  description,
  inputSchema,
  idempotency: "safe",
  approvalRequired: false,
  source: { kind: "builtin", id: name },
});

const DEFINITIONS: ToolDefinition[] = [
  builtin(
    "document_outline",
    "Lists the documents you may read with their section outline: titles, node ids, page spans and summaries. Pass a documentId to see one document.",
    {
      type: "object",
      properties: { documentId: { type: "string", description: "One document's id" } },
      additionalProperties: false,
    },
  ),
  builtin(
    "document_read_pages",
    `Reads the text of pages (physical, 1-based) of one document's index; at most ${MAX_READ_PAGES} pages per call.`,
    {
      type: "object",
      properties: {
        indexId: { type: "string", description: "The indexId from document_outline" },
        pages: {
          type: "array",
          items: { type: "integer", minimum: 1 },
          minItems: 1,
          maxItems: MAX_READ_PAGES,
        },
      },
      required: ["indexId", "pages"],
      additionalProperties: false,
    },
  ),
  builtin(
    "document_search",
    "Finds the passages that answer a question by navigating the documents' sections; returns numbered excerpts with document and pages.",
    {
      type: "object",
      properties: { query: { type: "string", description: "The question" } },
      required: ["query"],
      additionalProperties: false,
    },
  ),
];

export interface DocumentToolResult {
  content: string;
  usage?: TokenUsage;
  costUsd: number;
}

export interface DocumentTools {
  definitions: readonly ToolDefinition[];
  has(name: string): boolean;
  /** Runs one call; refusals and bad arguments throw BadRequestError (reported to the model). */
  call(name: string, args: JsonValue): Promise<DocumentToolResult>;
}

const NOT_IN_SCOPE = "is not in this agent's documents";

function parse<T>(schema: z.ZodType<T>, name: string, args: JsonValue): T {
  const r = schema.safeParse(args);
  if (!r.success)
    throw new BadRequestError(
      `${name}: invalid arguments (${r.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ")})`,
    );
  return r.data;
}

const trimOutline = (nodes: readonly OutlineNode[]): JsonValue[] =>
  nodes.map((n) => ({
    nodeId: n.nodeId,
    title: n.title,
    pages: n.startPage === n.endPage ? `${n.startPage}` : `${n.startPage}-${n.endPage}`,
    ...(n.summary ? { summary: n.summary.replace(/\s+/g, " ").slice(0, SUMMARY_CHARS) } : {}),
    ...(n.children?.length ? { children: trimOutline(n.children) } : {}),
  }));

/** Resolves the scope once and binds the three tools to what it resolved to. */
export async function documentTools(
  ctx: ExecutionContext<unknown>,
  scope: DocumentScopeConfig,
): Promise<DocumentTools> {
  const docs = documentsOf(ctx);
  const { indexes } = await resolveScoped(ctx, scope);
  const byIndex = new Map(indexes.map((i) => [i.indexId, i]));
  const byDocument = new Map(indexes.map((i) => [i.documentId, i]));

  const outline = async (args: JsonValue): Promise<DocumentToolResult> => {
    const a = parse(outlineArgs, "document_outline", args);
    let chosen: IndexReference[] = indexes;
    if (a.documentId !== undefined) {
      const one = byDocument.get(a.documentId);
      if (!one) throw new BadRequestError(`document ${a.documentId} ${NOT_IN_SCOPE}`);
      chosen = [one];
    }
    const out: JsonValue[] = [];
    for (const i of chosen) {
      checkSignal(ctx.signal);
      out.push({
        documentId: i.documentId,
        indexId: i.indexId,
        name: i.displayName,
        pageCount: i.pageCount,
        outline: trimOutline(await docs.outline(i.indexId)),
      });
    }
    return {
      content: out.length ? JSON.stringify(out) : "No document in scope has a ready index.",
      costUsd: 0,
    };
  };

  const read = async (args: JsonValue): Promise<DocumentToolResult> => {
    const a = parse(readArgs, "document_read_pages", args);
    const index = byIndex.get(a.indexId);
    if (!index) throw new BadRequestError(`index ${a.indexId} ${NOT_IN_SCOPE}`);
    const pages = [...new Set(a.pages)].sort((x, y) => x - y);
    const beyond = index.pageCount === null ? [] : pages.filter((p) => p > (index.pageCount ?? 0));
    if (beyond.length)
      throw new BadRequestError(
        `${index.displayName} has ${index.pageCount} pages; page ${beyond.join(", ")} does not exist`,
      );
    checkSignal(ctx.signal);
    const text = await docs.readPages(index.indexId, pages);
    return {
      content: JSON.stringify({
        documentId: index.documentId,
        name: index.displayName,
        pages: text.sort((x, y) => x.page - y.page),
      }),
      costUsd: 0,
    };
  };

  const search = async (args: JsonValue): Promise<DocumentToolResult> => {
    const a = parse(searchArgs, "document_search", args);
    if (indexes.length === 0)
      return { content: "No document in scope has a ready index.", costUsd: 0 };
    if (indexes.length > MAX_SEARCH_DOCUMENTS)
      throw new BadRequestError(
        `document_search covers at most ${MAX_SEARCH_DOCUMENTS} documents and ${indexes.length} are in scope; use document_outline and document_read_pages`,
      );
    const r = await retrieveEvidence({
      query: a.query,
      indexes,
      outline: (id) => {
        checkSignal(ctx.signal);
        return docs.outline(id);
      },
      readPages: (id, pages) => {
        checkSignal(ctx.signal);
        return docs.readPages(id, pages);
      },
      navigate: navigatorFor(ctx, undefined),
      budget: SEARCH_BUDGET,
      now: () => ctx.clock.now().getTime(),
    });
    const body = r.evidence.length
      ? evidenceForPrompt(r.evidence)
      : "Nothing relevant was found in the documents.";
    const notes = r.warnings.length ? `\n\nNotes: ${r.warnings.join("; ")}` : "";
    return {
      content: `${body}${notes}`,
      ...(r.usage ? { usage: r.usage } : {}),
      costUsd: r.costUsd,
    };
  };

  const run: Record<DocumentToolName, (args: JsonValue) => Promise<DocumentToolResult>> = {
    document_outline: outline,
    document_read_pages: read,
    document_search: search,
  };
  const isTool = (name: string): name is DocumentToolName =>
    (DOCUMENT_TOOL_NAMES as readonly string[]).includes(name);
  return {
    definitions: DEFINITIONS,
    has: isTool,
    call: (name, args) => {
      if (!isTool(name)) return Promise.reject(new BadRequestError(`no document tool ${name}`));
      return run[name](args);
    },
  };
}
