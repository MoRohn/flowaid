/**
 * Response shapes of the PageIndex routes (docs/pageindex/API.md): RFC-0022's types
 * (`packages/workflow-core/src/documentIndex.ts`) as Zod schemas, so responses are checked
 * against them and the OpenAPI document describes them.
 */
import { z } from "zod";
import type { OutlineNode } from "@flowaid/workflow-core";

export const DocumentIndexStateSchema = z.enum([
  "queued",
  "running",
  "ready",
  "failed",
  "cancel_requested",
  "canceled",
  "superseded",
  "deleted",
]);

export const CapabilitiesSchema = z.object({
  formats: z.array(z.string()),
  pageLocators: z.literal("physical"),
  pageLabels: z.boolean(),
  blocks: z.boolean(),
  ocr: z.boolean(),
});

export const DocumentReferenceSchema = z.object({
  documentId: z.uuid(),
  sourceId: z.uuid(),
  versionId: z.uuid(),
  version: z.int(),
  contentSha256: z.string(),
  displayName: z.string(),
  mediaType: z.string(),
  bytes: z.int(),
  pageCount: z.int().nullable(),
});

export const IndexReferenceSchema = z.object({
  indexId: z.uuid(),
  documentId: z.uuid(),
  sourceId: z.uuid(),
  versionId: z.uuid(),
  documentVersion: z.int(),
  indexVersion: z.int(),
  displayName: z.string(),
  state: DocumentIndexStateSchema,
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
  capabilities: CapabilitiesSchema,
});

export const OutlineNodeSchema: z.ZodType<OutlineNode> = z.lazy(() =>
  z.object({
    nodeId: z.string(),
    title: z.string(),
    startPage: z.int().min(1),
    endPage: z.int().min(1),
    summary: z.string().optional(),
    children: z.array(OutlineNodeSchema).optional(),
  }),
);

export const DocumentSummarySchema = z.object({
  documentId: z.uuid(),
  title: z.string(),
  status: z.enum(["pending", "indexed", "error", "deleted"]),
  versions: z.int(),
  latestVersion: DocumentReferenceSchema,
  activeIndex: IndexReferenceSchema.nullable(),
  latestIndex: IndexReferenceSchema.nullable(),
});

const UsageSchema = z.object({ inputTokens: z.number(), outputTokens: z.number() }).loose();

export const EvidenceSchema = z.object({
  id: z.string(),
  indexId: z.uuid(),
  documentId: z.uuid(),
  versionId: z.uuid(),
  documentVersion: z.int(),
  indexVersion: z.int(),
  displayName: z.string(),
  nodeId: z.string().nullable(),
  sectionPath: z.array(z.string()),
  excerpt: z.string(),
  truncated: z.boolean(),
  locator: z.object({
    kind: z.literal("pdf_page"),
    page: z.int(),
    endPage: z.int(),
    pageLabel: z.string().nullable(),
  }),
  provenance: z.object({
    method: z.literal("tree_navigation"),
    confidence: z.number().nullable(),
    provider: z.string().nullable(),
  }),
});

export const RetrievalResultSchema = z.object({
  evidence: z.array(EvidenceSchema),
  status: z.enum(["complete", "partial", "empty"]),
  warnings: z.array(z.string()),
  activity: z.object({
    documents: z.int(),
    sectionsInspected: z.int(),
    pagesRead: z.int(),
    decisions: z.int(),
    elapsedMs: z.int(),
  }),
  usage: UsageSchema.nullable(),
  costUsd: z.number(),
});

export const GroundedAnswerSchema = z.object({
  answer: z.string(),
  citations: z.array(
    z.object({
      marker: z.string(),
      evidenceId: z.string(),
      documentId: z.uuid(),
      versionId: z.uuid(),
      page: z.int(),
      supported: z.boolean().nullable(),
      support: z.object({ method: z.enum(["decision", "lexical"]), score: z.number() }).nullable(),
    }),
  ),
  status: z.enum(["sufficient", "partial", "insufficient"]),
  limitations: z.array(z.string()),
  runId: z.string(),
});

const ModeSchema = z.object({
  available: z.boolean(),
  capabilities: CapabilitiesSchema.nullable(),
  processing: z.string(),
});

export const PageIndexStatusSchema = z.object({
  enabled: z.boolean(),
  reachable: z.boolean(),
  sdkVersion: z.string().nullable(),
  protocol: z.string(),
  modes: z.object({ local: ModeSchema, cloud: ModeSchema }),
});

export const DocumentScopeSchema = z
  .object({
    sourceIds: z.array(z.uuid()).max(20).optional(),
    documentIds: z.array(z.uuid()).max(50).optional(),
    indexIds: z.array(z.uuid()).max(50).optional(),
  })
  .refine(
    (s) =>
      (s.sourceIds?.length ?? 0) + (s.documentIds?.length ?? 0) + (s.indexIds?.length ?? 0) > 0,
    { message: "the scope names no sources, documents or indexes" },
  );

export const RetrievalBudgetSchema = z.object({
  maxSections: z.int().min(1).max(20).optional(),
  maxPages: z.int().min(1).max(60).optional(),
  maxDecisions: z.int().min(1).max(60).optional(),
  maxPagesPerSection: z.int().min(1).max(20).optional(),
  branching: z.int().min(1).max(5).optional(),
  minProbability: z.number().min(0).max(1).optional(),
  excerptChars: z.int().min(200).max(20_000).optional(),
});
