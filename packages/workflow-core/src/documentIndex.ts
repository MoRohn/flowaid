/**
 * §15 Document indexes (RFC-0022): hierarchical, page-addressed indexes of workspace documents
 * (PageIndex first), and the evidence retrieved by navigating them. The runtime binds a
 * workspace-scoped `DocumentIndexAccess` into `ExecutionContext.documents` for nodes that declare
 * the `documents` capability (the access interface is §16 `DocumentIndexAccess`). Every reference
 * is scoped to one workspace; the access refuses ids outside it.
 */
import type { TokenUsage } from "./decision.js";

/** Lifecycle of one index version. Only `ready` indexes are readable. */
export type DocumentIndexState =
  | "queued"
  | "running"
  | "ready"
  | "failed"
  | "cancel_requested"
  | "canceled"
  | "superseded"
  | "deleted";

/** What a backend and mode can actually do; drives validation and what the UI offers. */
export interface DocumentIndexCapabilities {
  /** media types it indexes */
  formats: string[];
  /** locators are physical, 1-based page positions in the file */
  pageLocators: "physical";
  /** printed page labels ("iv", "12") are known */
  pageLabels: boolean;
  /** block ids and bounding boxes within a page */
  blocks: boolean;
  /** scanned (image-only) pages are read */
  ocr: boolean;
}

/** One immutable version of an uploaded document. */
export interface DocumentReference {
  documentId: string;
  sourceId: string;
  versionId: string;
  version: number;
  contentSha256: string;
  displayName: string;
  mediaType: string;
  bytes: number;
  pageCount: number | null;
}

/** One index of one document version. */
export interface IndexReference {
  indexId: string;
  documentId: string;
  sourceId: string;
  versionId: string;
  documentVersion: number;
  /** increments per document each time a new index is built */
  indexVersion: number;
  displayName: string;
  state: DocumentIndexState;
  /** the index the document currently resolves to */
  active: boolean;
  backend: "pageindex";
  mode: "local";
  /** the backend library release that built it, e.g. "pageindex 0.2.20" */
  backendVersion: string | null;
  /** hash of the indexing configuration (model, mode, backend version) */
  configHash: string;
  /** the model that wrote summaries, as provider/model */
  indexModel: string | null;
  pageCount: number | null;
  /** what the backend is doing now (e.g. "indexing"); not a percentage */
  stage: string | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  readyAt: string | null;
  capabilities: DocumentIndexCapabilities;
}

/** A section of the document's hierarchy, with the physical pages it spans. */
export interface OutlineNode {
  nodeId: string;
  title: string;
  startPage: number;
  endPage: number;
  summary?: string;
  children?: OutlineNode[];
}

/** Which documents a retrieval may read. At least one list must be non-empty. */
export interface DocumentScope {
  sourceIds?: string[];
  documentIds?: string[];
  /** pins exact index versions (a running workflow keeps what it resolved) */
  indexIds?: string[];
}

/** Where evidence sits in the original file. `pageLabel` stays null unless the backend knows it. */
export interface SourceLocator {
  kind: "pdf_page";
  /** physical, 1-based page position */
  page: number;
  /** last physical page when the evidence spans several */
  endPage: number;
  pageLabel: string | null;
}

/** Source text retrieved for a query, with where it came from and how it was chosen. */
export interface Evidence {
  /** "E1", "E2", … unique within one retrieval */
  id: string;
  indexId: string;
  documentId: string;
  versionId: string;
  documentVersion: number;
  indexVersion: number;
  displayName: string;
  nodeId: string | null;
  sectionPath: string[];
  excerpt: string;
  /** the excerpt was cut to the evidence budget */
  truncated: boolean;
  locator: SourceLocator;
  provenance: {
    method: "tree_navigation";
    /** the navigator's confidence in choosing this section, when it reports one */
    confidence: number | null;
    provider: string | null;
  };
}

export interface RetrievalActivity {
  documents: number;
  sectionsInspected: number;
  pagesRead: number;
  decisions: number;
  elapsedMs: number;
}

export interface RetrievalResult {
  evidence: Evidence[];
  /** `partial`: a budget or a failing document cut retrieval short; `empty`: nothing relevant */
  status: "complete" | "partial" | "empty";
  warnings: string[];
  activity: RetrievalActivity;
  /** the decisions' usage when the provider reports it */
  usage: TokenUsage | null;
  costUsd: number;
}

/** A citation in an answer, checked against the evidence it names. */
export interface Citation {
  marker: string;
  evidenceId: string;
  documentId: string;
  versionId: string;
  page: number;
  /** null: not checked (no decision provider and no lexical fallback asked for) */
  supported: boolean | null;
  support: { method: "decision" | "lexical"; score: number } | null;
}

export interface GroundedAnswer {
  answer: string;
  citations: Citation[];
  status: "sufficient" | "partial" | "insufficient";
  limitations: string[];
  runId: string;
}

export interface IndexRequestResult {
  index: IndexReference;
  /** false when an equivalent index already existed or was already being built */
  created: boolean;
}
