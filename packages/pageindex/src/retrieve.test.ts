import { describe, expect, it } from "vitest";
import type { IndexReference, OutlineNode } from "@flowaid/workflow-core";
import { LOCAL_CAPABILITIES } from "./capabilities.js";
import {
  evidenceForPrompt,
  retrieveEvidence,
  sectionSnippet,
  type Navigator,
  type NavigatorChoice,
} from "./retrieve.js";

const index = (id: string, name: string): IndexReference => ({
  indexId: id,
  documentId: `doc-${id}`,
  sourceId: "src",
  versionId: `ver-${id}`,
  documentVersion: 2,
  indexVersion: 1,
  displayName: name,
  state: "ready",
  active: true,
  backend: "pageindex",
  mode: "local",
  backendVersion: "pageindex 0.2.20",
  configHash: "h",
  indexModel: "ollama/qwen2.5:3b",
  pageCount: 12,
  stage: null,
  error: null,
  createdAt: "2026-09-28T00:00:00Z",
  readyAt: "2026-09-28T00:01:00Z",
  capabilities: LOCAL_CAPABILITIES,
});

/** A 12-page handbook: two chapters, the first with three sections. */
const OUTLINE: OutlineNode[] = [
  {
    nodeId: "0001",
    title: "Customer policies",
    startPage: 1,
    endPage: 8,
    summary: "Refunds, escalations and data requests",
    children: [
      {
        nodeId: "0002",
        title: "Refunds",
        startPage: 1,
        endPage: 2,
        summary: "refund limits and approvals",
      },
      {
        nodeId: "0003",
        title: "Escalations",
        startPage: 3,
        endPage: 5,
        summary: "when tickets escalate",
      },
      { nodeId: "0004", title: "Data requests", startPage: 6, endPage: 8 },
    ],
  },
  { nodeId: "0005", title: "Tools", startPage: 9, endPage: 12, summary: "ticketing and chat" },
];

const pageText = (p: number) => `page ${p} text`;
const readPages = (_: string, pages: number[]) =>
  Promise.resolve(pages.map((page) => ({ page, text: pageText(page) })));

/** A navigator that picks options by title keyword, recording every question. */
function navigator(
  pick: (choice: NavigatorChoice) => Record<string, number>,
  seen: NavigatorChoice[] = [],
): Navigator {
  return (choice) => {
    seen.push(choice);
    const probabilities = pick(choice);
    const value = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
    return Promise.resolve({
      value,
      probabilities,
      confidence: probabilities[value] ?? null,
      provider: "typesafe",
      usage: { inputTokens: 100, outputTokens: 0 },
      costUsd: 0.0001,
    });
  };
}
const byTitle = (want: string) => (c: NavigatorChoice) =>
  Object.fromEntries(
    Object.entries(c.options).map(([k, v]) => [
      k,
      k !== "none" && v.startsWith(want) ? 0.9 : 0.1 / Object.keys(c.options).length,
    ]),
  );

describe("retrieveEvidence", () => {
  it("opens a chosen chapter and reads the chosen section's pages", async () => {
    const seen: NavigatorChoice[] = [];
    const nav = navigator(
      (c) =>
        byTitle(c.instructions.includes("Customer policies") ? "Refunds" : "Customer policies")(c),
      seen,
    );
    const r = await retrieveEvidence({
      query: "Who approves a $600 refund?",
      indexes: [index("i1", "Handbook.pdf")],
      outline: () => Promise.resolve(OUTLINE),
      readPages,
      navigate: nav,
    });
    expect(r.status).toBe("complete");
    expect(r.evidence).toHaveLength(1);
    const e = r.evidence[0];
    expect(e).toMatchObject({
      id: "E1",
      indexId: "i1",
      documentId: "doc-i1",
      versionId: "ver-i1",
      nodeId: "0002",
      sectionPath: ["Customer policies", "Refunds"],
      locator: { kind: "pdf_page", page: 1, endPage: 2, pageLabel: null },
      provenance: { method: "tree_navigation", provider: "typesafe" },
    });
    expect(e?.excerpt).toBe("page 1 text\n\npage 2 text");
    // 0.9 at each of two levels
    expect(e?.provenance.confidence).toBeCloseTo(0.81, 2);
    expect(r.activity).toMatchObject({
      documents: 1,
      decisions: 2,
      pagesRead: 2,
      sectionsInspected: 5,
    });
    expect(r.costUsd).toBeCloseTo(0.0002);
    expect(r.usage).toEqual({ inputTokens: 200, outputTokens: 0 });
    // the question goes in the state, the options carry titles, pages and summaries, plus an escape
    expect(seen[0]?.state).toBe("Question: Who approves a $600 refund?");
    expect(seen[0]?.options.s0).toBe(
      "Customer policies (pages 1–8) — Refunds, escalations and data requests",
    );
    expect(seen[0]?.options.none).toBeDefined();
    expect(seen[1]?.instructions).toContain('within "Customer policies"');
  });

  it("returns empty when the navigator says nothing is relevant", async () => {
    const r = await retrieveEvidence({
      query: "What is the capital of France?",
      indexes: [index("i1", "Handbook.pdf")],
      outline: () => Promise.resolve(OUTLINE),
      readPages,
      navigate: navigator((c) =>
        Object.fromEntries(Object.keys(c.options).map((k) => [k, k === "none" ? 0.95 : 0.02])),
      ),
    });
    expect(r).toMatchObject({ status: "empty", evidence: [] });
    expect(r.activity.pagesRead).toBe(0);
  });

  it("reads a long section only up to the per-section page limit and marks it truncated", async () => {
    const r = await retrieveEvidence({
      query: "tools",
      indexes: [index("i1", "Handbook.pdf")],
      outline: () => Promise.resolve(OUTLINE),
      readPages,
      navigate: navigator(byTitle("Tools")),
    });
    expect(r.evidence[0]?.locator).toEqual({
      kind: "pdf_page",
      page: 9,
      endPage: 11,
      pageLabel: null,
    });
    expect(r.evidence[0]?.truncated).toBe(true);
  });

  it("stops at the decision budget and says so", async () => {
    const r = await retrieveEvidence({
      query: "x",
      indexes: [index("i1", "A.pdf"), index("i2", "B.pdf")],
      outline: () => Promise.resolve(OUTLINE),
      readPages,
      navigate: navigator(byTitle("Customer policies")),
      budget: { maxDecisions: 1 },
    });
    expect(r.status).toBe("partial");
    expect(r.warnings).toContain("stopped at the decision budget (1 choices)");
    expect(r.activity.decisions).toBe(1);
  });

  it("covers several documents, skipping one whose outline fails, and refuses too many", async () => {
    const r = await retrieveEvidence({
      query: "refunds",
      indexes: [index("i1", "A.pdf"), index("i2", "Broken.pdf")],
      outline: (id) =>
        id === "i2" ? Promise.reject(new Error("index not ready")) : Promise.resolve(OUTLINE),
      readPages,
      navigate: navigator((c) =>
        byTitle(c.instructions.includes("Customer policies") ? "Refunds" : "Customer policies")(c),
      ),
    });
    expect(r.status).toBe("partial");
    expect(r.evidence.map((e) => e.displayName)).toEqual(["A.pdf"]);
    expect(r.warnings[0]).toMatch(/Broken\.pdf: the outline could not be read \(index not ready\)/);
    await expect(
      retrieveEvidence({
        query: "q",
        indexes: Array.from({ length: 6 }, (_, i) => index(`i${i}`, `${i}.pdf`)),
        outline: () => Promise.resolve(OUTLINE),
        readPages,
        navigate: navigator(byTitle("x")),
      }),
    ).rejects.toThrow(/at most 5 documents/);
  });

  it("formats evidence for a prompt with markers, sections and pages", () => {
    expect(
      evidenceForPrompt([
        {
          id: "E1",
          indexId: "i",
          documentId: "d",
          versionId: "v",
          documentVersion: 1,
          indexVersion: 1,
          displayName: "Handbook.pdf",
          nodeId: "0002",
          sectionPath: ["Policies", "Refunds"],
          excerpt: "Refunds above $200 need a team lead.",
          truncated: false,
          locator: { kind: "pdf_page", page: 2, endPage: 2, pageLabel: null },
          provenance: { method: "tree_navigation", confidence: 0.8, provider: "typesafe" },
        },
      ]),
    ).toBe(
      '[E1] Handbook.pdf, section "Policies › Refunds", page 2:\nRefunds above $200 need a team lead.',
    );
  });
  it("describes each section by its own text when siblings share a page's summary", () => {
    const page =
      "4. Service levels First responses are sent within 8 hours. 5. Tools The team uses tickets.";
    const a = { nodeId: "a", title: "4. Service levels", startPage: 2, endPage: 2, summary: page };
    const b = { nodeId: "b", title: "5. Tools", startPage: 2, endPage: 2, summary: page };
    expect(sectionSnippet(a, b)).toBe("First responses are sent within 8 hours.");
    expect(sectionSnippet(b, undefined)).toBe("The team uses tickets.");
    expect(sectionSnippet({ ...a, summary: "A model-written summary." }, b)).toBe(
      "A model-written summary.",
    );
  });
});
