import { describe, expect, it } from "vitest";
import type { NodeManifest, NodeRun, WorkflowDefinition } from "@flowaid/workflow-core";
import type { HumanTask, Run } from "~/api/types";
import { serverRunQuery } from "./RunsList";
import { nodeCostRows } from "./CostPanel";
import {
  durableEvents,
  isActiveRun,
  lastDurableSeq,
  mergeEvents,
  taskToApproval,
  toLiveRunView,
  toRunRow,
} from "./views";

const RUN = "0192f0a1-5b3c-7d4e-8f60-1a2b3c4d5e6f";
const NR = "0192f0a1-5b3c-7d4e-8f60-0000000000a5";
const at = (s: number) => `2026-09-22T10:00:0${s}.000Z`;

const run: Run = {
  id: RUN,
  workspaceId: "0192f0a1-0000-7000-8000-000000000001",
  workflowId: "0192f0a1-0000-7000-8000-000000000002",
  workflowVersionId: "0192f0a1-0000-7000-8000-000000000003",
  environmentId: "0192f0a1-0000-7000-8000-000000000004",
  status: "running",
  origin: "api",
  mode: "async",
  input: { message: "hi" },
  output: null,
  outcome: null,
  error: null,
  parentRunId: null,
  sourceRunId: null,
  sessionId: null,
  labels: {},
  lastSeq: 1,
  usage: null,
  costUsd: 0,
  nodeRunCount: 0,
  createdAt: at(0),
  startedAt: at(0),
  endedAt: null,
};

const definition = {
  $schema: "https://flowaid.dev/schemas/workflow/v1",
  id: run.workflowId,
  name: "Reply",
  description: "",
  inputs: { type: "object" },
  outputs: { type: "object" },
  nodes: [
    { id: "start", name: "Start", kind: "input", disabled: false },
    {
      id: "draft",
      name: "Draft reply",
      kind: "task",
      type: "flowaid.ai.generate",
      typeVersion: "1.0.0",
      config: {},
      inputs: {},
      disabled: false,
    },
  ],
  edges: [],
  variables: [],
  secrets: [],
  triggers: [],
  execution: {},
  metadata: {},
} as unknown as WorkflowDefinition;

const catalog = new Map([
  [
    "flowaid.ai.generate",
    { id: "flowaid.ai.generate", metadata: { category: "generation" } } as unknown as NodeManifest,
  ],
]);

const events = [
  {
    type: "RUN_STARTED",
    runId: RUN,
    seq: 1,
    at: at(0),
    workerId: "w",
    leaseUntil: at(9),
    deadlineAt: at(9),
  },
  {
    type: "NODE_SCHEDULED",
    runId: RUN,
    seq: 2,
    at: at(1),
    nodeRunId: NR,
    nodeId: "draft",
    scope: "",
    attempt: 1,
    kind: "task",
    nodeType: "flowaid.ai.generate",
    inputHash: "h",
    idempotencyKey: null,
    reusedFromNodeRunId: null,
    batchId: null,
  },
  {
    type: "NODE_STARTED",
    runId: RUN,
    seq: 3,
    at: at(1),
    nodeRunId: NR,
    nodeId: "draft",
    scope: "",
    attempt: 1,
    input: { prompt: "p" },
    pool: "general",
    workerId: "w",
  },
];
const delta = (text: string) => ({
  type: "GENERATION_DELTA",
  runId: RUN,
  seq: 3,
  at: at(2),
  nodeRunId: NR,
  nodeId: "draft",
  scope: "",
  attempt: 1,
  ephemeral: true,
  channel: "text",
  delta: text,
  index: 0,
});

describe("event merging", () => {
  it("dedupes durable events by seq and appends ephemeral deltas", () => {
    const merged = mergeEvents(events, [events[2], delta("Hi "), delta("there")]);
    expect(merged).toHaveLength(5);
    expect(lastDurableSeq(merged)).toBe(3);
    expect(durableEvents(merged)).toHaveLength(3);
  });
});

describe("toLiveRunView", () => {
  it("folds streamed events over the stored run: statuses, names, categories and text", () => {
    const { view, folded } = toLiveRunView({
      run,
      nodeRuns: [],
      events: mergeEvents(events, [delta("Hi "), delta("there")]),
      definition,
      catalog,
      workflowName: "Reply",
      version: 3,
    });
    expect(view.status).toBe("running");
    expect(view.nodeRuns).toHaveLength(1);
    expect(view.nodeRuns[0]).toMatchObject({
      nodeName: "Draft reply",
      category: "generation",
      status: "running",
    });
    expect(folded.streams[NR]).toBe("Hi there");
  });

  it("completes when RUN_COMPLETED arrives and keeps stored node outputs events lack", () => {
    const stored = {
      id: NR,
      runId: RUN,
      nodeId: "draft",
      scope: "",
      attempt: 1,
      status: "running",
      kind: "task",
      nodeType: "flowaid.ai.generate",
      nodeName: "draft",
      input: { stored: true },
      output: { stored: true },
      firedPorts: [],
      decision: null,
      error: null,
      usage: null,
      costUsd: 0,
      latencyMs: null,
      queueLatencyMs: null,
      idempotencyKey: null,
      inputHash: null,
      reusedFromNodeRunId: null,
      pool: "general",
      scheduledSeq: 2,
      endedSeq: null,
      startedAt: at(1),
      endedAt: null,
    } as NodeRun;
    const done = {
      type: "RUN_COMPLETED",
      runId: RUN,
      seq: 9,
      at: at(5),
      output: { reply: "ok" },
      outcome: null,
      usage: { inputTokens: 10, outputTokens: 5 },
      costUsd: 0.002,
      durationMs: 5000,
    };
    const { view } = toLiveRunView({
      run,
      nodeRuns: [stored],
      events: [...events, done],
      definition,
      catalog,
      workflowName: "Reply",
      version: "draft",
    });
    expect(view).toMatchObject({ status: "completed", output: { reply: "ok" }, costUsd: 0.002 });
    expect(view.nodeRuns[0]?.input).toEqual({ prompt: "p" });
    expect(view.nodeRuns[0]?.output).toEqual({ stored: true });
    expect(isActiveRun(view.status)).toBe(false);
  });
});

describe("toLiveRunView after a retry-node", () => {
  const nodeEvent = (
    seq: number,
    type: string,
    nodeRunId: string,
    attempt: number,
    extra = {},
  ) => ({
    type,
    runId: RUN,
    seq,
    at: at(Math.min(seq, 9)),
    nodeRunId,
    nodeId: "draft",
    scope: "",
    attempt,
    ...extra,
  });
  const error = { code: "NETWORK_ERROR", message: "down", retryable: true };
  const failed = {
    type: "RUN_FAILED",
    runId: RUN,
    seq: 5,
    at: at(4),
    error,
    usage: { inputTokens: 0, outputTokens: 0 },
    costUsd: 0,
    durationMs: 4000,
  };
  const failedLog = [
    ...events,
    nodeEvent(4, "NODE_FAILED", NR, 1, { error, firedPorts: [], latencyMs: 10, terminal: true }),
    failed,
  ];
  const view = (r: Partial<Run>, evs: unknown[]) =>
    toLiveRunView({
      run: { ...run, ...r },
      nodeRuns: [],
      events: evs,
      definition,
      catalog,
      workflowName: "Reply",
      version: 3,
    }).view;

  it("still reads failed when the run failed after the stored row was read", () => {
    expect(view({ status: "running", lastSeq: 3 }, failedLog)).toMatchObject({
      status: "failed",
      error,
    });
  });

  it("reads the stored status once the retry is accepted, before any new event", () => {
    const v = view({ status: "retrying", lastSeq: 5 }, failedLog);
    expect(v.status).toBe("retrying");
    expect(v.error).toBeUndefined();
    expect(v.durationMs).toBeUndefined();
  });

  it("runs again once the retry's events arrive, and the replaced attempt reads failed", () => {
    const NR2 = "0192f0a1-5b3c-7d4e-8f60-0000000000b6";
    const v = view({ status: "failed", lastSeq: 5, error }, [
      ...failedLog,
      nodeEvent(6, "NODE_RETRIED", NR, 1, { error, nextAttempt: 2, delayMs: 0, timerId: "t" }),
      nodeEvent(7, "NODE_SCHEDULED", NR2, 2, {
        kind: "task",
        nodeType: "flowaid.ai.generate",
        inputHash: "h",
        idempotencyKey: null,
        reusedFromNodeRunId: null,
        batchId: null,
      }),
      nodeEvent(8, "NODE_STARTED", NR2, 2, { input: {}, pool: "general", workerId: "w" }),
    ]);
    expect(v.status).toBe("running");
    expect(v.error).toBeUndefined();
    expect(isActiveRun(v.status)).toBe(true);
    expect(v.nodeRuns.map((n) => [n.attempt, n.status])).toEqual([
      [1, "failed"],
      [2, "running"],
    ]);
  });
});

describe("list rows", () => {
  it("joins workflow names, version numbers and environments", () => {
    const row = toRunRow(run, {
      workflowNames: new Map([[run.workflowId, "Reply"]]),
      versions: new Map([[run.workflowVersionId, 4]]),
      environments: [{ id: run.environmentId, name: "prod", protected: true }],
    });
    expect(row).toMatchObject({
      workflowName: "Reply",
      version: 4,
      environment: { name: "prod", protected: true },
    });
    expect(
      toRunRow(run, { workflowNames: new Map(), versions: new Map(), environments: [] }),
    ).toMatchObject({ version: "draft", workflowName: "Untitled workflow" });
  });

  it("sends the filters the API supports and leaves the rest to the client", () => {
    expect(
      serverRunQuery({ status: ["running", "failed"], origin: ["api"], environment: ["a", "b"] }),
    ).toEqual({
      workflowId: undefined,
      environmentId: undefined,
      status: "running,failed",
      origin: "api",
    });
    expect(serverRunQuery({ workflow: ["w1"] }, "fixed").workflowId).toBe("fixed");
  });

  it("orders node costs, most expensive first", () => {
    const rows = nodeCostRows([
      { id: "a", costUsd: 0.001 },
      { id: "b", costUsd: 0 },
      { id: "c", costUsd: 0.01 },
    ] as never);
    expect(rows.map((r) => r.id)).toEqual(["c", "a"]);
  });
});

describe("taskToApproval", () => {
  it("explains a human node without borrowing an unrelated decision", () => {
    const task = {
      id: "t1",
      runId: RUN,
      nodeId: "approve",
      request: {
        title: "Approve",
        context: {},
        mode: { type: "approval" },
        assignees: [],
        expiresAt: null,
        externalReview: false,
        origin: "human_node",
      },
      createdAt: at(0),
    } as unknown as HumanTask;
    const a = taskToApproval(task, "Approve refund", [
      { id: "x", decision: { confidence: 0.4 } } as never,
    ]);
    expect(a).toMatchObject({
      nodeName: "Approve refund",
      reason: "This step always asks a person",
    });
    expect(a.decision).toBeUndefined();
  });
});
