import { describe, expect, it } from "vitest";
import type { Evidence, GroundedAnswer, RetrievalResult } from "@flowaid/workflow-core";
import {
  PAGEINDEX_EVAL_CASES,
  THRESHOLDS,
  scorePageIndexCase,
  summarizePageIndexEval,
  type SampleDocument,
} from "./evals.js";

const ev = (id: string, doc: SampleDocument, page: number, endPage = page): Evidence => ({
  id,
  indexId: `idx-${doc}`,
  documentId: doc,
  versionId: "v",
  documentVersion: 1,
  indexVersion: 1,
  displayName: doc,
  nodeId: null,
  sectionPath: [],
  excerpt: "…",
  truncated: false,
  locator: { kind: "pdf_page", page, endPage, pageLabel: null },
  provenance: { method: "tree_navigation", confidence: 0.9, provider: "typesafe" },
});
const retrieval = (evidence: Evidence[]): RetrievalResult => ({
  evidence,
  status: "complete",
  warnings: [],
  activity: {
    documents: 1,
    sectionsInspected: 4,
    pagesRead: evidence.length,
    decisions: 2,
    elapsedMs: 5,
  },
  usage: null,
  costUsd: 0.0002,
});
const answer = (
  text: string,
  status: GroundedAnswer["status"],
  cited: [string, boolean][],
): GroundedAnswer => ({
  answer: text,
  status,
  limitations: [],
  runId: "r",
  citations: cited.map(([evidenceId, supported]) => ({
    marker: evidenceId,
    evidenceId,
    documentId: "d",
    versionId: "v",
    page: 1,
    supported,
    support: { method: "decision", score: supported ? 0.9 : 0.1 },
  })),
});
const sampleOf = (e: Evidence) => e.documentId as SampleDocument;
const byId = (id: string) => {
  const c = PAGEINDEX_EVAL_CASES.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};

describe("the PageIndex evaluation set", () => {
  it("covers every kind of question, with pages for answerable ones and none for the rest", () => {
    const kinds = new Set(PAGEINDEX_EVAL_CASES.map((c) => c.kind));
    expect([...kinds].sort()).toEqual(
      [
        "ambiguous",
        "contradiction",
        "cross_section",
        "multi_document",
        "single_section",
        "unanswerable",
      ].sort(),
    );
    for (const c of PAGEINDEX_EVAL_CASES) {
      const pages = Object.values(c.expectedPages).flat();
      expect(c.unanswerable ? pages.length : pages.length > 0, c.id).toBe(
        c.unanswerable ? 0 : true,
      );
    }
    expect(THRESHOLDS.citationValidity).toBe(1);
  });

  it("scores recall by expected pages, and correctness by what the answer says", () => {
    const c = byId("business-class-contradiction");
    const both = scorePageIndexCase(
      c,
      retrieval([ev("E1", "travel", 1), ev("E2", "travel", 4)]),
      answer("Section 1.1 says 8 hours [E1] but the FAQ says 6 hours [E2].", "sufficient", [
        ["E1", true],
        ["E2", true],
      ]),
      sampleOf,
      40,
    );
    expect(both).toMatchObject({
      evidenceHit: true,
      answerCorrect: true,
      validCitations: 2,
      supportedCitations: 2,
    });
    const one = scorePageIndexCase(
      c,
      retrieval([ev("E1", "travel", 1)]),
      answer("It must be longer than 8 hours [E1].", "sufficient", [["E1", true]]),
      sampleOf,
      40,
    );
    expect(one).toMatchObject({ evidenceHit: false, answerCorrect: false });
  });

  it("counts abstention on unanswerable questions and invalid citations", () => {
    const r = scorePageIndexCase(
      byId("parental-leave"),
      retrieval([]),
      answer("The documents do not say.", "insufficient", [["E9", false]]),
      sampleOf,
      10,
    );
    expect(r).toMatchObject({
      evidenceHit: null,
      answerCorrect: null,
      abstained: true,
      citations: 1,
      validCitations: 0,
    });
    const s = summarizePageIndexEval([r]);
    expect(s.abstention).toEqual({ value: 1, of: 1 });
    expect(s.citationValidity).toEqual({ value: 0, of: 1 });
    expect(s.passed.citationValidity).toBe(false);
    expect(s.evidenceRecall).toEqual({ value: 1, of: 0 });
  });
});
