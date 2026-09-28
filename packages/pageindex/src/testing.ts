/**
 * `@flowaid/pageindex/testing`: an in-memory PageIndex service speaking protocol v1, for tests of
 * the worker and the API (the real service is tested in apps/pageindex and by the live smoke
 * test). It keeps per-workspace documents, runs jobs when told to, and records every request,
 * so tests can assert on what crossed the wire (and that credentials only ever did per job).
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { JobStatus, ServiceOutlineNode } from "./protocol.js";

export interface StubDocument {
  docId: string;
  workspaceId: string;
  indexId: string | null;
  pageCount: number;
  tree: ServiceOutlineNode[];
  pages: string[];
}

export interface StubJob extends JobStatus {
  spec: Record<string, unknown>;
  pdfBytes: number;
}

/** How a job ends when `finish` runs it: a document built from the PDF, or an error. */
export type StubOutcome =
  | { kind: "ready"; tree?: ServiceOutlineNode[]; pages?: string[] }
  | { kind: "failed"; code: string; message: string };

export interface PageIndexStub {
  url: string;
  token: string;
  jobs: Map<string, StubJob>;
  documents: Map<string, StubDocument>;
  requests: { method: string; path: string; authorized: boolean }[];
  /** completes a job (default: a two-section tree over three pages) */
  finish(jobId: string, outcome?: StubOutcome): void;
  /** the next submissions fail with this HTTP status (e.g. 429, 503) */
  failNext(status: number, times?: number): void;
  /** forgets all jobs, as a restarted service would */
  restart(): void;
  close(): Promise<void>;
}

const DEFAULT_TREE: ServiceOutlineNode[] = [
  { nodeId: "0000", title: "Refunds", startPage: 1, endPage: 1, summary: "who approves refunds" },
  {
    nodeId: "0001",
    title: "Data requests",
    startPage: 2,
    endPage: 3,
    summary: "export and deletion",
  },
];
const DEFAULT_PAGES = [
  "Refunds above $200 and up to $1,000 need approval from a team lead.",
  "Deletion requests are completed within 30 days.",
  "Export requests are answered within 1 business day.",
];

const read = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

export async function startPageIndexStub(token = "s".repeat(40)): Promise<PageIndexStub> {
  const jobs = new Map<string, StubJob>();
  const documents = new Map<string, StubDocument>();
  const requests: PageIndexStub["requests"] = [];
  let failures: { status: number; left: number } | null = null;
  let seq = 0;

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://stub");
      const authorized = req.headers.authorization === `Bearer ${token}`;
      requests.push({ method: req.method ?? "GET", path: url.pathname, authorized });
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const error = (status: number, code: string, message: string) =>
        send(status, { error: { code, message } });
      if (url.pathname === "/healthz")
        return send(200, { ok: true, protocol: "1", service: "stub", sdk: "0.2.20" });
      if (!authorized) return error(401, "UNAUTHORIZED", "bad token");
      const ws = url.searchParams.get("workspaceId");
      const parts = url.pathname.split("/").filter(Boolean);

      if (req.method === "POST" && url.pathname === "/v1/jobs") {
        if (failures && failures.left > 0) {
          failures.left--;
          return error(failures.status, "BUSY", "stub failure");
        }
        const body = await read(req);
        const len = body.readUInt32BE(0);
        const spec = JSON.parse(body.subarray(4, 4 + len).toString("utf8")) as Record<
          string,
          unknown
        >;
        const jobId = String(spec.jobId);
        const existing = jobs.get(jobId);
        if (existing) {
          if (existing.spec.contentSha256 !== spec.contentSha256)
            return error(409, "CONFLICT", "a job with this id has different content");
          return send(200, strip(existing));
        }
        const job: StubJob = {
          jobId,
          workspaceId: String(spec.workspaceId),
          state: "running",
          stage: "indexing",
          createdAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          endedAt: null,
          result: null,
          error: null,
          spec,
          pdfBytes: body.length - 4 - len,
        };
        jobs.set(jobId, job);
        return send(202, strip(job));
      }
      if (parts[0] === "v1" && parts[1] === "jobs" && parts[2]) {
        const job = jobs.get(parts[2]);
        if (!job || job.workspaceId !== ws) return error(404, "NOT_FOUND", "no such job");
        if (req.method === "DELETE" && (job.state === "running" || job.state === "queued")) {
          job.state = "canceled";
          job.stage = null;
          job.endedAt = new Date().toISOString();
        }
        return send(200, strip(job));
      }
      if (parts[0] === "v1" && parts[1] === "workspaces" && parts[2]) {
        const workspaceId = parts[2];
        if (parts[3] === "documents" && !parts[4] && req.method === "GET")
          return send(200, {
            documents: [...documents.values()]
              .filter((d) => d.workspaceId === workspaceId)
              .map((d) => ({ docId: d.docId, indexId: d.indexId })),
          });
        const doc = parts[4] ? documents.get(parts[4]) : undefined;
        if (!doc || doc.workspaceId !== workspaceId)
          return error(404, "NOT_FOUND", "no such document");
        if (req.method === "DELETE") {
          documents.delete(doc.docId);
          return send(200, { deleted: true });
        }
        if (parts[5] === "tree") return send(200, { tree: doc.tree });
        if (parts[5] === "pages" && req.method === "POST") {
          const { pages } = JSON.parse((await read(req)).toString("utf8")) as { pages: number[] };
          const bad = pages.filter((p) => p < 1 || p > doc.pageCount);
          if (bad.length)
            return error(400, "BAD_REQUEST", `pages ${bad.join(",")} are out of range`);
          return send(200, {
            pages: pages.map((page) => ({ page, text: doc.pages[page - 1] ?? "" })),
          });
        }
      }
      return error(404, "NOT_FOUND", "no such route");
    })().catch((e: unknown) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "INTERNAL", message: String(e) } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    token,
    jobs,
    documents,
    requests,
    finish(jobId, outcome = { kind: "ready" }) {
      const job = jobs.get(jobId);
      if (!job) throw new Error(`no stub job ${jobId}`);
      job.endedAt = new Date().toISOString();
      job.stage = null;
      if (outcome.kind === "failed") {
        job.state = "failed";
        job.error = { code: outcome.code, message: outcome.message };
        return;
      }
      const pages = outcome.pages ?? DEFAULT_PAGES;
      const docId = `pi-${(++seq).toString(16).padStart(32, "0")}`;
      documents.set(docId, {
        docId,
        workspaceId: job.workspaceId,
        indexId: typeof job.spec.indexId === "string" ? job.spec.indexId : null,
        pageCount: pages.length,
        tree: outcome.tree ?? DEFAULT_TREE,
        pages,
      });
      job.state = "ready";
      job.result = {
        docId,
        pageCount: pages.length,
        description: "A stub document",
        tree: outcome.tree ?? DEFAULT_TREE,
        sdkVersion: "0.2.20",
        mode: job.spec.mode === "standard" ? "standard" : "flash",
        elapsedMs: 5,
      };
    },
    failNext(status, times = 1) {
      failures = { status, left: times };
    },
    restart() {
      jobs.clear();
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function strip(job: StubJob): JobStatus {
  const { spec: _spec, pdfBytes: _bytes, ...status } = job;
  return status;
}
