import { uuidv7 } from "@flowaid/shared";
import type { Run, RunEventOf } from "@flowaid/workflow-core";
import {
  eventBusContract,
  queueDriverContract,
  runStoreContract,
} from "./testing/contractSuite.js";
import { MemoryEventBus, MemoryQueueDriver, MemoryRunStore } from "./testing/memory.js";

function newRun() {
  const id = uuidv7();
  const at = new Date().toISOString();
  const run = {
    id,
    workspaceId: uuidv7(),
    workflowId: uuidv7(),
    workflowVersionId: uuidv7(),
    environmentId: uuidv7(),
    status: "queued",
    origin: "api",
    mode: "async",
    input: {},
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
    createdAt: at,
    startedAt: null,
    endedAt: null,
  } as Run;
  const created = {
    type: "RUN_CREATED",
    runId: id,
    seq: 1,
    at,
    workflowVersionId: run.workflowVersionId,
    environmentId: run.environmentId,
    origin: "api",
    mode: "async",
    input: {},
    planHash: "h",
    idempotencyKey: null,
    sourceRunId: null,
  } as RunEventOf<"RUN_CREATED">;
  return Promise.resolve({ run, created });
}

runStoreContract("memory", () =>
  Promise.resolve({
    store: new MemoryRunStore(),
    newRun,
    elapse: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  }),
);
queueDriverContract("memory", () => {
  const queue = new MemoryQueueDriver();
  return Promise.resolve({ queue, close: () => queue.close() });
});
eventBusContract("memory", () => Promise.resolve({ bus: new MemoryEventBus() }));
