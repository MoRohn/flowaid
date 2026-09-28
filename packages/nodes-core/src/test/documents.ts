/** An in-memory `DocumentIndexAccess` for the PageIndex node tests: one workspace, recorded calls. */
import type { DocumentIndexAccess } from "@flowaid/node-sdk";
import {
  BadRequestError,
  NotFoundError,
  type IndexReference,
  type OutlineNode,
} from "@flowaid/workflow-core";

export const SOURCE_A = "0a000000-0000-4000-8000-00000000000a";
export const SOURCE_B = "0b000000-0000-4000-8000-00000000000b";
export const DOC_A = "da000000-0000-4000-8000-00000000000a";
export const DOC_B = "db000000-0000-4000-8000-00000000000b";
export const INDEX_A = "1a000000-0000-4000-8000-00000000000a";
export const INDEX_A_OLD = "1a000000-0000-4000-8000-0000000000a0";
export const INDEX_B = "1b000000-0000-4000-8000-00000000000b";
/** exists in another workspace: this access answers NOT_FOUND */
export const FOREIGN_INDEX = "1f000000-0000-4000-8000-00000000000f";

export function indexRef(over: Partial<IndexReference> & { indexId: string }): IndexReference {
  return {
    documentId: DOC_A,
    sourceId: SOURCE_A,
    versionId: `v-${over.indexId.slice(0, 4)}`,
    documentVersion: 1,
    indexVersion: 1,
    displayName: "Policy.pdf",
    state: "ready",
    active: true,
    backend: "pageindex",
    mode: "local",
    backendVersion: "pageindex 0.2.20",
    configHash: "cfg",
    indexModel: "openai/gpt-test",
    pageCount: 3,
    stage: null,
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    readyAt: "2026-01-01T00:01:00.000Z",
    capabilities: {
      formats: ["application/pdf"],
      pageLocators: "physical",
      pageLabels: false,
      blocks: false,
      ocr: false,
    },
    ...over,
  };
}

export const POLICY_OUTLINE: OutlineNode[] = [
  { nodeId: "0000", title: "Refunds", startPage: 1, endPage: 1, summary: "who approves refunds" },
  { nodeId: "0001", title: "Data requests", startPage: 2, endPage: 3, summary: "export, deletion" },
];
export const POLICY_PAGES = [
  "Refunds above $200 and up to $1,000 need approval from a team lead.",
  "Deletion requests are completed within 30 days.",
  "Export requests are answered within 1 business day.",
];

export interface FakeDocuments extends DocumentIndexAccess {
  indexes: Map<string, IndexReference>;
  calls: { method: string; arg: unknown }[];
  /** what requestIndex answers next */
  nextRequest: { index: IndexReference; created: boolean } | null;
}

/** Two documents (A in source A with an older superseded index, B in source B), both ready. */
export function fakeDocuments(extra: IndexReference[] = []): FakeDocuments {
  const indexes = new Map<string, IndexReference>();
  for (const r of [
    indexRef({ indexId: INDEX_A }),
    indexRef({ indexId: INDEX_A_OLD, state: "superseded", active: false, indexVersion: 0 }),
    indexRef({
      indexId: INDEX_B,
      documentId: DOC_B,
      sourceId: SOURCE_B,
      displayName: "Contract.pdf",
    }),
    ...extra,
  ])
    indexes.set(r.indexId, r);
  const calls: FakeDocuments["calls"] = [];
  const get = (id: string) => {
    const r = indexes.get(id);
    if (!r) throw new NotFoundError(`index ${id} not found`);
    return r;
  };
  const readable = (id: string) => {
    const r = get(id);
    if (r.state !== "ready" && r.state !== "superseded")
      throw new BadRequestError(`index ${id} is not ready`);
    return r;
  };
  const docs: FakeDocuments = {
    indexes,
    calls,
    nextRequest: null,
    resolve: (scope) => {
      calls.push({ method: "resolve", arg: scope });
      const out = [...indexes.values()].filter(
        (r) =>
          (r.state === "ready" &&
            r.active &&
            (scope.sourceIds?.includes(r.sourceId) || scope.documentIds?.includes(r.documentId))) ||
          (scope.indexIds?.includes(r.indexId) &&
            (r.state === "ready" || r.state === "superseded")),
      );
      return Promise.resolve(out);
    },
    getIndex: (id) => {
      calls.push({ method: "getIndex", arg: id });
      return Promise.resolve().then(() => get(id));
    },
    outline: (id) => {
      calls.push({ method: "outline", arg: id });
      return Promise.resolve().then(() => {
        readable(id);
        return POLICY_OUTLINE;
      });
    },
    readPages: (id, pages) => {
      calls.push({ method: "readPages", arg: { id, pages } });
      return Promise.resolve().then(() => {
        readable(id);
        return pages
          .filter((p) => p >= 1 && p <= POLICY_PAGES.length)
          .map((p) => ({ page: p, text: POLICY_PAGES[p - 1] ?? "" }));
      });
    },
    requestIndex: (documentId) => {
      calls.push({ method: "requestIndex", arg: documentId });
      const next = docs.nextRequest;
      if (!next) return Promise.reject(new NotFoundError(`document ${documentId} not found`));
      indexes.set(next.index.indexId, next.index);
      return Promise.resolve(next);
    },
  };
  return docs;
}
