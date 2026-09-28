import { describe, expect, it } from "vitest";
import type { Evidence } from "@flowaid/workflow-core";
import { INSUFFICIENT_MARKER, checkCitations, claims, lexicalSupport } from "./cite.js";

const ev = (id: string, page: number, excerpt: string): Evidence => ({
  id,
  indexId: "i",
  documentId: "doc",
  versionId: "ver",
  documentVersion: 1,
  indexVersion: 1,
  displayName: "Handbook.pdf",
  nodeId: null,
  sectionPath: [],
  excerpt,
  truncated: false,
  locator: { kind: "pdf_page", page, endPage: page, pageLabel: null },
  provenance: { method: "tree_navigation", confidence: 0.9, provider: "typesafe" },
});

const EVIDENCE = [
  ev("E1", 1, "Refunds above $200 and up to $1,000 need approval from a team lead."),
  ev("E2", 2, "Deletion requests are completed within 30 days, as required by policy NW-PRIV-2."),
];

describe("claims and lexical support", () => {
  it("splits sentences and collects their markers", () => {
    expect(claims("A team lead approves it [E1]. Deletion takes 30 days [E2][E1].")).toEqual([
      { text: "A team lead approves it [E1].", markers: ["E1"] },
      { text: "Deletion takes 30 days [E2][E1].", markers: ["E2", "E1"] },
    ]);
  });
  it("needs every number and most content words in the excerpt", () => {
    expect(
      lexicalSupport("Refunds up to $1,000 need a team lead", EVIDENCE[0]?.excerpt ?? "").supported,
    ).toBe(true);
    expect(
      lexicalSupport("Refunds up to $5,000 need a team lead", EVIDENCE[0]?.excerpt ?? ""),
    ).toEqual({
      supported: false,
      score: 0,
    });
    expect(
      lexicalSupport("Chat transcripts are kept forever", EVIDENCE[0]?.excerpt ?? "").supported,
    ).toBe(false);
  });
});

describe("checkCitations", () => {
  it("accepts an answer whose every citation is real and supports its sentence", async () => {
    const g = await checkCitations({
      answer:
        "A team lead approves refunds above $200 up to $1,000 [E1]. Deletion requests take 30 days [E2].",
      evidence: EVIDENCE,
      runId: "run-1",
    });
    expect(g.status).toBe("sufficient");
    expect(g.citations).toEqual([
      expect.objectContaining({
        marker: "E1",
        page: 1,
        supported: true,
        support: expect.objectContaining({ method: "lexical" }),
      }),
      expect.objectContaining({ marker: "E2", page: 2, supported: true }),
    ]);
    expect(g.limitations).toEqual([]);
    expect(g.runId).toBe("run-1");
  });

  it("drops citations to evidence that was never retrieved and marks unsupported ones", async () => {
    const g = await checkCitations({
      answer: "Refunds need finance approval above $5,000 [E1]. Phone calls are logged [E7].",
      evidence: EVIDENCE,
      runId: "r",
    });
    expect(g.citations.map((c) => [c.marker, c.supported])).toEqual([["E1", false]]);
    expect(g.status).toBe("insufficient");
    expect(g.limitations.join(" ")).toMatch(/E7, which no retrieved evidence carries/);
    expect(g.limitations.join(" ")).toMatch(/1 citation does not support/);
  });

  it("is partial when some claims are supported and others are not cited", async () => {
    const g = await checkCitations({
      answer:
        "A team lead approves refunds up to $1,000 [E1]. Premium customers get answers in 2 hours.",
      evidence: EVIDENCE,
      runId: "r",
    });
    expect(g.status).toBe("partial");
    expect(g.limitations).toContain("1 sentence make claims without a citation");
  });

  it("honours the insufficient marker and empty evidence", async () => {
    const g = await checkCitations({
      answer: `${INSUFFICIENT_MARKER} The handbook does not cover revenue.`,
      evidence: EVIDENCE,
      runId: "r",
    });
    expect(g.status).toBe("insufficient");
    expect(g.answer).toBe("The handbook does not cover revenue.");
    expect(
      (await checkCitations({ answer: "Anything [E1].", evidence: [], runId: "r" })).status,
    ).toBe("insufficient");
  });

  it("uses the judge when there is one and records its method", async () => {
    const seen: string[] = [];
    const g = await checkCitations({
      answer: "A team lead approves mid-sized refunds [E1].",
      evidence: EVIDENCE,
      runId: "r",
      judge: (checks) => {
        seen.push(...checks.map((c) => `${c.claim}|${c.evidence.id}`));
        return Promise.resolve(checks.map((c) => ({ id: c.id, supported: true, score: 0.93 })));
      },
    });
    expect(seen).toEqual(["A team lead approves mid-sized refunds .|E1"]);
    expect(g.citations[0]?.support).toEqual({ method: "decision", score: 0.93 });
    expect(g.status).toBe("sufficient");
  });
});
