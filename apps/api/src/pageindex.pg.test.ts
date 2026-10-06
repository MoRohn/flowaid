import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { markIndexReady, markIndexRunning } from "@flowaid/database";
import { describeDb } from "@flowaid/database/testing";
import { startPageIndexStub, type PageIndexStub } from "@flowaid/pageindex/testing";
import {
  DefaultModelCatalog,
  ProviderRegistry,
  booleanDecision,
  choiceDecision,
} from "@flowaid/providers";
import type {
  DecisionProvider,
  GenerationProvider,
  GenerationRequest,
  OutlineNode,
} from "@flowaid/workflow-core";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

const HEALTHY = {
  status: "healthy" as const,
  errorRate1m: 0,
  p95LatencyMs: 0,
  consecutiveFailures: 0,
  checkedAt: "2026-01-01T00:00:00.000Z",
};

const TREE: OutlineNode[] = [
  { nodeId: "0000", title: "Refunds", startPage: 1, endPage: 1, summary: "who approves refunds" },
  { nodeId: "0001", title: "Data requests", startPage: 2, endPage: 3, summary: "export, deletion" },
];
const PAGES = [
  "Refunds above $200 and up to $1,000 need approval from a team lead.",
  "Deletion requests are completed within 30 days.",
  "Export requests are answered within 1 business day.",
];

/**
 * Chooses the section whose description names the question's topic; supports a statement when
 * its closing words appear in the text.
 */
function fakeDecision(calls: { choice: number; boolean: number }): DecisionProvider {
  const meta = { provider: "fake", model: "nav", latencyMs: 1, costUsd: 0.001 };
  return {
    id: "fake",
    model: "nav",
    capabilities: {
      batch: false,
      maxQuestions: 1,
      maxStateTokens: 10_000,
      kinds: ["boolean", "choice"],
      text: true,
      images: false,
    },
    decideBoolean: (state, q) => {
      calls.boolean++;
      const tail = q.instructions
        .replace(/[\s.]+$/, "")
        .split(" ")
        .slice(-3)
        .join(" ");
      return Promise.resolve(
        booleanDecision(JSON.stringify(state).includes(tail) ? 0.9 : 0.1, meta),
      );
    },
    decideChoice: (state, q) => {
      calls.choice++;
      const topic = JSON.stringify(state).toLowerCase().includes("refund")
        ? "Refunds"
        : "Data requests";
      const probabilities: Record<string, number> = {};
      for (const [key, text] of Object.entries(q.options))
        probabilities[key] = text.startsWith(topic) ? 0.9 : key === "none" ? 0.05 : 0.02;
      return Promise.resolve(choiceDecision(probabilities, meta));
    },
    decideScore: () => Promise.reject(new Error("not used")),
    batch: () => Promise.reject(new Error("not used")),
    health: () => HEALTHY,
  };
}

/** A generation model that answers with the queued texts. */
function fakeGeneration(answers: string[], requests: GenerationRequest[]): GenerationProvider {
  return {
    id: "fake",
    model: "m",
    capabilities: {
      tools: false,
      jsonSchema: false,
      vision: false,
      streaming: false,
      thinking: false,
      maxContext: 200_000,
    },
    generate(req) {
      requests.push(req);
      const text = answers.shift();
      if (text === undefined) return Promise.reject(new Error("no more answers"));
      return Promise.resolve({
        text,
        toolCalls: [],
        finishReason: "stop" as const,
        usage: { inputTokens: 400, outputTokens: 40 },
        costUsd: 0.002,
        priceSnapshot: null,
        latencyMs: 5,
        provider: "fake",
        model: "m",
      });
    },
    stream: () => {
      throw new Error("not used");
    },
    health: () => HEALTHY,
  };
}

const pdf = (text: string) => Buffer.from(`%PDF-1.7\n% ${text}\n%%EOF\n`, "latin1");

describeDb("PageIndex routes (Postgres + a stub service)", () => {
  let t: TestApp;
  let jar: Jar;
  let stub: PageIndexStub;
  let artifactsDir: string;
  let workspaceId: string;
  let sourceId: string;
  const calls = { choice: 0, boolean: 0 };
  const answers: string[] = [];
  const requests: GenerationRequest[] = [];

  beforeAll(async () => {
    stub = await startPageIndexStub();
    artifactsDir = await mkdtemp(join(tmpdir(), "flowaid-pageindex-"));
    t = await createTestApp({ pageIndex: { url: stub.url, token: stub.token }, artifactsDir });
    const registry = new ProviderRegistry({ catalog: new DefaultModelCatalog() });
    registry.register({ id: "fake", kind: "decision", create: () => fakeDecision(calls) });
    registry.register({
      id: "fake",
      kind: "generation",
      create: () => fakeGeneration(answers, requests),
    });
    t.ctx.providers = registry;
    jar = await login(t.app);
    workspaceId = (await call(t.app, jar, "GET", "/v1/me")).json().workspaces[0].id as string;
    const settings = await call(t.app, jar, "PATCH", `/v1/workspaces/${workspaceId}`, {
      settings: {
        advisorModel: { provider: "fake", model: "m" },
        defaultDecisionChain: [{ provider: "custom", id: "fake" }],
      },
    });
    expect(settings.statusCode).toBe(200);
  });
  afterAll(async () => {
    await t.close();
    await stub.close();
    await rm(artifactsDir, { recursive: true, force: true });
  });

  const upload = (
    source: string,
    body: Buffer,
    o: { name?: string; documentId?: string; headers?: Record<string, string> } = {},
  ) =>
    t.app.inject({
      method: "POST",
      url: `/v1/pageindex/sources/${source}/documents${o.documentId ? `?documentId=${o.documentId}` : ""}`,
      payload: body,
      headers: {
        cookie: jar.header("/v1/pageindex"),
        "x-requested-with": "flowaid",
        "content-type": "application/pdf",
        ...(o.name ? { "x-file-name": encodeURIComponent(o.name) } : {}),
        ...o.headers,
      },
    });

  const jobs = async (prefix: string) =>
    t.db.app.system((tx) =>
      tx.execute<{ id: string; payload: Record<string, unknown> }>(
        sql`select id, payload from queue_jobs where queue = 'ingest' and id like ${`${prefix}%`}`,
      ),
    );

  /** What the worker does when a build finishes: the stub holds the document, the row is ready. */
  const makeReady = async (ws: string, indexId: string, docId: string) => {
    stub.documents.set(docId, {
      docId,
      workspaceId: ws,
      indexId,
      pageCount: PAGES.length,
      tree: TREE,
      pages: PAGES,
    });
    await t.db.app.tenant(ws, async (tx) => {
      expect(await markIndexRunning(tx, ws, indexId, "indexing")).toBe(true);
      expect(
        await markIndexReady(tx, ws, indexId, {
          upstreamDocId: docId,
          pageCount: PAGES.length,
          description: "Policies",
          outline: TREE as never,
          backendVersion: "pageindex 0.2.20",
        }),
      ).toBe(true);
    });
  };

  describe("with the service off", () => {
    it("refuses pageindex sources and routes with 409 PAGEINDEX_DISABLED", async () => {
      const saved = t.ctx.config.pageIndex;
      t.ctx.config.pageIndex = null;
      try {
        const created = await call(t.app, jar, "POST", "/v1/knowledge/sources", {
          name: "Off",
          kind: "pageindex",
          config: { indexModel: { provider: "ollama", model: "qwen2.5:3b" } },
        });
        expect(created.statusCode).toBe(409);
        expect(created.json().error.code).toBe("PAGEINDEX_DISABLED");
        const status = await call(t.app, jar, "GET", "/v1/pageindex/status");
        expect(status.json()).toMatchObject({ enabled: false, reachable: false });
        const query = await call(t.app, jar, "POST", "/v1/pageindex/query", {
          query: "x",
          scope: { documentIds: [workspaceId] },
        });
        expect(query.json().error.code).toBe("PAGEINDEX_DISABLED");
        expect((await call(t.app, jar, "GET", "/v1/me")).json().features.pageindex).toBe(false);
      } finally {
        t.ctx.config.pageIndex = saved;
      }
    });
  });

  it("reports the service's status and modes", async () => {
    const res = await call(t.app, jar, "GET", "/v1/pageindex/status");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      enabled: true,
      reachable: true,
      sdkVersion: "0.2.20",
      protocol: "1",
      modes: { local: { available: true }, cloud: { available: false, capabilities: null } },
    });
  });

  it("validates a pageindex source's settings and credential", async () => {
    const bad = await call(t.app, jar, "POST", "/v1/knowledge/sources", {
      name: "Bad",
      kind: "pageindex",
      config: { indexModel: { provider: "typesafe", model: "jev" } },
    });
    expect(bad.statusCode).toBe(400);
    const cred = await call(t.app, jar, "POST", "/v1/credentials", {
      name: "bearer",
      type: "http.bearer",
      values: { token: "sk-live-1234567890abcdef" },
    });
    expect(cred.statusCode).toBe(201);
    const wrongType = await call(t.app, jar, "POST", "/v1/knowledge/sources", {
      name: "Wrong credential",
      kind: "pageindex",
      config: {
        indexModel: { provider: "openai", model: "gpt-5.5-mini" },
        credentialId: cred.json().id as string,
      },
    });
    expect(wrongType.statusCode).toBe(400);
    expect(wrongType.json().error.message).toMatch(/openai\.api_key/);

    const created = await call(t.app, jar, "POST", "/v1/knowledge/sources", {
      name: "Policies",
      kind: "pageindex",
      config: { indexModel: { provider: "ollama", model: "qwen2.5:3b" } },
    });
    expect(created.statusCode).toBe(201);
    sourceId = created.json().id as string;
    expect(created.json().config).toEqual({
      indexModel: { provider: "ollama", model: "qwen2.5:3b" },
      credentialId: null,
      mode: "flash",
      optimize: "off",
    });
    // nothing to sync: documents arrive by upload
    const synced = await t.db.app.system((tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from queue_jobs where payload->>'sourceId' = ${sourceId}`,
      ),
    );
    expect(synced[0]?.n).toBe(0);
    expect(
      (await call(t.app, jar, "POST", `/v1/knowledge/sources/${sourceId}/sync`)).statusCode,
    ).toBe(400);
    const text = await call(t.app, jar, "POST", `/v1/knowledge/sources/${sourceId}/documents`, {
      documents: [{ title: "x", text: "y" }],
    });
    expect(text.statusCode).toBe(400);
    expect(text.json().error.message).toMatch(/\/v1\/pageindex\/sources/);
  });

  let documentId: string;
  let versionId: string;
  let indexId: string;
  const first = pdf("travel policy v1");

  it("refuses bodies that are not PDFs or are too large", async () => {
    const text = await upload(sourceId, Buffer.from("hello, not a pdf"), {
      headers: { "content-type": "text/plain" },
    });
    expect(text.statusCode).toBe(415);
    expect(text.json().error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    const empty = await upload(sourceId, Buffer.alloc(0));
    expect(empty.statusCode).toBe(415);
    const big = Buffer.alloc(50 * 1024 * 1024 + 1, 0x20);
    pdf("big").copy(big);
    const tooLarge = await upload(sourceId, big);
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json().error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("uploads a PDF, stores it, and queues its index", async () => {
    const res = await upload(sourceId, first, { name: "Travel policy 2026.pdf" });
    expect(res.statusCode).toBe(201);
    const out = res.json();
    expect(out.created).toBe(true);
    expect(out.document).toMatchObject({
      title: "Travel policy 2026.pdf",
      status: "pending",
      versions: 1,
      activeIndex: null,
    });
    expect(out.version).toMatchObject({
      version: 1,
      bytes: first.length,
      mediaType: "application/pdf",
      displayName: "Travel policy 2026.pdf",
    });
    expect(out.index).toMatchObject({
      state: "queued",
      documentVersion: 1,
      indexVersion: 1,
      indexModel: "ollama/qwen2.5:3b",
      backend: "pageindex",
    });
    documentId = out.document.documentId as string;
    versionId = out.version.versionId as string;
    indexId = out.index.indexId as string;
    const queued = await jobs(`pageindex:${indexId}`);
    expect(queued[0]?.payload).toEqual({ type: "pageindex.index", workspaceId, indexId });
    // the settings the worker indexes with
    const [row] = await t.db.admin<{ settings: Record<string, unknown> }[]>`
      select settings from document_indexes where id = ${indexId}`;
    expect(row?.settings).toEqual({
      model: { provider: "ollama", model: "qwen2.5:3b" },
      mode: "flash",
      optimize: "off",
      credentialId: null,
    });
  });

  it("lists a source's stored documents with the service off, and refuses the rest", async () => {
    const saved = t.ctx.config.pageIndex;
    t.ctx.config.pageIndex = null;
    try {
      // the list is the database's: the page shows what the source holds while it is off
      const list = await call(t.app, jar, "GET", `/v1/pageindex/sources/${sourceId}/documents`);
      expect(list.statusCode).toBe(200);
      expect(list.json().items.map((d: { documentId: string }) => d.documentId)).toContain(
        documentId,
      );
      const again = await upload(sourceId, first, { name: "copy.pdf" });
      expect(again.json().error.code).toBe("PAGEINDEX_DISABLED");
    } finally {
      t.ctx.config.pageIndex = saved;
    }
  });

  it("answers the same bytes with the existing version and index", async () => {
    const again = await upload(sourceId, first, { name: "copy.pdf" });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({
      created: false,
      document: { documentId },
      version: { versionId },
      index: { indexId },
    });
    const artifacts = await t.db.admin<{ n: number }[]>`
      select count(*)::int as n from artifacts where kind = 'upload'`;
    expect(artifacts[0]?.n).toBe(1);
  });

  let v2IndexId: string;
  it("adds a version to a document and indexes it", async () => {
    const res = await upload(sourceId, pdf("travel policy v2"), {
      name: "Travel policy 2026 rev.pdf",
      documentId,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      document: { documentId, versions: 2, title: "Travel policy 2026.pdf" },
      version: { version: 2 },
      index: { documentVersion: 2, indexVersion: 2, state: "queued" },
    });
    v2IndexId = res.json().index.indexId as string;
    expect(v2IndexId).not.toBe(indexId);
    const list = await call(t.app, jar, "GET", `/v1/pageindex/sources/${sourceId}/documents`);
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0]).toMatchObject({
      versions: 2,
      latestIndex: { indexId: v2IndexId },
    });
  });

  it("serves the original file inline, byte for byte", async () => {
    const res = await call(
      t.app,
      jar,
      "GET",
      `/v1/pageindex/documents/${documentId}/versions/${versionId}/file`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(first)).toBe(true);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-disposition"]).toBe(
      `inline; filename="Travel_policy_2026.pdf"; filename*=UTF-8''Travel%20policy%202026.pdf`,
    );
  });

  it("cancels a queued build, and builds again on request", async () => {
    const canceled = await call(t.app, jar, "POST", `/v1/pageindex/indexes/${v2IndexId}/cancel`);
    expect(canceled.statusCode).toBe(200);
    expect(canceled.json().state).toBe("canceled");
    expect(
      (await call(t.app, jar, "POST", `/v1/pageindex/indexes/${v2IndexId}/cancel`)).statusCode,
    ).toBe(409);
    const again = await call(t.app, jar, "POST", `/v1/pageindex/documents/${documentId}/index`);
    expect(again.statusCode).toBe(202);
    expect(again.json()).toMatchObject({ created: true, index: { indexVersion: 3 } });
    const joined = await call(t.app, jar, "POST", `/v1/pageindex/documents/${documentId}/index`);
    expect(joined.statusCode).toBe(200);
    expect(joined.json().index.indexId).toBe(again.json().index.indexId);
  });

  it("serves the outline of ready indexes only", async () => {
    expect(
      (await call(t.app, jar, "GET", `/v1/pageindex/indexes/${indexId}/outline`)).json().error.code,
    ).toBe("INDEX_NOT_READY");
    await makeReady(workspaceId, indexId, `pi-${"a".repeat(32)}`);
    const res = await call(t.app, jar, "GET", `/v1/pageindex/indexes/${indexId}/outline`);
    expect(res.statusCode).toBe(200);
    expect(res.json().outline).toEqual(TREE);
    const ref = await call(t.app, jar, "GET", `/v1/pageindex/indexes/${indexId}`);
    expect(ref.json()).toMatchObject({ state: "ready", active: true, pageCount: 3 });
  });

  it("retrieves evidence with page locators through the decision chain", async () => {
    const before = calls.choice;
    const res = await call(t.app, jar, "POST", "/v1/pageindex/query", {
      query: "Who approves refunds over $200?",
      scope: { sourceIds: [sourceId] },
    });
    expect(res.statusCode).toBe(200);
    const { retrieval, answer, model } = res.json();
    expect(answer).toBeNull();
    expect(model).toBeNull();
    expect(retrieval.status).toBe("complete");
    expect(retrieval.evidence).toHaveLength(1);
    expect(retrieval.evidence[0]).toMatchObject({
      id: "E1",
      indexId,
      documentId,
      versionId,
      displayName: "Travel policy 2026.pdf",
      sectionPath: ["Refunds"],
      locator: { kind: "pdf_page", page: 1, endPage: 1, pageLabel: null },
      provenance: { method: "tree_navigation", confidence: 0.9, provider: "fake" },
    });
    expect(retrieval.evidence[0].excerpt).toContain("team lead");
    expect(calls.choice).toBe(before + 1);
    expect(retrieval.costUsd).toBeCloseTo(0.001);
  });

  it("answers with checked citations and audits counts, not the question", async () => {
    answers.push("Refunds above $200 need approval from a team lead [E1].");
    const res = await call(t.app, jar, "POST", "/v1/pageindex/query", {
      query: "Who approves refunds over $200?",
      scope: { documentIds: [documentId] },
      answer: true,
    });
    expect(res.statusCode).toBe(200);
    const { answer, model } = res.json();
    expect(model).toEqual({ provider: "fake", model: "m" });
    expect(answer).toMatchObject({
      status: "sufficient",
      citations: [
        {
          marker: "E1",
          documentId,
          versionId,
          page: 1,
          supported: true,
          support: { method: "decision", score: 0.9 },
        },
      ],
    });
    // the evidence reached the model as delimited, untrusted data
    const content = requests.at(-1)?.messages[1]?.content;
    const prompt = typeof content === "string" ? content : "";
    expect(prompt).toContain("<<<UNTRUSTED");
    expect(prompt).toContain("[E1] Travel policy 2026.pdf");

    // a citation that does not say what the sentence says is caught
    answers.push("Refunds need approval from the finance director [E1].");
    const unsupported = await call(t.app, jar, "POST", "/v1/pageindex/query", {
      query: "Who approves refunds?",
      scope: { indexIds: [indexId] },
      answer: true,
    });
    expect(unsupported.json().answer).toMatchObject({
      status: "insufficient",
      citations: [{ marker: "E1", supported: false }],
    });

    const audit = await t.db.admin<{ details: Record<string, unknown> }[]>`
      select details from audit_events where action = 'pageindex.query' order by id`;
    expect(audit.length).toBeGreaterThanOrEqual(2);
    const last = audit.at(-1)?.details ?? {};
    expect(last).toMatchObject({ evidence: 1, answered: true, model: "fake/m" });
    expect(JSON.stringify(audit)).not.toContain("refunds");
  });

  it("keeps other workspaces' documents out of reach", async () => {
    const ws = await call(t.app, jar, "POST", "/v1/workspaces", { name: "Other", slug: "other" });
    expect(ws.statusCode).toBe(201);
    const other = { "x-workspace": "other" };
    const src = await call(
      t.app,
      jar,
      "POST",
      "/v1/knowledge/sources",
      {
        name: "Theirs",
        kind: "pageindex",
        config: { indexModel: { provider: "ollama", model: "qwen2.5:3b" } },
      },
      other,
    );
    expect(src.statusCode).toBe(201);
    const theirs = await upload(src.json().id as string, pdf("their file"), {
      name: "theirs.pdf",
      headers: other,
    });
    expect(theirs.statusCode).toBe(201);
    const t2 = theirs.json();
    const otherWs = (await call(t.app, jar, "GET", "/v1/me", undefined, other)).json()
      .workspaces as { id: string; slug: string }[];
    const otherId = otherWs.find((w) => w.slug === "other")?.id as string;
    await makeReady(otherId, t2.index.indexId as string, `pi-${"b".repeat(32)}`);

    const d = t2.document.documentId as string;
    const i = t2.index.indexId as string;
    for (const url of [
      `/v1/pageindex/documents/${d}`,
      `/v1/pageindex/documents/${d}/versions/${t2.version.versionId as string}/file`,
      `/v1/pageindex/indexes/${i}`,
      `/v1/pageindex/indexes/${i}/outline`,
      `/v1/pageindex/sources/${src.json().id as string}/documents`,
    ])
      expect((await call(t.app, jar, "GET", url)).statusCode, url).toBe(404);
    expect((await upload(src.json().id as string, pdf("mine"))).statusCode).toBe(404);
    for (const scope of [
      { documentIds: [d] },
      { indexIds: [i] },
      { sourceIds: [src.json().id as string] },
    ])
      expect(
        (await call(t.app, jar, "POST", "/v1/pageindex/query", { query: "refunds", scope }))
          .statusCode,
      ).toBe(404);
    // and their own workspace reads it
    expect(
      (await call(t.app, jar, "GET", `/v1/pageindex/indexes/${i}/outline`, undefined, other))
        .statusCode,
    ).toBe(200);
  });

  it("refuses scopes over more than five documents", async () => {
    const src = await call(t.app, jar, "POST", "/v1/knowledge/sources", {
      name: "Many",
      kind: "pageindex",
      config: { indexModel: { provider: "ollama", model: "qwen2.5:3b" } },
    });
    const id = src.json().id as string;
    for (let n = 0; n < 6; n++) {
      const up = await upload(id, pdf(`many ${n}`), { name: `m${n}.pdf` });
      await makeReady(
        workspaceId,
        up.json().index.indexId as string,
        `pi-${n.toString().padStart(32, "c")}`,
      );
    }
    const res = await call(t.app, jar, "POST", "/v1/pageindex/query", {
      query: "refunds",
      scope: { sourceIds: [id] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/at most 5/);
  });

  it("deletes a document: access stops at once and cleanup is queued", async () => {
    const res = await call(t.app, jar, "DELETE", `/v1/pageindex/documents/${documentId}`);
    expect(res.statusCode).toBe(202);
    const list = await call(t.app, jar, "GET", `/v1/pageindex/sources/${sourceId}/documents`);
    expect(list.json().items).toEqual([]);
    expect(
      (await call(t.app, jar, "GET", `/v1/pageindex/documents/${documentId}`)).statusCode,
    ).toBe(404);
    expect(
      (
        await call(
          t.app,
          jar,
          "GET",
          `/v1/pageindex/documents/${documentId}/versions/${versionId}/file`,
        )
      ).statusCode,
    ).toBe(404);
    const byDoc = await call(t.app, jar, "POST", "/v1/pageindex/query", {
      query: "refunds",
      scope: { documentIds: [documentId] },
    });
    expect(byDoc.statusCode).toBe(404);
    const bySource = await call(t.app, jar, "POST", "/v1/pageindex/query", {
      query: "refunds",
      scope: { sourceIds: [sourceId] },
    });
    expect(bySource.json().retrieval).toMatchObject({ status: "empty", evidence: [] });
    const states = await t.db.admin<{ state: string }[]>`
      select distinct state from document_indexes where document_id = ${documentId}`;
    expect(states.map((s) => s.state)).toEqual(["deleted"]);
    const cleanup = await jobs(`pageindex-cleanup:${documentId}`);
    expect(cleanup[0]?.payload).toEqual({ type: "pageindex.cleanup", workspaceId, documentId });
  });

  it("deletes a source after removing its indexes upstream and its files", async () => {
    const src = await call(t.app, jar, "POST", "/v1/knowledge/sources", {
      name: "Temporary",
      kind: "pageindex",
      config: { indexModel: { provider: "ollama", model: "qwen2.5:3b" } },
    });
    const id = src.json().id as string;
    const up = (await upload(id, pdf("temporary"), { name: "tmp.pdf" })).json();
    const upstream = `pi-${"d".repeat(32)}`;
    await makeReady(workspaceId, up.index.indexId as string, upstream);
    const artifactsBefore = await t.db.admin<{ n: number }[]>`
      select count(*)::int as n from artifacts where kind = 'upload'`;

    // the service is off: access is revoked, the source stays until it can be cleaned up
    const saved = t.ctx.config.pageIndex;
    t.ctx.config.pageIndex = null;
    const refused = await call(t.app, jar, "DELETE", `/v1/knowledge/sources/${id}`);
    t.ctx.config.pageIndex = saved;
    expect(refused.statusCode).toBe(409);
    expect(stub.documents.has(upstream)).toBe(true);
    const [doc] = await t.db.admin<{ status: string }[]>`
      select status from documents where id = ${up.document.documentId as string}`;
    expect(doc?.status).toBe("deleted");

    const res = await call(t.app, jar, "DELETE", `/v1/knowledge/sources/${id}`);
    expect(res.statusCode).toBe(204);
    expect(stub.documents.has(upstream)).toBe(false);
    const artifactsAfter = await t.db.admin<{ n: number }[]>`
      select count(*)::int as n from artifacts where kind = 'upload'`;
    expect(artifactsAfter[0]?.n).toBe((artifactsBefore[0]?.n ?? 0) - 1);
    const left = await t.db.admin<{ n: number }[]>`
      select count(*)::int as n from knowledge_sources where id = ${id}`;
    expect(left[0]?.n).toBe(0);
    expect(await jobs(`pageindex-cleanup:${up.document.documentId as string}`)).toHaveLength(1);
  });
});
