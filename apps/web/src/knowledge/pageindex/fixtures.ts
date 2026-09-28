/** Test data in the RFC-0022 shapes (shared by the PageIndex web tests). */
import type {
  DocumentIndexState,
  DocumentSummary,
  Evidence,
  IndexReference,
  QueryResponse,
} from "./model";

export function index(p: Partial<IndexReference> = {}): IndexReference {
  return {
    indexId: "ix-1",
    documentId: "doc-1",
    sourceId: "src-1",
    versionId: "ver-1",
    documentVersion: 1,
    indexVersion: 1,
    displayName: "Handbook.pdf",
    state: "ready",
    active: true,
    backend: "pageindex",
    mode: "local",
    backendVersion: "pageindex 0.2.20",
    configHash: "abc",
    indexModel: "ollama/qwen2.5:3b",
    pageCount: 12,
    stage: null,
    error: null,
    createdAt: "2026-09-27T10:00:00.000Z",
    readyAt: "2026-09-27T10:02:00.000Z",
    capabilities: {
      formats: ["application/pdf"],
      pageLocators: "physical",
      pageLabels: false,
      blocks: false,
      ocr: false,
    },
    ...p,
  };
}

export function doc(
  p: Partial<IndexReference> & { state: DocumentIndexState },
  title = "Handbook.pdf",
  documentId = "doc-1",
): DocumentSummary {
  const ix = index({ ...p, documentId, displayName: title });
  return {
    documentId,
    title,
    status: "active",
    versions: 1,
    latestVersion: {
      documentId,
      sourceId: "src-1",
      versionId: ix.versionId,
      version: ix.documentVersion,
      contentSha256: "f00",
      displayName: title,
      mediaType: "application/pdf",
      bytes: 2048,
      pageCount: 12,
    },
    activeIndex: ix.state === "ready" ? ix : null,
    latestIndex: ix,
  };
}

export function evidence(p: Partial<Evidence> = {}): Evidence {
  return {
    id: "E1",
    indexId: "ix-1",
    documentId: "doc-1",
    versionId: "ver-1",
    documentVersion: 1,
    indexVersion: 1,
    displayName: "Handbook.pdf",
    nodeId: "n-3",
    sectionPath: ["Employment", "Termination"],
    excerpt: "Either party may terminate with 30 days' notice.",
    truncated: true,
    locator: { kind: "pdf_page", page: 7, endPage: 8, pageLabel: null },
    provenance: { method: "tree_navigation", confidence: 0.82, provider: "typesafe" },
    ...p,
  };
}

export function queryResponse(withAnswer: boolean): QueryResponse {
  return {
    retrieval: {
      evidence: [evidence()],
      status: "complete",
      warnings: ["One document was still indexing and was skipped."],
      activity: { documents: 1, sectionsInspected: 9, pagesRead: 2, decisions: 3, elapsedMs: 2400 },
      usage: null,
      costUsd: 0.0012,
    },
    answer: withAnswer
      ? {
          answer: "The notice period is 30 days [E1].",
          citations: [
            {
              marker: "[E1]",
              evidenceId: "E1",
              documentId: "doc-1",
              versionId: "ver-1",
              page: 8,
              supported: false,
              support: { method: "lexical", score: 0.12 },
            },
          ],
          status: "partial",
          limitations: ["The handbook does not cover contractors."],
          runId: "run-1",
        }
      : null,
    model: withAnswer ? { provider: "openai", model: "gpt-4.1-mini" } : null,
  };
}
