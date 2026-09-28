/**
 * PageIndex in the worker (RFC-0022) against PostgreSQL and the in-memory service stub:
 * `ctx.documents` scoping and bounds, index requests, the indexing job through the real `ingest`
 * queue (publication and promotion, permanent and transient failures, cancellation, a restarted
 * service), cleanup of deleted documents, reconciliation, and resuming runs waiting on an index.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  artifacts,
  createDocumentVersion,
  createUser,
  createWorkspace,
  credentials,
  documentIndexes,
  documents,
  getDocumentIndex,
  knowledgeSources,
  queueJobs,
  requestDocumentIndex,
  requestIndexCancel,
  revokeDocumentIndexes,
  type DocumentIndexRow,
} from "@flowaid/database";
import { describeDb } from "@flowaid/database/testing";
import { PageIndexServiceClient, indexRequestFromSource } from "@flowaid/pageindex";
import { startPageIndexStub, type PageIndexStub } from "@flowaid/pageindex/testing";
import { sha256Hex, uuidv7 } from "@flowaid/shared";
import { LocalArtifactStore, artifactStorage, type ArtifactStorage } from "@flowaid/storage";
import type { DocumentIndexState, JsonObject } from "@flowaid/workflow-core";
import { reconcilePageIndex, runCleanupJob, runIndexJob } from "./jobs/pageindex.js";
import { PAGEINDEX_NOT_CONFIGURED, documentIndexAccessFor } from "./services/documents.js";
import { createHarness, type Harness } from "./test/setup.js";
import type { WorkerLogger } from "./worker.js";

const SERVER_KEY = `sk-server-${randomBytes(12).toString("hex")}`;
const CREDENTIAL_KEY = `sk-ant-cred-${randomBytes(12).toString("hex")}`;
const OLLAMA = { indexModel: { provider: "ollama", model: "qwen2.5:3b" } };

/** The service client with a hook before each poll (to act between two polls deterministically). */
class HookedClient extends PageIndexServiceClient {
  beforeGetJob: (() => Promise<void>) | null = null;
  override async getJob(workspaceId: string, jobId: string, signal?: AbortSignal) {
    const hook = this.beforeGetJob;
    this.beforeGetJob = null;
    await hook?.();
    return super.getJob(workspaceId, jobId, signal);
  }
}

describeDb("PageIndex in the worker (Postgres + service stub)", () => {
  let h: Harness;
  let stub: PageIndexStub;
  let client: PageIndexServiceClient;
  let storage: ArtifactStorage;
  let otherWs: string;
  const lines: string[] = [];
  const log: WorkerLogger = {
    info: (d, m) => lines.push(JSON.stringify({ m, ...d })),
    warn: (d, m) => lines.push(JSON.stringify({ m, ...d })),
    error: (d, m) => lines.push(JSON.stringify({ m, ...d })),
  };

  beforeAll(async () => {
    stub = await startPageIndexStub();
    client = new PageIndexServiceClient({ baseUrl: stub.url, token: stub.token });
    h = await createHarness({
      extra: () => ({
        log,
        serverKeys: { openai: SERVER_KEY },
        pageindex: { client, pollMs: 25, retryDelayMs: 25 },
      }),
    });
    storage = artifactStorage(new LocalArtifactStore(h.artifactsDir));
    otherWs = await h.db.app.system(async (tx) => {
      const owner = await createUser(tx, {
        email: `other-${uuidv7()}@example.com`,
        name: "Other",
        status: "active",
      });
      const { workspace } = await createWorkspace(tx, {
        slug: `ws-${randomBytes(3).toString("hex")}`,
        name: "Other",
        ownerUserId: owner.id,
      });
      return workspace.id;
    });
  });
  afterAll(async () => {
    await h.close();
    await stub.close();
  });

  const access = (workspaceId = h.workspaceId) =>
    documentIndexAccessFor({ db: h.db.app, queue: h.queue, client }, { workspaceId });

  async function source(config: JsonObject = OLLAMA, workspaceId = h.workspaceId) {
    const id = uuidv7();
    await h.db.app.system((tx) =>
      tx.insert(knowledgeSources).values({
        id,
        workspaceId,
        name: `pi-${id.slice(-8)}`,
        kind: "pageindex",
        config,
        pipeline: {},
      }),
    );
    return id;
  }

  /** An upload: the bytes in artifact storage, the artifact row and a document version. */
  async function upload(
    sourceId: string,
    documentId: string | null = null,
    workspaceId = h.workspaceId,
  ) {
    const bytes = new TextEncoder().encode(`%PDF-1.7 ${randomBytes(8).toString("hex")}`);
    const sha = sha256Hex(bytes);
    const docId = documentId ?? uuidv7();
    const artifactId = uuidv7();
    const key = `ws/${workspaceId}/${artifactId}`;
    await storage.primary.put(key, bytes, "application/pdf");
    const version = await h.db.app.tenant(workspaceId, async (tx) => {
      if (!documentId)
        await tx.insert(documents).values({
          id: docId,
          workspaceId,
          sourceId,
          externalId: docId,
          title: "Support policy",
          contentHash: sha,
          mimeType: "application/pdf",
          status: "indexed",
        });
      await tx.insert(artifacts).values({
        id: artifactId,
        workspaceId,
        name: "policy.pdf",
        mimeType: "application/pdf",
        bytes: bytes.length,
        sha256: sha,
        storage: storage.primary.kind,
        storageKey: key,
        kind: "upload",
      });
      const { version } = await createDocumentVersion(tx, {
        workspaceId,
        documentId: docId,
        sha256: sha,
        bytes: bytes.length,
        mediaType: "application/pdf",
        fileName: "policy.pdf",
        artifactId,
        pageCount: null,
      });
      return version;
    });
    return { documentId: docId, versionId: version.id, key, artifactId, sha };
  }

  /** An index row requested without queueing its job (a lost enqueue, or a direct run). */
  async function unqueuedIndex(sourceId: string, up: { documentId: string; versionId: string }) {
    const req = indexRequestFromSource(OLLAMA);
    const { row: created } = await h.db.app.tenant(h.workspaceId, (tx) =>
      requestDocumentIndex(tx, {
        workspaceId: h.workspaceId,
        sourceId,
        documentId: up.documentId,
        versionId: up.versionId,
        configHash: req.configHash,
        settings: { ...req.settings },
        indexModel: req.indexModel,
      }),
    );
    return created;
  }

  const row = async (indexId: string, workspaceId = h.workspaceId): Promise<DocumentIndexRow> => {
    const r = await h.db.app.tenant(workspaceId, (tx) =>
      getDocumentIndex(tx, workspaceId, indexId),
    );
    if (!r) throw new Error(`no index ${indexId}`);
    return r;
  };
  async function until<T>(what: string, probe: () => Promise<T | null | undefined | false>) {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const v = await probe();
      if (v) return v;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  const waitState = (indexId: string, states: DocumentIndexState[]) =>
    until(`index ${indexId} in ${states.join("/")}`, async () => {
      const r = await row(indexId);
      return states.includes(r.state) ? r : null;
    });
  const stubJob = (jobId: string) =>
    until(`stub job ${jobId}`, () => Promise.resolve(stub.jobs.get(jobId)));
  const rejects = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (error) {
      return error as { code?: string; message: string; details?: unknown };
    }
    throw new Error("expected a rejection");
  };

  it("builds an index end to end, dedupes requests and promotes a new version", async () => {
    const src = await source();
    const up = await upload(src);
    const first = await access().requestIndex(up.documentId);
    const again = await access().requestIndex(up.documentId);
    expect(first.created).toBe(true);
    expect(again).toMatchObject({ created: false, index: { indexId: first.index.indexId } });
    expect(first.index).toMatchObject({
      state: "queued",
      indexModel: "ollama/qwen2.5:3b",
      displayName: "Support policy",
    });
    const id = first.index.indexId;
    const rows = await h.db.app.system((tx) =>
      tx.select().from(documentIndexes).where(eq(documentIndexes.documentId, up.documentId)),
    );
    expect(rows).toHaveLength(1);
    const jobs = await h.db.app.system((tx) =>
      tx
        .select()
        .from(queueJobs)
        .where(eq(queueJobs.id, `pageindex:${id}`)),
    );
    expect(jobs).toHaveLength(1);

    const r = await row(id);
    const job = await stubJob(r.jobId);
    expect(job.spec).toMatchObject({
      workspaceId: h.workspaceId,
      indexId: id,
      contentSha256: up.sha,
      mode: "flash",
      optimize: "off",
      model: { litellm: "ollama/qwen2.5:3b" },
    });
    await waitState(id, ["running"]);
    expect(await rejects(access().outline(id))).toMatchObject({
      code: "CONFLICT",
      details: { code: "INDEX_NOT_READY" },
    });

    stub.finish(r.jobId);
    const ready = await waitState(id, ["ready"]);
    expect(ready).toMatchObject({ active: true, pageCount: 3, backendVersion: "pageindex 0.2.20" });
    const outline = await access().outline(id);
    expect(outline.map((n) => n.title)).toEqual(["Refunds", "Data requests"]);
    expect(await access().readPages(id, [1, 3])).toEqual([
      { page: 1, text: expect.stringContaining("Refunds") as string },
      { page: 3, text: expect.stringContaining("Export") as string },
    ]);
    expect(
      (await access().resolve({ documentIds: [up.documentId] })).map((i) => i.indexId),
    ).toEqual([id]);
    expect((await access().resolve({ sourceIds: [src] }))[0]).toMatchObject({
      indexId: id,
      state: "ready",
      capabilities: { pageLocators: "physical", ocr: false },
    });

    // a new version builds a new index; promotion supersedes the old one, which stays pinnable
    await upload(src, up.documentId);
    const second = await access().requestIndex(up.documentId);
    expect(second).toMatchObject({ created: true, index: { indexVersion: 2, documentVersion: 2 } });
    const id2 = second.index.indexId;
    stub.finish((await stubJob((await row(id2)).jobId)).jobId);
    await waitState(id2, ["ready"]);
    expect(await row(id)).toMatchObject({ state: "superseded", active: false });
    expect(
      (await access().resolve({ documentIds: [up.documentId] })).map((i) => i.indexId),
    ).toEqual([id2]);
    const pinned = await access().resolve({ indexIds: [id] });
    expect(pinned.map((i) => [i.indexId, i.state])).toEqual([[id, "superseded"]]);
    expect(await access().outline(id)).toHaveLength(2);
    expect(await access().readPages(id, [2])).toHaveLength(1);
  });

  it("checks page bounds before calling the service", async () => {
    const src = await source();
    const up = await upload(src);
    const { index } = await access().requestIndex(up.documentId);
    stub.finish((await stubJob((await row(index.indexId)).jobId)).jobId);
    await waitState(index.indexId, ["ready"]);
    const before = stub.requests.length;
    for (const pages of [[0], [4], [1.5], Array.from({ length: 21 }, () => 1)])
      expect(await rejects(access().readPages(index.indexId, pages))).toMatchObject({
        code: "BAD_REQUEST",
      });
    expect(stub.requests.length).toBe(before);
    expect(await access().readPages(index.indexId, [])).toEqual([]);
  });

  it("scopes every id to the workspace and hides deleted documents", async () => {
    const src = await source();
    const up = await upload(src);
    const { index } = await access().requestIndex(up.documentId);
    const id = index.indexId;
    stub.finish((await stubJob((await row(id)).jobId)).jobId);
    await waitState(id, ["ready"]);

    const other = access(otherWs);
    for (const call of [
      () => other.getIndex(id),
      () => other.outline(id),
      () => other.readPages(id, [1]),
      () => other.requestIndex(up.documentId),
    ])
      expect(await rejects(call())).toMatchObject({ code: "NOT_FOUND" });
    expect(await other.resolve({ documentIds: [up.documentId], indexIds: [id] })).toEqual([]);

    // a source that is not a PageIndex source cannot be indexed
    const files = uuidv7();
    await h.db.app.system((tx) =>
      tx.insert(knowledgeSources).values({
        id: files,
        workspaceId: h.workspaceId,
        name: `files-${files.slice(-8)}`,
        kind: "files",
        config: {},
        pipeline: {},
      }),
    );
    const plain = await upload(files);
    expect(await rejects(access().requestIndex(plain.documentId))).toMatchObject({
      code: "NOT_FOUND",
    });

    await h.db.app.tenant(h.workspaceId, async (tx) => {
      await tx.update(documents).set({ status: "deleted" }).where(eq(documents.id, up.documentId));
      await revokeDocumentIndexes(tx, h.workspaceId, up.documentId);
    });
    expect(await access().resolve({ documentIds: [up.documentId], indexIds: [id] })).toEqual([]);
    expect(await rejects(access().getIndex(id))).toMatchObject({ code: "NOT_FOUND" });
    expect(await rejects(access().requestIndex(up.documentId))).toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("refuses every call with a clear BAD_REQUEST when PageIndex is not configured", async () => {
    const none = documentIndexAccessFor(
      { db: h.db.app, queue: h.queue, client: null },
      { workspaceId: h.workspaceId },
    );
    expect(await rejects(none.resolve({ sourceIds: [uuidv7()] }))).toMatchObject({
      code: "BAD_REQUEST",
      message: PAGEINDEX_NOT_CONFIGURED,
    });
    expect(await rejects(none.requestIndex(uuidv7()))).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("fails permanently with the service's error, without retrying", async () => {
    const up = await upload(await source());
    const { index } = await access().requestIndex(up.documentId);
    const r = await row(index.indexId);
    await stubJob(r.jobId);
    stub.finish(r.jobId, { kind: "failed", code: "SCANNED_PDF", message: "no text layer" });
    const failed = await waitState(index.indexId, ["failed"]);
    expect(failed).toMatchObject({
      error: { code: "SCANNED_PDF", message: "no text layer" },
      attempts: 1,
    });
    await new Promise((res) => setTimeout(res, 150));
    expect((await row(index.indexId)).attempts).toBe(1);
  });

  it("retries while the service is unavailable, then succeeds", async () => {
    const up = await upload(await source());
    stub.failNext(503, 2);
    const { index } = await access().requestIndex(up.documentId);
    const r = await row(index.indexId);
    await stubJob(r.jobId);
    expect((await row(index.indexId)).attempts).toBe(3);
    stub.finish(r.jobId);
    await waitState(index.indexId, ["ready"]);
  });

  it("gives up after five unavailable attempts with PAGEINDEX_UNAVAILABLE", async () => {
    const up = await upload(await source());
    stub.failNext(503, 5);
    const { index } = await access().requestIndex(up.documentId);
    const failed = await waitState(index.indexId, ["failed"]);
    expect(failed).toMatchObject({ attempts: 5, error: { code: "PAGEINDEX_UNAVAILABLE" } });
    expect(stub.jobs.has(failed.jobId)).toBe(false);
  });

  it("cancels a running build without publishing it", async () => {
    const up = await upload(await source());
    const { index } = await access().requestIndex(up.documentId);
    const r = await row(index.indexId);
    await stubJob(r.jobId);
    await waitState(index.indexId, ["running"]);
    await h.db.app.tenant(h.workspaceId, (tx) =>
      requestIndexCancel(tx, h.workspaceId, index.indexId),
    );
    const canceled = await waitState(index.indexId, ["canceled"]);
    expect(canceled).toMatchObject({ active: false, upstreamDocId: null });
    expect(stub.jobs.get(r.jobId)?.state).toBe("canceled");
    expect([...stub.documents.values()].some((d) => d.indexId === index.indexId)).toBe(false);
  });

  it("removes the upstream document of a build cancelled just as it finished", async () => {
    // a row with no queue job, run directly with a hook between two polls
    const src = await source();
    const up = await upload(src);
    const hooked = new HookedClient({ baseUrl: stub.url, token: stub.token });
    const created = await unqueuedIndex(src, up);
    hooked.beforeGetJob = async () => {
      stub.finish(created.jobId);
      await h.db.app.tenant(h.workspaceId, (tx) =>
        requestIndexCancel(tx, h.workspaceId, created.id),
      );
    };
    const outcome = await runIndexJob(
      {
        db: h.db.app,
        queue: h.queue,
        client: hooked,
        credentials: h.credentials,
        storage,
        serverKeys: {},
        log,
        pollMs: 10,
      },
      { workspaceId: h.workspaceId, indexId: created.id },
    );
    expect(outcome).toBe("discarded");
    expect(await row(created.id)).toMatchObject({ state: "canceled", upstreamDocId: null });
    expect([...stub.documents.values()].some((d) => d.indexId === created.id)).toBe(false);
  });

  it("resubmits a job the service forgot when it restarted", async () => {
    const up = await upload(await source());
    const { index } = await access().requestIndex(up.documentId);
    const r = await row(index.indexId);
    await stubJob(r.jobId);
    stub.restart();
    expect(stub.jobs.size).toBe(0);
    await stubJob(r.jobId);
    stub.finish(r.jobId);
    await waitState(index.indexId, ["ready"]);
    expect(lines.some((l) => l.includes("resubmitting") && l.includes(index.indexId))).toBe(true);
  });

  it("cleans up a deleted document: upstream documents, stored bytes and rows", async () => {
    const src = await source();
    const up = await upload(src);
    const { index } = await access().requestIndex(up.documentId);
    const r = await row(index.indexId);
    stub.finish((await stubJob(r.jobId)).jobId);
    const ready = await waitState(index.indexId, ["ready"]);
    const docId = ready.upstreamDocId as string;
    expect(stub.documents.has(docId)).toBe(true);

    await h.db.app.tenant(h.workspaceId, async (tx) => {
      await tx.update(documents).set({ status: "deleted" }).where(eq(documents.id, up.documentId));
      await revokeDocumentIndexes(tx, h.workspaceId, up.documentId);
    });
    // a lost enqueue is picked up by reconciliation
    const rec = await reconcilePageIndex({ db: h.db.app, queue: h.queue });
    expect(rec.cleanups).toBeGreaterThanOrEqual(1);
    await until("the document row to go", async () => {
      const [d] = await h.db.app.system((tx) =>
        tx.select().from(documents).where(eq(documents.id, up.documentId)),
      );
      return !d;
    });
    expect(stub.documents.has(docId)).toBe(false);
    expect(await rejects(storage.primary.get(up.key))).toMatchObject({ code: "NOT_FOUND" });
    const left = await h.db.app.system((tx) =>
      tx.select().from(artifacts).where(eq(artifacts.id, up.artifactId)),
    );
    expect(left).toEqual([]);
    // a re-delivery finds nothing to do
    expect(
      await runCleanupJob(
        {
          db: h.db.app,
          queue: h.queue,
          client,
          credentials: h.credentials,
          storage,
          serverKeys: {},
          log,
        },
        { workspaceId: h.workspaceId, documentId: up.documentId },
      ),
    ).toBe("skipped");
  });

  it("re-queues builds that lost their job", async () => {
    const src = await source();
    const up = await upload(src);
    const created = await unqueuedIndex(src, up);
    const rec = await reconcilePageIndex({ db: h.db.app, queue: h.queue });
    expect(rec.indexes).toBeGreaterThanOrEqual(1);
    // running again finds the pending job and queues nothing new for this build
    await reconcilePageIndex({ db: h.db.app, queue: h.queue });
    const jobs = await h.db.app.system((tx) =>
      tx
        .select()
        .from(queueJobs)
        .where(eq(queueJobs.id, `pageindex:${created.id}`)),
    );
    expect(jobs).toHaveLength(1);
    stub.finish((await stubJob(created.jobId)).jobId);
    await waitState(created.id, ["ready"]);
  });

  it("resumes a run waiting for the index", async () => {
    const up = await upload(await source());
    const { index } = await access().requestIndex(up.documentId);
    const eventName = `pageindex.index.${index.indexId}`;
    const { workflowId, versionId } = await h.deploy("Wait for index", {
      inputs: { type: "object", properties: {} },
      outputs: {},
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        {
          id: "wait",
          kind: "wait",
          name: "Indexed",
          until: { type: "event", eventName, timeoutMs: 600_000 },
        },
        {
          id: "done",
          kind: "output",
          name: "Done",
          value: { kind: "ref", ref: { kind: "port", node: "wait", port: "payload" } },
        },
      ],
      edges: [
        { id: "e1", from: { node: "start", port: "done" }, to: { node: "wait" } },
        { id: "e2", from: { node: "wait", port: "done" }, to: { node: "done" } },
      ],
    });
    const runId = await h.start(workflowId, versionId, {});
    await h.waitFor(runId, ["waiting"]);
    stub.finish((await stubJob((await row(index.indexId)).jobId)).jobId);
    const run = await h.waitFor(runId, ["completed"]);
    expect(run.output).toEqual({ indexId: index.indexId, state: "ready" });
  });

  it("sends the model key with the job only, and never logs it", async () => {
    // the server's OpenAI key
    const openai = await source({ indexModel: { provider: "openai", model: "gpt-5.5-mini" } });
    const a = await upload(openai);
    const ia = await access().requestIndex(a.documentId);
    const ja = await stubJob((await row(ia.index.indexId)).jobId);
    expect(ja.spec.model).toEqual({ litellm: "openai/gpt-5.5-mini", apiKey: SERVER_KEY });
    stub.finish(ja.jobId);
    await waitState(ia.index.indexId, ["ready"]);

    // a workspace credential named by the source
    const credentialId = uuidv7();
    const sealed = await h.credentials.seal(credentialId, "anthropic.api_key", {
      apiKey: CREDENTIAL_KEY,
    });
    await h.db.app.tenant(h.workspaceId, (tx) =>
      tx.insert(credentials).values({
        id: credentialId,
        workspaceId: h.workspaceId,
        name: `anthropic-${credentialId.slice(-6)}`,
        type: "anthropic.api_key",
        ciphertext: sealed.ciphertext,
        wrappedDataKey: sealed.wrappedDataKey,
        keyVersion: sealed.keyVersion,
        publicFields: sealed.publicFields,
      }),
    );
    const anthropic = await source({
      indexModel: { provider: "anthropic", model: "claude-haiku-4-5" },
      credentialId,
    });
    const b = await upload(anthropic);
    const ib = await access().requestIndex(b.documentId);
    const jb = await stubJob((await row(ib.index.indexId)).jobId);
    expect(jb.spec.model).toEqual({
      litellm: "anthropic/claude-haiku-4-5",
      apiKey: CREDENTIAL_KEY,
    });
    stub.finish(jb.jobId, { kind: "failed", code: "UNSUPPORTED", message: "encrypted PDF" });
    await waitState(ib.index.indexId, ["failed"]);

    // no key for Anthropic without a credential: a clear, permanent failure
    const bare = await source({ indexModel: { provider: "anthropic", model: "claude-haiku-4-5" } });
    const c = await upload(bare);
    const ic = await access().requestIndex(c.documentId);
    expect(await waitState(ic.index.indexId, ["failed"])).toMatchObject({
      error: { code: "MODEL_CREDENTIAL_MISSING" },
    });

    const all = lines.join("\n");
    expect(all).not.toContain(SERVER_KEY);
    expect(all).not.toContain(CREDENTIAL_KEY);
    expect(lines.length).toBeGreaterThan(0);
    // the key never reached the database either
    const stored = await h.db.app.system((tx) =>
      tx
        .select({ settings: documentIndexes.settings, error: documentIndexes.error })
        .from(documentIndexes)
        .where(and(eq(documentIndexes.workspaceId, h.workspaceId))),
    );
    expect(JSON.stringify(stored)).not.toContain(SERVER_KEY);
  });

  it("ignores a re-delivered job of a finished build", async () => {
    const up = await upload(await source());
    const { index } = await access().requestIndex(up.documentId);
    stub.finish((await stubJob((await row(index.indexId)).jobId)).jobId);
    await waitState(index.indexId, ["ready"]);
    const before = stub.requests.length;
    const outcome = await runIndexJob(
      {
        db: h.db.app,
        queue: h.queue,
        client,
        credentials: h.credentials,
        storage,
        serverKeys: {},
        log,
      },
      { workspaceId: h.workspaceId, indexId: index.indexId },
    );
    expect(outcome).toBe("skipped");
    expect(stub.requests.length).toBe(before);
  });
});
