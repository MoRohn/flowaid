/**
 * The PageIndex service's protocol v1 (apps/pageindex): a typed client over HTTP with a bearer
 * token. The service is private (loopback or the Compose `internal` network) and its URL is
 * operator configuration, so this client uses the platform `fetch` directly rather than the
 * workflow egress guard, which exists for user-supplied URLs.
 *
 * Every call names the workspace; the service keeps one PageIndex store per workspace.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = "1";

export const ServiceOutlineNodeSchema: z.ZodType<ServiceOutlineNode> = z.lazy(() =>
  z.object({
    nodeId: z.string(),
    title: z.string(),
    startPage: z.int().min(1),
    endPage: z.int().min(1),
    summary: z.string().optional(),
    children: z.array(ServiceOutlineNodeSchema).optional(),
  }),
);
export interface ServiceOutlineNode {
  nodeId: string;
  title: string;
  startPage: number;
  endPage: number;
  summary?: string | undefined;
  children?: ServiceOutlineNode[] | undefined;
}

export const JobStateSchema = z.enum(["queued", "running", "ready", "failed", "canceled"]);
export type JobState = z.infer<typeof JobStateSchema>;

export const JobResultSchema = z.object({
  docId: z.string().regex(/^pi-[0-9a-f]{32}$/),
  pageCount: z.int().min(1),
  description: z.string().nullable(),
  tree: z.array(ServiceOutlineNodeSchema),
  sdkVersion: z.string(),
  mode: z.enum(["flash", "standard"]),
  elapsedMs: z.int().min(0),
});
export type JobResult = z.infer<typeof JobResultSchema>;

export const JobStatusSchema = z.object({
  jobId: z.uuid(),
  workspaceId: z.uuid(),
  state: JobStateSchema,
  stage: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  result: JobResultSchema.nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const HealthSchema = z.object({
  ok: z.boolean(),
  protocol: z.string(),
  service: z.string(),
  sdk: z.string().nullable(),
});
export type Health = z.infer<typeof HealthSchema>;

/** The model that writes summaries during indexing, in LiteLLM's naming. */
export interface IndexModelSpec {
  /** e.g. "openai/gpt-5.5-mini", "anthropic/claude-haiku-4-5", "ollama/qwen2.5:3b" */
  litellm: string;
  apiBase?: string;
  /** passed for this job only; never stored or logged by the service */
  apiKey?: string;
}

export interface SubmitJobInput {
  jobId: string;
  workspaceId: string;
  fileName: string;
  contentSha256: string;
  mode: "flash" | "standard";
  optimize: "merge" | "full" | "off";
  model: IndexModelSpec;
  /** metadata stored with the upstream document (the FlowAId index id), for reconciliation */
  indexId: string;
  pdf: Uint8Array;
}

export class PageIndexServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PageIndexServiceError";
  }
  /** the service or network is temporarily unable to answer; retrying can help */
  get transient(): boolean {
    return this.status === 0 || this.status === 429 || this.status === 502 || this.status === 503;
  }
}

export interface ServiceClientOptions {
  baseUrl: string;
  token: string;
  /** injectable for tests */
  fetch?: typeof fetch;
  /** per-request timeout (default 30 s; job submission uploads a file) */
  timeoutMs?: number;
}

/** Frames a job for `POST /v1/jobs`: 4-byte big-endian length, the JSON spec, then the PDF. */
export function frameJob(input: SubmitJobInput): Uint8Array {
  const { pdf, ...spec } = input;
  const json = new TextEncoder().encode(JSON.stringify({ ...spec, protocol: PROTOCOL_VERSION }));
  const out = new Uint8Array(4 + json.length + pdf.length);
  new DataView(out.buffer).setUint32(0, json.length, false);
  out.set(json, 4);
  out.set(pdf, 4 + json.length);
  return out;
}

export class PageIndexServiceClient {
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;

  constructor(private readonly o: ServiceClientOptions) {
    this.fetchImpl = o.fetch ?? fetch;
    this.base = o.baseUrl.replace(/\/+$/, "");
  }

  private async request<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: { json?: unknown; bytes?: Uint8Array },
    signal?: AbortSignal,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(this.o.timeoutMs ?? 30_000);
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.o.token}`,
      "x-flowaid-protocol": PROTOCOL_VERSION,
    };
    let payload: RequestInit["body"] | undefined;
    if (body?.json !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body.json);
    } else if (body?.bytes) {
      headers["content-type"] = "application/vnd.flowaid.pageindex-job";
      // a copy backed by a plain ArrayBuffer (BodyInit does not take a view over a shared buffer)
      payload = body.bytes.slice();
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers,
        ...(payload !== undefined ? { body: payload } : {}),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new PageIndexServiceError(
        0,
        "UNAVAILABLE",
        `the PageIndex service at ${this.base} did not answer: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
      throw new PageIndexServiceError(
        res.status,
        err?.code ?? `HTTP_${res.status}`,
        err?.message ?? `the PageIndex service answered ${res.status}`,
      );
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success)
      throw new PageIndexServiceError(
        502,
        "BAD_RESPONSE",
        `the PageIndex service answered ${method} ${path} with an unexpected body`,
      );
    return parsed.data;
  }

  health(signal?: AbortSignal): Promise<Health> {
    return this.request("GET", "/healthz", HealthSchema, undefined, signal);
  }

  /** Starts a job (idempotent by `jobId`: the same id returns the existing job). */
  submitJob(input: SubmitJobInput, signal?: AbortSignal): Promise<JobStatus> {
    return this.request("POST", "/v1/jobs", JobStatusSchema, { bytes: frameJob(input) }, signal);
  }

  getJob(workspaceId: string, jobId: string, signal?: AbortSignal): Promise<JobStatus> {
    return this.request(
      "GET",
      `/v1/jobs/${encodeURIComponent(jobId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
      JobStatusSchema,
      undefined,
      signal,
    );
  }

  cancelJob(workspaceId: string, jobId: string, signal?: AbortSignal): Promise<JobStatus> {
    return this.request(
      "DELETE",
      `/v1/jobs/${encodeURIComponent(jobId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
      JobStatusSchema,
      undefined,
      signal,
    );
  }

  async tree(
    workspaceId: string,
    docId: string,
    signal?: AbortSignal,
  ): Promise<ServiceOutlineNode[]> {
    const out = await this.request(
      "GET",
      `${this.doc(workspaceId, docId)}/tree`,
      z.object({ tree: z.array(ServiceOutlineNodeSchema) }),
      undefined,
      signal,
    );
    return out.tree;
  }

  async pages(
    workspaceId: string,
    docId: string,
    pages: number[],
    signal?: AbortSignal,
  ): Promise<{ page: number; text: string }[]> {
    const out = await this.request(
      "POST",
      `${this.doc(workspaceId, docId)}/pages`,
      z.object({ pages: z.array(z.object({ page: z.int().min(1), text: z.string() })) }),
      { json: { pages } },
      signal,
    );
    return out.pages;
  }

  async deleteDocument(workspaceId: string, docId: string, signal?: AbortSignal): Promise<boolean> {
    const out = await this.request(
      "DELETE",
      this.doc(workspaceId, docId),
      z.object({ deleted: z.boolean() }),
      undefined,
      signal,
    );
    return out.deleted;
  }

  async listDocuments(
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<{ docId: string; indexId: string | null }[]> {
    const out = await this.request(
      "GET",
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/documents`,
      z.object({
        documents: z.array(z.object({ docId: z.string(), indexId: z.string().nullable() })),
      }),
      undefined,
      signal,
    );
    return out.documents;
  }

  private doc(workspaceId: string, docId: string): string {
    return `/v1/workspaces/${encodeURIComponent(workspaceId)}/documents/${encodeURIComponent(docId)}`;
  }
}
