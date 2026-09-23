/**
 * Row ↔ contract mapping. Timestamps leave the database as `Date` and leave this package as ISO
 * strings; `numeric` money and confidence columns leave as strings and are returned as numbers.
 */
import type { HumanTask, NodeRun, Run, RunTimer } from "@flowaid/workflow-core";
import type { humanTasks, nodeRuns, runTimers, runs } from "./schema.js";

export type RunRow = typeof runs.$inferSelect;
export type NodeRunRow = typeof nodeRuns.$inferSelect;
export type HumanTaskRow = typeof humanTasks.$inferSelect;
export type RunTimerRow = typeof runTimers.$inferSelect;

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const num = (value: string | number | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value);

export function toRun(row: RunRow): Run {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    workflowId: row.workflowId,
    workflowVersionId: row.workflowVersionId,
    environmentId: row.environmentId,
    status: row.status,
    origin: row.origin,
    mode: row.mode,
    input: row.input,
    output: row.output ?? null,
    outcome: row.outcome,
    error: row.error ?? null,
    parentRunId: row.parentRunId,
    parentNodeRunId: row.parentNodeRunId,
    sourceRunId: row.sourceRunId,
    sessionId: row.sessionId,
    idempotencyKey: row.idempotencyKey,
    labels: row.labels,
    lastSeq: row.lastSeq,
    usage: row.usage,
    costUsd: num(row.costUsd),
    nodeRunCount: row.nodeRunCount,
    createdAt: row.createdAt.toISOString(),
    startedAt: iso(row.startedAt),
    endedAt: iso(row.endedAt),
  };
}

export function toNodeRun(row: NodeRunRow): NodeRun {
  return {
    id: row.id,
    runId: row.runId,
    nodeId: row.nodeId,
    scope: row.scope,
    attempt: row.attempt,
    status: row.status,
    kind: row.kind,
    nodeType: row.nodeType,
    nodeName: row.nodeName,
    input: row.input ?? null,
    output: row.output ?? null,
    firedPorts: row.firedPorts,
    decision: row.decision ?? null,
    error: row.error ?? null,
    usage: row.usage ?? null,
    costUsd: num(row.costUsd),
    latencyMs: row.latencyMs,
    queueLatencyMs: row.queueLatencyMs,
    idempotencyKey: row.idempotencyKey,
    inputHash: row.inputHash,
    reusedFromNodeRunId: row.reusedFromNodeRunId,
    pool: row.pool,
    scheduledSeq: row.scheduledSeq,
    endedSeq: row.endedSeq,
    startedAt: iso(row.startedAt),
    endedAt: iso(row.endedAt),
  };
}

export function toHumanTask(row: HumanTaskRow): HumanTask {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    runId: row.runId,
    nodeRunId: row.nodeRunId,
    nodeId: row.nodeId,
    scope: row.scope,
    workflowId: row.workflowId,
    request: row.request,
    status: row.status,
    response: row.response ?? null,
    respondedBy: row.respondedBy,
    respondedAt: iso(row.respondedAt),
    expiresAt: iso(row.expiresAt),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toRunTimer(row: RunTimerRow): RunTimer {
  return {
    id: row.id,
    runId: row.runId,
    nodeRunId: row.nodeRunId,
    purpose: row.purpose,
    fireAt: row.fireAt.toISOString(),
  };
}
