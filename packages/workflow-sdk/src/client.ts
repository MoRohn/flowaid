/**
 * `Flowaid`: the SDK entry point (API.md §8).
 *
 * ```ts
 * const fa = new Flowaid({ baseUrl, apiKey });
 * const run = await fa.workflows.run(workflowId, { message: "hi" }, { environmentId });
 * for await (const ev of run.stream()) if (ev.type === "DECISION_COMPLETED") console.log(ev.decision.confidence);
 * const done = await run.wait();
 * ```
 *
 * The resource helpers cover the run loop (workflows, versions, deployments, runs, human tasks,
 * events, evaluations, export); `fa.api` reaches every other operation with generated types.
 */
import type { JsonValue } from "@flowaid/workflow-core";
import { TypedApi } from "./api.js";
import { Transport, type FlowaidOptions, type QueryValue } from "./http.js";
import { RunHandle } from "./run.js";
import type { StreamRuntime } from "./stream.js";
import {
  TERMINAL_RUN_STATUSES,
  type HumanResponse,
  type HumanTask,
  type Page,
  type Run,
  type RunAccepted,
  type RunCompleted,
  type RunRequest,
} from "./types.js";

export interface RunCallOptions extends Omit<RunRequest, "input"> {
  /** Replays of the same key and body within 24 h return the original run. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface PollOptions {
  intervalMs?: number;
  signal?: AbortSignal;
}

/** An evaluation run as `GET /v1/evaluations/runs/:id` returns it. */
export interface EvaluationRun {
  id: string;
  setId: string;
  workflowId: string;
  workflowVersionId: string | null;
  environmentId: string | null;
  status: string;
  total: number;
  completed: number;
  summary: JsonValue | null;
  report: JsonValue | null;
  gate: JsonValue | null;
  createdAt: string;
  endedAt: string | null;
}

export interface ExportPackageOptions {
  /** A published version number, or the current draft. */
  version: number | "draft";
  mode?: "npm" | "vendored";
  includeSampleFromRunId?: string;
  includeRecordedRunId?: string;
  /** Job polling (default every 1 s, up to 5 min). */
  pollMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface Job {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  artifact_id?: string;
  error?: { code: string; message: string };
}

const EVALUATION_DONE = new Set(["completed", "failed", "cancelled"]);

export class Flowaid {
  readonly transport: Transport;
  /** Every API operation, typed from the OpenAPI document. */
  readonly api: TypedApi;
  private readonly runtime: StreamRuntime | undefined;

  constructor(options: FlowaidOptions & { streamRuntime?: StreamRuntime }) {
    this.transport = new Transport(options);
    this.api = new TypedApi(this.transport);
    this.runtime = options.streamRuntime;
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (this.runtime) return this.runtime.sleep(ms, signal);
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason as Error);
      const t = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(signal.reason as Error);
        },
        { once: true },
      );
    });
  }

  /** A handle for an existing run. */
  run(runId: string): RunHandle {
    return new RunHandle(this.transport, { run_id: runId, status: "queued" }, this.runtime);
  }

  readonly workflows = {
    list: (query: { q?: string; tag?: string; limit?: number; cursor?: string } = {}) =>
      this.api.get("/v1/workflows", { query }),
    get: (id: string) => this.api.get("/v1/workflows/{id}", { path: { id } }),
    create: (body: { name: string; description?: string; tags?: string[]; definition?: unknown }) =>
      this.api.post("/v1/workflows", { body }),
    import: (body: { definition?: unknown; yaml?: string; name?: string }) =>
      this.api.post("/v1/workflows/import", { body }),
    saveDraft: (id: string, definition: unknown, ifMatch?: number) =>
      this.transport.request<{ draftRevision: number; diagnostics: unknown[] }>(
        "PUT",
        `/v1/workflows/${id}/draft`,
        {
          body: { definition },
          ...(ifMatch !== undefined ? { headers: { "if-match": String(ifMatch) } } : {}),
        },
      ),
    publish: (id: string, body: { notes?: string; label?: string; deployTo?: string[] } = {}) =>
      this.api.post("/v1/workflows/{id}/publish", { path: { id }, body }),
    versions: (id: string) => this.api.get("/v1/workflows/{id}/versions", { path: { id } }),
    deploy: (id: string, environmentId: string, versionId: string) =>
      this.api.put("/v1/workflows/{id}/deployments/{environmentId}", {
        path: { id, environmentId },
        body: { versionId },
      }),
    deployments: (id: string) => this.api.get("/v1/workflows/{id}/deployments", { path: { id } }),

    /**
     * Starts a run. `mode: 'async'` (default) answers at once; `sync` waits up to
     * `waitTimeoutMs` and may already hold the output. Either way the handle streams and waits.
     */
    run: async (id: string, input: JsonValue = {}, o: RunCallOptions = {}): Promise<RunHandle> => {
      const { idempotencyKey, signal, ...rest } = o;
      const res = await this.transport.request<RunAccepted | RunCompleted>(
        "POST",
        `/v1/workflows/${encodeURIComponent(id)}/run`,
        {
          body: { ...rest, input },
          ...(idempotencyKey ? { headers: { "idempotency-key": idempotencyKey } } : {}),
          signal,
        },
      );
      return new RunHandle(this.transport, res, this.runtime);
    },

    runs: {
      list: (workflowId: string, query: Record<string, QueryValue> = {}) =>
        this.transport.request<Page<Run>>("GET", "/v1/runs", { query: { ...query, workflowId } }),
      /**
       * Liveness of a workflow's runs: yields each run whenever its status changes (polling
       * `GET /v1/runs?workflowId=`, newest first), until aborted.
       */
      stream: (workflowId: string, o: PollOptions = {}): AsyncIterable<Run> =>
        this.pollWorkflowRuns(workflowId, o),
    },

    /**
     * Downloads the runnable code package of a version (or the draft) as zip bytes: starts the
     * export job, polls it, then fetches the artifact (CODE_EXPORT.md).
     */
    exportPackage: async (id: string, o: ExportPackageOptions): Promise<Uint8Array> => {
      const body = {
        ...(o.mode ? { mode: o.mode } : {}),
        ...(o.includeSampleFromRunId ? { includeSampleFromRunId: o.includeSampleFromRunId } : {}),
        ...(o.includeRecordedRunId ? { includeRecordedRunId: o.includeRecordedRunId } : {}),
      };
      let path: string;
      if (o.version === "draft") path = `/v1/workflows/${id}/draft/export/package`;
      else {
        const versions = await this.transport.request<{ id: string; version: number }[]>(
          "GET",
          `/v1/workflows/${id}/versions`,
        );
        const match = versions.find((v) => v.version === o.version);
        if (!match) throw new Error(`workflow ${id} has no version ${o.version}`);
        path = `/v1/workflow-versions/${match.id}/export/package`;
      }
      const { job_id } = await this.transport.request<{ job_id: string }>("POST", path, {
        body,
        signal: o.signal,
      });
      const deadline = Date.now() + (o.timeoutMs ?? 300_000);
      for (;;) {
        const job = await this.transport.request<Job>("GET", `/v1/jobs/${job_id}`, {
          signal: o.signal,
        });
        if (job.status === "completed" && job.artifact_id) {
          const res = await this.transport.raw("GET", `/v1/artifacts/${job.artifact_id}/download`, {
            signal: o.signal,
          });
          return new Uint8Array(await res.arrayBuffer());
        }
        if (job.status === "failed")
          throw new Error(`export failed: ${job.error?.message ?? "unknown error"}`);
        if (Date.now() > deadline) throw new Error(`export job ${job_id} did not finish in time`);
        await this.sleep(o.pollMs ?? 1000, o.signal);
      }
    },
  };

  readonly versions = {
    get: (id: string) => this.api.get("/v1/workflow-versions/{id}", { path: { id } }),
    run: async (
      versionId: string,
      input: JsonValue = {},
      o: RunCallOptions = {},
    ): Promise<RunHandle> => {
      const { idempotencyKey, signal, ...rest } = o;
      const res = await this.transport.request<RunAccepted | RunCompleted>(
        "POST",
        `/v1/workflow-versions/${encodeURIComponent(versionId)}/run`,
        {
          body: { ...rest, input },
          ...(idempotencyKey ? { headers: { "idempotency-key": idempotencyKey } } : {}),
          signal,
        },
      );
      return new RunHandle(this.transport, res, this.runtime);
    },
  };

  readonly runs = {
    get: (id: string) => this.run(id).get(),
    list: (query: Record<string, QueryValue> = {}) =>
      this.transport.request<Page<Run>>("GET", "/v1/runs", { query }),
    cancel: (id: string, reason?: string) => this.run(id).cancel(reason),
    stream: (id: string, o?: Parameters<RunHandle["stream"]>[0]) => this.run(id).stream(o),
    /** A new run with the same input: re-executed, or reusing unchanged recorded results. */
    replay: async (
      id: string,
      body: { mode?: "reexecute" | "recorded"; versionId?: string; environmentId?: string } = {},
    ) => this.run((await this.api.post("/v1/runs/{id}/replay", { path: { id }, body })).run_id),
    /** A new run that reuses results before `nodeId` and executes it and what follows. */
    restart: async (
      id: string,
      body: {
        nodeId: string;
        scope?: string;
        versionId?: string;
        input?: Record<string, JsonValue>;
      },
    ) => this.run((await this.api.post("/v1/runs/{id}/restart", { path: { id }, body })).run_id),
    /** A new run on another version (or the draft) with patched input or variables. */
    fork: async (
      id: string,
      body: {
        versionId?: string;
        draft?: boolean;
        nodeId?: string;
        input?: Record<string, JsonValue>;
        variables?: Record<string, JsonValue>;
      },
    ) => this.run((await this.api.post("/v1/runs/{id}/fork", { path: { id }, body })).run_id),
    /** Retries a failed node of a failed run in place; the handle follows the reopened run. */
    retryNode: async (id: string, nodeRunId: string) =>
      this.run(
        (
          await this.api.post("/v1/runs/{id}/node-runs/{nodeRunId}/retry", {
            path: { id, nodeRunId },
          })
        ).run_id,
      ),
  };

  readonly humanTasks = {
    list: (query: { status?: HumanTask["status"]; limit?: number; cursor?: string } = {}) =>
      this.transport.request<Page<HumanTask>>("GET", "/v1/human-tasks", { query }),
    get: (id: string) =>
      this.transport.request<{ task: HumanTask; run: Pick<Run, "id" | "status" | "workflowId"> }>(
        "GET",
        `/v1/human-tasks/${id}`,
      ),
    respond: (id: string, response: HumanResponse) =>
      this.api.post("/v1/human-tasks/{id}/respond", { path: { id }, body: { response } }),
  };

  readonly events = {
    /** Starts the deployed workflows with an event trigger of this name and resumes runs waiting for it. */
    emit: (
      name: string,
      payload: JsonValue = null,
      correlationKey?: string,
      environmentId?: string,
    ) =>
      this.api.post("/v1/events/{eventName}", {
        path: { eventName: name },
        body: {
          payload,
          ...(correlationKey ? { correlationKey } : {}),
          ...(environmentId ? { environmentId } : {}),
        },
      }),
  };

  readonly evaluations = {
    start: (body: {
      setId: string;
      workflowId: string;
      versionId?: string;
      draft?: boolean;
      environmentId?: string;
      concurrency?: number;
    }) => this.transport.request<EvaluationRun>("POST", "/v1/evaluations/runs", { body }),
    runs: {
      get: (id: string) =>
        this.transport.request<EvaluationRun>("GET", `/v1/evaluations/runs/${id}`),
      /** Yields the evaluation run whenever its status or progress changes, until it ends. */
      stream: (id: string, o: PollOptions = {}): AsyncIterable<EvaluationRun> =>
        this.pollEvaluation(id, o),
    },
  };

  private async *pollWorkflowRuns(workflowId: string, o: PollOptions): AsyncGenerator<Run> {
    const last = new Map<string, string>();
    while (!o.signal?.aborted) {
      const page = await this.transport.request<Page<Run>>("GET", "/v1/runs", {
        query: { workflowId, limit: 50, order: "desc" },
        signal: o.signal,
      });
      for (const run of [...page.items].reverse()) {
        if (last.get(run.id) === run.status) continue;
        last.set(run.id, run.status);
        yield run;
      }
      try {
        await this.sleep(o.intervalMs ?? 2000, o.signal);
      } catch {
        return;
      }
    }
  }

  private async *pollEvaluation(id: string, o: PollOptions): AsyncGenerator<EvaluationRun> {
    let last = "";
    while (!o.signal?.aborted) {
      const run = await this.transport.request<EvaluationRun>("GET", `/v1/evaluations/runs/${id}`, {
        signal: o.signal,
      });
      const key = `${run.status}:${run.completed}/${run.total}`;
      if (key !== last) {
        last = key;
        yield run;
      }
      if (EVALUATION_DONE.has(run.status)) return;
      try {
        await this.sleep(o.intervalMs ?? 1000, o.signal);
      } catch {
        return;
      }
    }
  }

  /** Whether `status` ends a run. */
  static isTerminal(status: string): boolean {
    return TERMINAL_RUN_STATUSES.has(status as Run["status"]);
  }
}
