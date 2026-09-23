/**
 * Test-only builders: a seeded tenant (workspace, environment, workflow, version) and coherent
 * run logs assembled from the payloads of workflow-core's event fixtures
 * (`packages/workflow-core/fixtures/events`), re-addressed to one run.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { uuidv7 } from "@flowaid/shared";
import type { DurableRunEvent, JsonObject, Run, RunEventOf } from "@flowaid/workflow-core";
import type { Database } from "../db.js";
import { environments, workflows, workflowVersions, workspaces } from "../schema.js";

const FIXTURES = fileURLToPath(new URL("../../../workflow-core/fixtures/events/", import.meta.url));

/** A fixture's payload without its address (type-specific fields only). */
export function fixture<T extends DurableRunEvent["type"]>(
  type: T,
): Omit<RunEventOf<T>, "runId" | "seq" | "at"> {
  const event = JSON.parse(readFileSync(`${FIXTURES}${type}.json`, "utf8")) as Record<
    string,
    unknown
  >;
  for (const key of ["runId", "seq", "at", "nodeRunId", "nodeId", "scope", "attempt"])
    delete event[key];
  return event as Omit<RunEventOf<T>, "runId" | "seq" | "at">;
}

export interface Tenant {
  workspaceId: string;
  environmentId: string;
  workflowId: string;
  versionId: string;
}

export async function seedTenant(
  database: Database,
  slug = `ws-${uuidv7().slice(-8)}`,
): Promise<Tenant> {
  const tenant: Tenant = {
    workspaceId: uuidv7(),
    environmentId: uuidv7(),
    workflowId: uuidv7(),
    versionId: uuidv7(),
  };
  const definition = { schemaVersion: 1, nodes: [], edges: [] } as unknown as JsonObject;
  await database.system(async (tx) => {
    await tx.insert(workspaces).values({ id: tenant.workspaceId, slug, name: slug });
    await tx
      .insert(environments)
      .values({ id: tenant.environmentId, workspaceId: tenant.workspaceId, name: "dev" });
    await tx.insert(workflows).values({
      id: tenant.workflowId,
      workspaceId: tenant.workspaceId,
      name: "Support triage",
      slug: "support-triage",
      draft: definition as never,
    });
    await tx.insert(workflowVersions).values({
      id: tenant.versionId,
      workspaceId: tenant.workspaceId,
      workflowId: tenant.workflowId,
      kind: "published",
      version: 1,
      definition: definition as never,
      definitionHash: "def-hash",
      plan: {} as never,
      planHash: "plan-hash",
      compilerVersion: "0.1.0",
      catalogSnapshot: {},
    });
  });
  return tenant;
}

export function newRun(
  tenant: Tenant,
  overrides: Partial<Run> = {},
): { run: Run; created: RunEventOf<"RUN_CREATED"> } {
  const id = uuidv7();
  const createdAt = "2026-09-23T10:00:00.000Z";
  const run: Run = {
    id,
    workspaceId: tenant.workspaceId,
    workflowId: tenant.workflowId,
    workflowVersionId: tenant.versionId,
    environmentId: tenant.environmentId,
    status: "queued",
    origin: "api",
    mode: "async",
    input: { message: "I was charged twice." },
    output: null,
    outcome: null,
    error: null,
    parentRunId: null,
    parentNodeRunId: null,
    sourceRunId: null,
    sessionId: null,
    idempotencyKey: null,
    labels: {},
    lastSeq: 1,
    usage: { inputTokens: 0, outputTokens: 0 },
    costUsd: 0,
    nodeRunCount: 0,
    createdAt,
    startedAt: null,
    endedAt: null,
    ...overrides,
  };
  const created = {
    ...fixture("RUN_CREATED"),
    type: "RUN_CREATED",
    runId: id,
    seq: 1,
    at: createdAt,
    workflowVersionId: tenant.versionId,
    environmentId: tenant.environmentId,
  } as RunEventOf<"RUN_CREATED">;
  return { run, created };
}

type Input = Omit<DurableRunEvent, "seq" | "runId" | "at">;

/** Node event addressing. */
export function node(nodeRunId: string, nodeId: string, attempt = 1, scope = "") {
  return { nodeRunId, nodeId, scope, attempt };
}

/** A clock that advances 100 ms per call from a fixed start. */
export function steppingClock(
  start = Date.parse("2026-09-23T10:00:01.000Z"),
  stepMs = 100,
): () => Date {
  let t = start;
  return () => {
    const d = new Date(t);
    t += stepMs;
    return d;
  };
}

export interface SupportLog {
  batches: Input[][];
  ids: Record<
    | "start"
    | "intent"
    | "fetch1"
    | "fetch2"
    | "draft"
    | "approve"
    | "outAuto"
    | "output"
    | "task"
    | "retryTimer"
    | "expiryTimer",
    string
  >;
}

/** The support-triage run: decision, retried fetch, generation, human approval, skip, output. */
export function supportTriageLog(): SupportLog {
  const ids = {
    start: uuidv7(),
    intent: uuidv7(),
    fetch1: uuidv7(),
    fetch2: uuidv7(),
    draft: uuidv7(),
    approve: uuidv7(),
    outAuto: uuidv7(),
    output: uuidv7(),
    task: uuidv7(),
    retryTimer: uuidv7(),
    expiryTimer: uuidv7(),
  };
  const scheduled = (n: ReturnType<typeof node>, kind: string, nodeType: string | null): Input =>
    ({
      type: "NODE_SCHEDULED",
      ...n,
      kind,
      nodeType,
      inputHash: `hash-${n.nodeId}`,
      idempotencyKey: null,
      reusedFromNodeRunId: null,
      batchId: null,
    }) as Input;
  const started = (n: ReturnType<typeof node>): Input => ({ ...fixture("NODE_STARTED"), ...n });
  const completed = (
    n: ReturnType<typeof node>,
    extra: Partial<RunEventOf<"NODE_COMPLETED">> = {},
  ): Input => ({
    type: "NODE_COMPLETED",
    ...n,
    output: { ok: true },
    firedPorts: ["done"],
    usage: null,
    costUsd: 0,
    latencyMs: 40,
    reused: false,
    ...extra,
  });
  const decision = fixture("DECISION_COMPLETED");
  const generation = fixture("GENERATION_COMPLETED");
  const human = fixture("HUMAN_APPROVAL_REQUESTED");
  const response = fixture("HUMAN_APPROVAL_RECEIVED");
  const start = node(ids.start, "start");
  const intent = node(ids.intent, "intent");
  const fetch1 = node(ids.fetch1, "fetch_account");
  const fetch2 = node(ids.fetch2, "fetch_account", 2);
  const draft = node(ids.draft, "draft");
  const approve = node(ids.approve, "approve");
  const outAuto = node(ids.outAuto, "out_auto");
  const output = node(ids.output, "out_human");
  const error = { code: "NETWORK_ERROR", message: "connect ECONNRESET", retryable: true };

  const batches: Input[][] = [
    [
      { ...fixture("RUN_STARTED"), workerId: "w1" } as Input,
      scheduled(start, "input", null),
      started(start),
      completed(start, { output: { message: "I was charged twice." } }),
    ],
    [
      scheduled(intent, "task", "flowaid.decision.choice"),
      started(intent),
      { ...fixture("DECISION_REQUESTED"), ...intent },
      { ...decision, ...intent },
      completed(intent, {
        firedPorts: ["billing"],
        usage: { inputTokens: 412, outputTokens: 0 },
        costUsd: 0.000206,
        latencyMs: 310,
      }),
    ],
    [
      scheduled(fetch1, "task", "flowaid.tools.http"),
      started(fetch1),
      {
        type: "NODE_FAILED",
        ...fetch1,
        error,
        firedPorts: [],
        latencyMs: 25,
        terminal: false,
      } as Input,
      {
        type: "NODE_RETRIED",
        ...fetch1,
        error,
        nextAttempt: 2,
        delayMs: 200,
        timerId: ids.retryTimer,
      } as Input,
      { type: "RUN_WAITING", reason: "timer", nodeRunIds: [ids.fetch1] } as Input,
    ],
    [
      { type: "TIMER_FIRED", ...fetch1, timerId: ids.retryTimer, purpose: "retry" } as Input,
      { type: "RUN_RESUMED", reason: "timer", nodeRunId: ids.fetch1 } as Input,
      scheduled(fetch2, "task", "flowaid.tools.http"),
      started(fetch2),
      completed(fetch2, { output: { plan: "gold" } }),
      scheduled(draft, "task", "flowaid.ai.generate"),
      started(draft),
      { ...generation, ...draft },
      completed(draft, { usage: generation.usage, costUsd: generation.costUsd, latencyMs: 1840 }),
    ],
    [
      scheduled(approve, "human", "flowaid.human.approval"),
      started(approve),
      { type: "NODE_WAITING", ...approve, reason: "human", ref: ids.task, state: null } as Input,
      { ...human, ...approve, humanTaskId: ids.task } as Input,
      {
        type: "TIMER_SET",
        ...approve,
        timerId: ids.expiryTimer,
        fireAt: "2026-09-24T10:00:00.000Z",
        purpose: "human_expiry",
      } as Input,
      { type: "RUN_WAITING", reason: "human", nodeRunIds: [ids.approve] } as Input,
    ],
    [
      {
        type: "HUMAN_TASK_ESCALATED",
        ...approve,
        humanTaskId: ids.task,
        to: ["user:lead"],
        reason: "timer",
      } as Input,
      { ...response, ...approve, humanTaskId: ids.task } as Input,
      { type: "RUN_RESUMED", reason: "human", nodeRunId: ids.approve } as Input,
      completed(approve, { firedPorts: ["approved"] }),
      scheduled(outAuto, "output", null),
      { type: "NODE_SKIPPED", ...outAuto, reason: "pruned" } as Input,
      scheduled(output, "output", null),
      started(output),
      completed(output),
      {
        type: "RUN_OUTPUT",
        nodeRunId: ids.output,
        nodeId: "out_human",
        output: { reply: "ok" },
        outcome: "human_approved",
        earlyExit: false,
      } as Input,
      { ...fixture("RUN_COMPLETED") },
    ],
  ];
  return { batches, ids };
}
