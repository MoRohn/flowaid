import { describe, expect, it } from "vitest";
import { UNTRUSTED_CLOSE } from "@flowaid/shared";
import { runNode } from "@flowaid/node-sdk/testing";
import { INSUFFICIENT_MARKER } from "@flowaid/pageindex";
import type { Evidence, JsonValue } from "@flowaid/workflow-core";
import { fakeDecider } from "../test/fakes.js";
import {
  DOC_A,
  FOREIGN_INDEX,
  INDEX_A,
  INDEX_A_OLD,
  INDEX_B,
  SOURCE_A,
  SOURCE_B,
  fakeDocuments,
  indexRef,
} from "../test/documents.js";
import {
  MAX_SUPPORT_CHECKS,
  indexEventName,
  pageindexCiteNode,
  pageindexIndexNode,
  pageindexRetrieveNode,
} from "./pageindex.js";

const scopeA = { scope: { sourceIds: [SOURCE_A] } };

describe("flowaid.pageindex.retrieve", () => {
  it("navigates the scope's ready indexes with choice decisions and returns cited page text", async () => {
    const documents = fakeDocuments();
    const decider = fakeDecider({});
    const r = await runNode(pageindexRetrieveNode, {
      config: scopeA,
      input: { query: "Who approves a $500 refund?" },
      documents,
      providers: { decision: decider },
    });
    if (r.result.kind !== "ok") throw new Error(JSON.stringify(r.result));
    const out = r.result.output as {
      evidence: Evidence[];
      status: string;
      index_ids: string[];
      prompt_context: string;
    };
    expect(out.status).toBe("complete");
    expect(out.index_ids).toEqual([INDEX_A]);
    expect(out.evidence[0]).toMatchObject({
      id: "E1",
      indexId: INDEX_A,
      documentId: DOC_A,
      sectionPath: ["Refunds"],
      locator: { kind: "pdf_page", page: 1, endPage: 1 },
      provenance: { method: "tree_navigation", provider: "typesafe" },
    });
    expect(out.prompt_context).toContain("[E1] Policy.pdf");
    expect(out.prompt_context.endsWith(UNTRUSTED_CLOSE)).toBe(true);
    expect(decider.questions[0]).toMatchObject({ kind: "choice" });
    expect(decider.chains).toEqual([[]]);
    expect(r.result.costUsd).toBeGreaterThan(0);
    expect(r.result.usage).toEqual({ inputTokens: 10, outputTokens: 0 });
  });

  it("uses the configured decision chain", async () => {
    const decider = fakeDecider({});
    const chain = [{ provider: "typesafe", model: "jev-latest" }];
    await runNode(pageindexRetrieveNode, {
      config: { ...scopeA, decisionChain: chain },
      input: { query: "refunds" },
      documents: fakeDocuments(),
      providers: { decision: decider },
    });
    expect(decider.chains).toEqual([chain]);
  });

  it.each([
    ["an index of a document outside the scope", INDEX_B],
    ["an index of another workspace", FOREIGN_INDEX],
  ])("rejects a pinned id that is %s before resolving anything", async (_what, indexId) => {
    const documents = fakeDocuments();
    const r = await runNode(pageindexRetrieveNode, {
      config: scopeA,
      input: { query: "refunds", index_ids: [indexId] },
      documents,
      providers: { decision: fakeDecider({}) },
    });
    expect(r.result).toMatchObject({
      kind: "error",
      error: { code: "BAD_REQUEST", message: expect.stringContaining("not in this node's") },
    });
    expect(documents.calls.map((c) => c.method)).not.toContain("resolve");
  });

  it("a pinned version in scope replaces its document's active index", async () => {
    const documents = fakeDocuments();
    const r = await runNode(pageindexRetrieveNode, {
      config: scopeA,
      input: { query: "refunds", index_ids: [INDEX_A_OLD] },
      documents,
      providers: { decision: fakeDecider({}) },
    });
    expect(r.result).toMatchObject({ kind: "ok", output: { index_ids: [INDEX_A_OLD] } });
  });

  it("never reads an index the host returns outside the scope", async () => {
    const documents = fakeDocuments();
    const resolve = documents.resolve.bind(documents);
    documents.resolve = async (scope) => [
      ...(await resolve(scope)),
      indexRef({
        indexId: INDEX_B,
        documentId: "db000000-0000-4000-8000-00000000000b",
        sourceId: SOURCE_B,
      }),
    ];
    const r = await runNode(pageindexRetrieveNode, {
      config: scopeA,
      input: { query: "refunds" },
      documents,
      providers: { decision: fakeDecider({}) },
    });
    expect(r.result).toMatchObject({ kind: "ok", output: { index_ids: [INDEX_A] } });
    expect(documents.calls.filter((c) => c.method === "outline").map((c) => c.arg)).toEqual([
      INDEX_A,
    ]);
  });

  it("is empty, with a warning naming why, when no index in scope is ready", async () => {
    const documents = fakeDocuments();
    documents.indexes.set(INDEX_B, {
      ...(documents.indexes.get(INDEX_B) ?? indexRef({ indexId: INDEX_B })),
      state: "running",
    });
    const r = await runNode(pageindexRetrieveNode, {
      config: { scope: { sourceIds: [SOURCE_B] } },
      input: { query: "termination" },
      documents,
      providers: { decision: fakeDecider({}) },
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      output: {
        status: "empty",
        evidence: [],
        index_ids: [],
        warnings: [expect.stringContaining("no document in this node's scope has a ready index")],
      },
    });
  });

  it("rejects an empty scope and more than 20 ids", async () => {
    const empty = await runNode(pageindexRetrieveNode, {
      config: { scope: {} },
      input: { query: "x" },
      documents: fakeDocuments(),
    });
    expect(empty.result).toMatchObject({ kind: "error", error: { code: "BAD_REQUEST" } });
    const ids = Array.from(
      { length: 11 },
      (_, i) => `0c000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const many = await runNode(pageindexRetrieveNode, {
      config: { scope: { sourceIds: ids, documentIds: ids } },
      input: { query: "x" },
      documents: fakeDocuments(),
    });
    expect(many.result).toMatchObject({
      kind: "error",
      error: { message: expect.stringContaining("at most 20") },
    });
  });

  it("bounds the budget in config", async () => {
    const r = await runNode(pageindexRetrieveNode, {
      config: { ...scopeA, budget: { maxPages: 41 } },
      input: { query: "x" },
      documents: fakeDocuments(),
    });
    expect(r.result).toMatchObject({ kind: "error", error: { code: "SCHEMA_VALIDATION_ERROR" } });
  });

  it("stops when the node is cancelled", async () => {
    const abort = new AbortController();
    abort.abort();
    const r = await runNode(pageindexRetrieveNode, {
      config: scopeA,
      input: { query: "x" },
      documents: fakeDocuments(),
      providers: { decision: fakeDecider({}) },
      signal: abort.signal,
    });
    expect(r.result).toMatchObject({ kind: "error", error: { code: "CANCELLED_ERROR" } });
  });

  it("fails clearly where the runtime has no document indexes", async () => {
    const r = await runNode(pageindexRetrieveNode, { config: scopeA, input: { query: "x" } });
    expect(r.result).toMatchObject({
      kind: "error",
      error: { code: "BAD_REQUEST", message: expect.stringContaining("services.documents") },
    });
  });
});

describe("flowaid.pageindex.index", () => {
  const INDEX_NEW = "1c000000-0000-4000-8000-00000000000c";
  const config = { documentId: DOC_A };

  it("returns a ready index at once (reused when it already existed)", async () => {
    const documents = fakeDocuments();
    documents.nextRequest = { index: indexRef({ indexId: INDEX_A }), created: false };
    const r = await runNode(pageindexIndexNode, { config, documents });
    expect(r.result).toMatchObject({
      kind: "ok",
      output: { index: { indexId: INDEX_A, state: "ready" }, reused: true },
    });
  });

  it("suspends on the build's event while it is queued, never returning it as done", async () => {
    const documents = fakeDocuments();
    documents.nextRequest = {
      index: indexRef({ indexId: INDEX_NEW, state: "queued", active: false, readyAt: null }),
      created: true,
    };
    const r = await runNode(pageindexIndexNode, { config, documents });
    expect(r.result).toMatchObject({
      kind: "suspend",
      wait: { kind: "event", eventName: indexEventName(INDEX_NEW), timeoutMs: 30 * 60_000 },
      state: { indexId: INDEX_NEW, created: true },
    });
    expect(indexEventName(INDEX_NEW)).toBe(`pageindex.index.${INDEX_NEW}`);
  });

  const waiting = (deadline = Date.parse("2026-01-01T00:30:00.000Z")) =>
    ({ indexId: INDEX_NEW, created: true, deadline }) as JsonValue;

  it("on the event, re-reads the index and outputs it once ready", async () => {
    const documents = fakeDocuments([indexRef({ indexId: INDEX_NEW })]);
    const r = await runNode(pageindexIndexNode, {
      config,
      documents,
      resume: { kind: "event", state: waiting(), payload: { indexId: INDEX_NEW, state: "ready" } },
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      output: { index: { indexId: INDEX_NEW }, reused: false },
    });
    expect(documents.calls).toEqual([{ method: "getIndex", arg: INDEX_NEW }]);
  });

  it("fails with the index's own error when the build failed", async () => {
    const documents = fakeDocuments([
      indexRef({
        indexId: INDEX_NEW,
        state: "failed",
        error: { code: "PARSE_FAILED", message: "the PDF is encrypted" },
      }),
    ]);
    const r = await runNode(pageindexIndexNode, {
      config,
      documents,
      // the payload claims ready; the index is the authority
      resume: { kind: "event", state: waiting(), payload: { indexId: INDEX_NEW, state: "ready" } },
    });
    expect(r.result).toMatchObject({
      kind: "error",
      error: { message: expect.stringContaining("PARSE_FAILED: the PDF is encrypted") },
    });
  });

  it.each(["canceled", "deleted"] as const)("fails when the index was %s", async (state) => {
    const r = await runNode(pageindexIndexNode, {
      config,
      documents: fakeDocuments([indexRef({ indexId: INDEX_NEW, state })]),
      resume: { kind: "event", state: waiting(), payload: { indexId: INDEX_NEW, state } },
    });
    expect(r.result).toMatchObject({
      kind: "error",
      error: { message: expect.stringContaining(`the index is ${state}`) },
    });
  });

  it("times out saying indexing continues in the background", async () => {
    const r = await runNode(pageindexIndexNode, {
      config,
      documents: fakeDocuments([indexRef({ indexId: INDEX_NEW, state: "running" })]),
      resume: { kind: "timeout", state: waiting() },
    });
    expect(r.result).toMatchObject({
      kind: "error",
      error: {
        code: "TIMEOUT_ERROR",
        message: expect.stringContaining("continues in the background"),
      },
    });
  });

  it("outputs the index when it became ready just as the wait timed out", async () => {
    const r = await runNode(pageindexIndexNode, {
      config,
      documents: fakeDocuments([indexRef({ indexId: INDEX_NEW })]),
      resume: { kind: "timeout", state: waiting() },
    });
    expect(r.result).toMatchObject({ kind: "ok", output: { index: { indexId: INDEX_NEW } } });
  });

  it("waits again for what is left when the event arrives before the build is ready", async () => {
    const r = await runNode(pageindexIndexNode, {
      config,
      documents: fakeDocuments([indexRef({ indexId: INDEX_NEW, state: "running" })]),
      resume: {
        kind: "event",
        state: waiting(),
        payload: { indexId: INDEX_NEW, state: "running" },
      },
    });
    expect(r.result).toMatchObject({ kind: "suspend", wait: { timeoutMs: 30 * 60_000 } });
    const late = await runNode(pageindexIndexNode, {
      config,
      documents: fakeDocuments([indexRef({ indexId: INDEX_NEW, state: "running" })]),
      resume: {
        kind: "event",
        state: waiting(Date.parse("2026-01-01T00:00:00.000Z")),
        payload: { indexId: INDEX_NEW, state: "running" },
      },
    });
    expect(late.result).toMatchObject({ kind: "error", error: { code: "TIMEOUT_ERROR" } });
  });

  it("requires a uuid document id", async () => {
    const r = await runNode(pageindexIndexNode, {
      config: { documentId: "policy.pdf" },
      documents: fakeDocuments(),
    });
    expect(r.result).toMatchObject({ kind: "error", error: { code: "SCHEMA_VALIDATION_ERROR" } });
  });
});

function evidence(id: string, excerpt: string, page = 1): Evidence {
  return {
    id,
    indexId: INDEX_A,
    documentId: DOC_A,
    versionId: "v-1",
    documentVersion: 1,
    indexVersion: 1,
    displayName: "Policy.pdf",
    nodeId: "0000",
    sectionPath: ["Refunds"],
    excerpt,
    truncated: false,
    locator: { kind: "pdf_page", page, endPage: page, pageLabel: null },
    provenance: { method: "tree_navigation", confidence: 0.8, provider: "typesafe" },
  };
}

const E1 = evidence("E1", "Refunds above $200 and up to $1,000 need approval from a team lead.");
const E2 = evidence("E2", "Deletion requests are completed within 30 days.", 2);

describe("flowaid.pageindex.cite", () => {
  it("routes sufficient when a TypeSafe yes/no per claim supports every citation", async () => {
    const decider = fakeDecider({ pYes: 0.93 });
    const r = await runNode(pageindexCiteNode, {
      input: {
        answer: "Refunds above $200 need a team lead's approval [E1]. Deletion takes 30 days [E2].",
        evidence: [E1, E2] as unknown as JsonValue,
      },
      providers: { decision: decider },
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      route: "sufficient",
      output: {
        status: "sufficient",
        run_id: "run_test",
        citations: [
          { marker: "E1", supported: true, support: { method: "decision", score: 0.93 } },
          { marker: "E2", supported: true, page: 2 },
        ],
      },
    });
    expect(decider.questions).toHaveLength(2);
    expect(decider.questions[0]).toMatchObject({
      kind: "boolean",
      instructions: expect.stringContaining(
        "Does the text fully support this statement? Statement: Refunds above $200",
      ),
    });
    expect(r.result.kind === "ok" && r.result.costUsd).toBeCloseTo(0.002);
  });

  it("routes insufficient when the judge rejects the only citation", async () => {
    const r = await runNode(pageindexCiteNode, {
      input: {
        answer: "Refunds need a director's approval [E1].",
        evidence: [E1] as unknown as JsonValue,
      },
      providers: { decision: fakeDecider({ pYes: 0.1 }) },
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      route: "insufficient",
      output: { citations: [{ supported: false }] },
    });
  });

  it("batches the claims that cite the same excerpt", async () => {
    const decider = fakeDecider({ pYes: 0.9 });
    let batches = 0;
    const batch = decider.batch.bind(decider);
    decider.batch = (...args) => {
      batches++;
      return batch(...args);
    };
    await runNode(pageindexCiteNode, {
      input: {
        answer: "Refunds above $200 need approval [E1]. Approval comes from a team lead [E1].",
        evidence: [E1] as unknown as JsonValue,
      },
      providers: { decision: () => decider },
    });
    expect(batches).toBe(1);
    expect(decider.questions).toHaveLength(2);
  });

  it("checks lexically without decisions when asked", async () => {
    const r = await runNode(pageindexCiteNode, {
      config: { judge: "lexical" },
      input: {
        answer:
          "Refunds above $200 need approval from a team lead [E1]. Deletion takes 45 days [E2].",
        evidence: [E1, E2] as unknown as JsonValue,
      },
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      route: "partial",
      output: {
        citations: [
          { marker: "E1", supported: true, support: { method: "lexical" } },
          { marker: "E2", supported: false },
        ],
      },
    });
  });

  it("routes insufficient when the answer says the evidence is not enough", async () => {
    const r = await runNode(pageindexCiteNode, {
      config: { judge: "lexical" },
      input: {
        answer: `${INSUFFICIENT_MARKER}: nothing about pensions.`,
        evidence: [E1] as unknown as JsonValue,
      },
    });
    expect(r.result).toMatchObject({ kind: "ok", route: "insufficient" });
  });

  it(`checks at most ${MAX_SUPPORT_CHECKS} claims and says so`, async () => {
    const decider = fakeDecider({ pYes: 0.9 });
    const answer = Array.from(
      { length: MAX_SUPPORT_CHECKS + 2 },
      (_, i) => `Refunds above $200 need approval number ${i} [E1].`,
    ).join(" ");
    const r = await runNode(pageindexCiteNode, {
      input: {
        answer,
        evidence: [
          evidence("E1", `${E1.excerpt} ${Array.from({ length: 30 }, (_, i) => i).join(" ")}`),
        ] as unknown as JsonValue,
      },
      providers: { decision: decider },
    });
    expect(decider.questions).toHaveLength(MAX_SUPPORT_CHECKS);
    expect(r.result).toMatchObject({
      kind: "ok",
      route: "partial",
      output: {
        limitations: expect.arrayContaining([
          expect.stringContaining("2 citations were not checked"),
        ]),
      },
    });
  });
});
