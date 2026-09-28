/**
 * Starting runs (API.md §4): validate the input against the plan (400, nothing created), resolve
 * the version (pinned, the environment's deployment, or the compiled draft as a deduplicated draft
 * version), check required secret bindings (422 E_SECRET_UNBOUND), apply backpressure (429),
 * honour `Idempotency-Key` (same body → the same run, different body → 409), write the run and
 * `RUN_CREATED` in one transaction, then enqueue `run.start`.
 */
import { createHash } from "node:crypto";
import Ajv2020Module from "ajv/dist/2020.js";
import { and, count, eq, inArray } from "drizzle-orm";
import {
  PgRunStore,
  activeDeployment,
  draftVersion,
  environments,
  findRunByIdempotencyKey,
  getVersion,
  listSecretBindings,
  runs,
  workspaces,
  type RunReplaySpec,
  type Tx,
  type WorkflowVersionRow,
} from "@flowaid/database";
import { stableStringify, uuidv7 } from "@flowaid/shared";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  WorkflowValidationError,
  definitionHash,
  type ExecutionPlan,
  type JsonObject,
  type JsonValue,
  type Run,
  type RunEventOf,
  type RunOrigin,
} from "@flowaid/workflow-core";
import { assertEnvironmentAllowed, type Principal } from "../auth/principal.js";
import type { ApiContext } from "../context.js";
import { catalogSnapshot, compileIn } from "./compile.js";
import { visibleWorkflow } from "./workflows.js";

const Ajv2020 = Ajv2020Module.default;
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });

export interface StartRunRequest {
  input: JsonValue;
  mode: "sync" | "async";
  environmentId?: string | undefined;
  versionId?: string | undefined;
  draft?: boolean | undefined;
  sessionId?: string | undefined;
  variables?: Record<string, JsonValue> | undefined;
  labels?: Record<string, string> | undefined;
}

export interface StartedRun {
  run: Run;
  plan: ExecutionPlan;
  /** an idempotent repeat returned the existing run */
  reused: boolean;
}

const ACTIVE: Run["status"][] = ["queued", "starting", "running", "retrying"];

async function resolveEnvironment(
  tx: Tx,
  p: Principal,
  requested: string | undefined,
): Promise<string> {
  if (p.environmentId) {
    if (requested) assertEnvironmentAllowed(p, requested);
    return p.environmentId;
  }
  if (requested) {
    const [env] = await tx
      .select()
      .from(environments)
      .where(and(eq(environments.id, requested), eq(environments.workspaceId, p.workspaceId)));
    if (!env) throw new BadRequestError("unknown environmentId");
    return env.id;
  }
  if (p.type !== "user")
    throw new BadRequestError("environmentId is required for API keys that are not pinned to one");
  const [dev] = await tx
    .select()
    .from(environments)
    .where(and(eq(environments.workspaceId, p.workspaceId), eq(environments.name, "dev")));
  if (!dev) throw new BadRequestError("no dev environment; pass environmentId");
  return dev.id;
}

async function resolveVersion(
  tx: Tx,
  p: Principal,
  workflowId: string,
  environmentId: string,
  r: StartRunRequest,
): Promise<WorkflowVersionRow> {
  if (r.versionId) {
    const v = await getVersion(tx, r.versionId);
    if (!v || v.workflowId !== workflowId)
      throw new NotFoundError(`version ${r.versionId} not found`);
    return v;
  }
  if (r.draft) {
    if (p.type !== "user") throw new ForbiddenError("only signed-in users run drafts");
    const w = await visibleWorkflow(tx, p, workflowId);
    const result = await compileIn(tx, w.draft, {
      workspaceId: p.workspaceId,
      environmentId,
      level: "draft",
    });
    if (!result.ok) throw new WorkflowValidationError(result.diagnostics);
    return draftVersion(tx, {
      workspaceId: p.workspaceId,
      workflowId,
      revision: w.draftRevision,
      definition: w.draft,
      definitionHash: definitionHash(w.draft),
      plan: result.plan,
      planHash: result.plan.planHash,
      compilerVersion: result.plan.compilerVersion,
      catalogSnapshot: catalogSnapshot(result.plan),
      diagnostics: result.diagnostics,
    });
  }
  const d = await activeDeployment(tx, workflowId, environmentId);
  if (!d)
    throw new ConflictError(
      "the workflow is not deployed to this environment; deploy a version, pass versionId, or run the draft",
    );
  const v = await getVersion(tx, d.versionId);
  if (!v) throw new NotFoundError("the deployed version is missing");
  return v;
}

/** The version a run (or an evaluation) uses: pinned, the draft (compiled), or the deployment. */
export function resolveRunVersion(
  tx: Tx,
  p: Principal,
  workflowId: string,
  environmentId: string,
  r: { versionId?: string | undefined; draft?: boolean | undefined },
): Promise<WorkflowVersionRow> {
  return resolveVersion(tx, p, workflowId, environmentId, { input: null, mode: "async", ...r });
}

export function hashRequest(workflowId: string, r: StartRunRequest): string {
  return createHash("sha256")
    .update(
      stableStringify({
        workflowId,
        input: r.input ?? null,
        environmentId: r.environmentId ?? null,
        versionId: r.versionId ?? null,
        draft: r.draft ?? false,
        variables: r.variables ?? {},
      }),
    )
    .digest("hex");
}

export async function startRun(
  ctx: ApiContext,
  p: Principal,
  workflowId: string,
  r: StartRunRequest,
  o: {
    idempotencyKey?: string | undefined;
    origin?: RunOrigin;
    sourceRunId?: string | null;
    /** recorded replay, restart-from-node or fork of `sourceRunId` (§5.9) */
    replay?: RunReplaySpec;
  } = {},
): Promise<StartedRun> {
  const hash = hashRequest(workflowId, r);
  const prepared = await ctx.db.tenant(p.workspaceId, async (tx) => {
    await visibleWorkflow(tx, p, workflowId);
    if (o.idempotencyKey) {
      const existing = await findRunByIdempotencyKey(tx, p.workspaceId, o.idempotencyKey);
      if (existing) {
        const [row] = await tx
          .select({ hash: runs.idempotencyHash })
          .from(runs)
          .where(eq(runs.id, existing.id));
        if (row?.hash && row.hash !== hash)
          throw new ConflictError("this Idempotency-Key was used with a different request");
        const v = await getVersion(tx, existing.workflowVersionId);
        return { reused: existing, plan: (v as WorkflowVersionRow).plan } as const;
      }
    }
    const environmentId = await resolveEnvironment(tx, p, r.environmentId);
    const version = await resolveVersion(tx, p, workflowId, environmentId, r);
    const validate = ajv.compile(version.plan.inputs as object);
    if (!validate(r.input))
      throw new BadRequestError("the input does not match the workflow's inputs schema", {
        issues: (validate.errors ?? []).map(
          (e: { instancePath: string; message?: string; keyword: string }) => ({
            path: e.instancePath || "/",
            message: e.message ?? e.keyword,
          }),
        ),
      });
    const bound = new Set(
      (await listSecretBindings(tx, workflowId))
        .filter((b) => b.environmentId === environmentId)
        .map((b) => b.secretName),
    );
    const missing = version.plan.secrets.filter((s) => s.required && !bound.has(s.name));
    if (missing.length > 0)
      throw new WorkflowValidationError(
        missing.map((s) => ({
          code: "E_SECRET_UNBOUND" as const,
          severity: "error" as const,
          message: `secret ${s.name} is not bound in this environment`,
          location: { path: "/secrets" },
        })),
      );
    const [ws] = await tx
      .select({ settings: workspaces.settings })
      .from(workspaces)
      .where(eq(workspaces.id, p.workspaceId));
    const maxQueued = Number((ws?.settings as JsonObject | undefined)?.maxQueuedRuns ?? 1000);
    const [{ n } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(runs)
      .where(and(eq(runs.workspaceId, p.workspaceId), inArray(runs.status, ACTIVE)));
    if (n >= maxQueued)
      throw new RateLimitError(
        `the workspace has ${n} runs in flight (limit ${maxQueued}); retry later`,
        5_000,
      );
    return { reused: null, environmentId, version } as const;
  });

  if (prepared.reused) return { run: prepared.reused, plan: prepared.plan, reused: true };
  const { environmentId, version } = prepared;
  const now = new Date(ctx.clock.now()).toISOString();
  const id = uuidv7();
  const run: Run = {
    id,
    workspaceId: p.workspaceId,
    workflowId,
    workflowVersionId: version.id,
    environmentId,
    status: "queued",
    origin: o.origin ?? "api",
    mode: r.mode,
    input: r.input,
    output: null,
    outcome: null,
    error: null,
    parentRunId: null,
    parentNodeRunId: null,
    sourceRunId: o.sourceRunId ?? null,
    sessionId: r.sessionId ?? null,
    idempotencyKey: o.idempotencyKey ?? null,
    labels: r.labels ?? {},
    lastSeq: 1,
    usage: { inputTokens: 0, outputTokens: 0 },
    costUsd: 0,
    nodeRunCount: 0,
    createdAt: now,
    startedAt: null,
    endedAt: null,
  };
  const created = {
    type: "RUN_CREATED",
    runId: id,
    seq: 1,
    at: now,
    workflowVersionId: version.id,
    environmentId,
    origin: run.origin,
    mode: run.mode,
    input: r.input,
    planHash: version.planHash,
    idempotencyKey: run.idempotencyKey,
    sourceRunId: run.sourceRunId,
  } as RunEventOf<"RUN_CREATED">;
  const store = new PgRunStore(ctx.db, { workspaceId: p.workspaceId });
  try {
    await store.createRun(run, created);
  } catch (error) {
    // Two requests with one Idempotency-Key raced: the unique index let one win.
    if (
      o.idempotencyKey &&
      /runs_idem_uq|duplicate key/.test(String((error as { cause?: unknown }).cause ?? error))
    )
      return startRun(ctx, p, workflowId, r, o);
    throw error;
  }
  await ctx.db.tenant(p.workspaceId, (tx) =>
    tx
      .update(runs)
      .set({
        idempotencyHash: o.idempotencyKey ? hash : null,
        variables: r.variables ?? {},
        ...(o.replay ? { replay: o.replay } : {}),
      })
      .where(eq(runs.id, id)),
  );
  await ctx.queue.enqueue(
    "run:general",
    { type: "run.start", runId: id },
    { jobId: `run.start:${id}` },
  );
  return { run, plan: version.plan, reused: false };
}

export type WaitOutcome =
  | { kind: "terminal"; run: Run }
  | { kind: "waiting_for_human"; run: Run; humanTaskId: string | null }
  | { kind: "timeout"; run: Run };

const TERMINAL = new Set(["RUN_COMPLETED", "RUN_FAILED", "RUN_CANCELLED", "RUN_TIMED_OUT"]);

/** Waits for a terminal event or a human wait, re-reading durable events on every notification. */
export async function waitForRun(
  ctx: ApiContext,
  workspaceId: string,
  runId: string,
  timeoutMs: number,
): Promise<WaitOutcome> {
  const store = new PgRunStore(ctx.db, { workspaceId });
  let seen = 0;
  let resolveWake: () => void = () => undefined;
  let wake = new Promise<void>((r) => (resolveWake = r));
  const stop = await ctx.hub.listen(runId, { durable: () => resolveWake() });
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      const events = await store.listEvents(runId, seen, 500);
      for (const e of events) {
        seen = e.seq;
        if (TERMINAL.has(e.type))
          return { kind: "terminal", run: (await store.getRun(runId)) as Run };
        if (e.type === "HUMAN_APPROVAL_REQUESTED") {
          return {
            kind: "waiting_for_human",
            run: (await store.getRun(runId)) as Run,
            humanTaskId: (e as { humanTaskId?: string }).humanTaskId ?? null,
          };
        }
      }
      if (events.length === 500) continue;
      const left = deadline - Date.now();
      if (left <= 0) return { kind: "timeout", run: (await store.getRun(runId)) as Run };
      // Wake on a notification, or poll every 2 s in case one was missed.
      await Promise.race([wake, new Promise((r) => setTimeout(r, Math.min(left, 2000)))]);
      wake = new Promise<void>((r) => (resolveWake = r));
    }
  } finally {
    stop();
  }
}
