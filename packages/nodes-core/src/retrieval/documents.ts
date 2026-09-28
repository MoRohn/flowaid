/**
 * Shared pieces of the PageIndex nodes and the agent's document tools (RFC-0022): the scope a node
 * is configured with (its allowlist), the schemas of `ctx.documents`' types on ports, scope
 * resolution that never reaches outside the allowlist, and the navigator that turns the
 * workspace's decision chain into `retrieveEvidence`'s section choices.
 */
import { z } from "zod";
import type { ExecutionContext, DocumentIndexAccess } from "@flowaid/node-sdk";
import { HumanFallbackSignal } from "@flowaid/providers";
import type { Navigator, NavigatorChoice, NavigatorAnswer } from "@flowaid/pageindex";
import {
  BadRequestError,
  CancelledError,
  NodeExecutionError,
  ProviderHopSchema,
  type IndexReference,
  type ProviderHop,
} from "@flowaid/workflow-core";
import { callCtx } from "../common.js";

/** At most this many ids in one scope (sources and documents together). */
export const MAX_SCOPE_IDS = 20;

const idList = (help: string) =>
  z.array(z.uuid()).max(MAX_SCOPE_IDS).default([]).meta({ "x-ui": { help } });

/** Which documents a node may read: the allowlist. At least one id; the workspace is enforced by the host. */
export const documentScopeSchema = z
  .strictObject({
    sourceIds: idList(
      "Knowledge sources whose documents may be read (every ready document in them).",
    ),
    documentIds: idList("Individual documents that may be read."),
  })
  .meta({
    "x-ui": {
      help: `The documents this node may read. At least one source or document; at most ${MAX_SCOPE_IDS} ids.`,
    },
  });
export type DocumentScopeConfig = z.output<typeof documentScopeSchema>;

/** The decision chain that navigates (and judges); unset: the workspace's chain. */
export const decisionChainSchema = z
  .array(ProviderHopSchema)
  .min(1)
  .max(5)
  .optional()
  .meta({
    "x-ui": {
      help: "Decision providers to ask, in failover order. Empty: the workspace's decision chain.",
    },
  });

const stateSchema = z.enum([
  "queued",
  "running",
  "ready",
  "failed",
  "cancel_requested",
  "canceled",
  "superseded",
  "deleted",
]);

export const indexReferenceSchema = z.object({
  indexId: z.string(),
  documentId: z.string(),
  sourceId: z.string(),
  versionId: z.string(),
  documentVersion: z.int(),
  indexVersion: z.int(),
  displayName: z.string(),
  state: stateSchema,
  active: z.boolean(),
  backend: z.literal("pageindex"),
  mode: z.literal("local"),
  backendVersion: z.string().nullable(),
  configHash: z.string(),
  indexModel: z.string().nullable(),
  pageCount: z.int().nullable(),
  stage: z.string().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: z.string(),
  readyAt: z.string().nullable(),
  capabilities: z.object({
    formats: z.array(z.string()),
    pageLocators: z.literal("physical"),
    pageLabels: z.boolean(),
    blocks: z.boolean(),
    ocr: z.boolean(),
  }),
});

export const evidenceSchema = z.object({
  id: z.string().regex(/^E\d{1,3}$/),
  indexId: z.string(),
  documentId: z.string(),
  versionId: z.string(),
  documentVersion: z.int(),
  indexVersion: z.int(),
  displayName: z.string(),
  nodeId: z.string().nullable(),
  sectionPath: z.array(z.string()),
  excerpt: z.string(),
  truncated: z.boolean(),
  locator: z.object({
    kind: z.literal("pdf_page"),
    page: z.int().min(1),
    endPage: z.int().min(1),
    pageLabel: z.string().nullable(),
  }),
  provenance: z.object({
    method: z.literal("tree_navigation"),
    confidence: z.number().nullable(),
    provider: z.string().nullable(),
  }),
});

export const activitySchema = z.object({
  documents: z.int().min(0),
  sectionsInspected: z.int().min(0),
  pagesRead: z.int().min(0),
  decisions: z.int().min(0),
  elapsedMs: z.int().min(0),
});

export const citationSchema = z.object({
  marker: z.string(),
  evidenceId: z.string(),
  documentId: z.string(),
  versionId: z.string(),
  page: z.int(),
  supported: z.boolean().nullable(),
  support: z.object({ method: z.enum(["decision", "lexical"]), score: z.number() }).nullable(),
});

/** `ctx.documents`, or a clear error where the host binds none (an exported package without `services.documents`). */
export function documentsOf(ctx: ExecutionContext<unknown>): DocumentIndexAccess {
  const docs = ctx.documents;
  if (!docs)
    throw new BadRequestError(
      "this runtime has no document indexes (a FlowAId server provides them; an exported package needs services.documents)",
    );
  return docs;
}

/** Throws CancelledError once the node's signal fired. */
export function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) throw new CancelledError("the node was cancelled");
}

/** Rejects an empty or oversized scope. */
export function checkScope(scope: DocumentScopeConfig): void {
  const n = scope.sourceIds.length + scope.documentIds.length;
  if (n === 0)
    throw new BadRequestError("the document scope is empty: add at least one source or document");
  if (n > MAX_SCOPE_IDS)
    throw new BadRequestError(
      `the document scope has ${n} ids; at most ${MAX_SCOPE_IDS} (sources and documents together)`,
    );
}

/** Whether an index belongs to a document the scope allows. */
export const inScope = (ref: IndexReference, scope: DocumentScopeConfig): boolean =>
  scope.sourceIds.includes(ref.sourceId) || scope.documentIds.includes(ref.documentId);

/**
 * The ready indexes of the scope, with `pinned` index ids taking the place of their document's
 * active index. Every pinned id must belong to the scope (checked before anything is resolved);
 * whatever the host returns is filtered through the scope again.
 */
export async function resolveScoped(
  ctx: ExecutionContext<unknown>,
  scope: DocumentScopeConfig,
  pinned: readonly string[] = [],
): Promise<{ indexes: IndexReference[]; warnings: string[] }> {
  checkScope(scope);
  const docs = documentsOf(ctx);
  const warnings: string[] = [];
  const pins = [...new Set(pinned)];
  for (const indexId of pins) {
    checkSignal(ctx.signal);
    let ref: IndexReference;
    try {
      ref = await docs.getIndex(indexId);
    } catch {
      throw new BadRequestError(`index ${indexId} is not in this node's document scope`);
    }
    if (!inScope(ref, scope))
      throw new BadRequestError(`index ${indexId} is not in this node's document scope`);
  }
  checkSignal(ctx.signal);
  const resolved = await docs.resolve({
    sourceIds: scope.sourceIds,
    documentIds: scope.documentIds,
    ...(pins.length ? { indexIds: pins } : {}),
  });
  const pinnedDocs = new Set(
    resolved.filter((r) => pins.includes(r.indexId)).map((r) => r.documentId),
  );
  for (const indexId of pins)
    if (!resolved.some((r) => r.indexId === indexId))
      warnings.push(`pinned index ${indexId} is not readable (not ready); it was skipped`);
  const seen = new Set<string>();
  const indexes = resolved.filter((r) => {
    if (!inScope(r, scope) || seen.has(r.indexId)) return false;
    // a pinned version replaces its document's active index
    if (pinnedDocs.has(r.documentId) && !pins.includes(r.indexId)) return false;
    seen.add(r.indexId);
    return true;
  });
  return { indexes, warnings };
}

/**
 * A navigator over the decision chain: each section choice is one TypeSafe choice decision with a
 * probability per section. A chain that ends in a person cannot be waited on mid-navigation.
 */
export function navigatorFor(
  ctx: ExecutionContext<unknown>,
  chain: readonly ProviderHop[] | undefined,
): Navigator {
  const provider = ctx.providers.decision(chain ?? []);
  return async (choice: NavigatorChoice): Promise<NavigatorAnswer> => {
    checkSignal(ctx.signal);
    try {
      const d = await provider.decideChoice(
        choice.state,
        { kind: "choice", instructions: choice.instructions, options: choice.options },
        callCtx(ctx),
      );
      return {
        value: String(d.value),
        probabilities: d.probabilities,
        confidence: d.confidence,
        provider: d.provider,
        usage: d.usage,
        costUsd: d.costUsd,
      };
    } catch (error) {
      if (error instanceof HumanFallbackSignal)
        throw new NodeExecutionError(
          "every decision provider failed while navigating the documents (a person cannot answer section choices)",
          false,
        );
      throw error;
    }
  };
}
