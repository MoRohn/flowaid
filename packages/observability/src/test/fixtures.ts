/** Test-only builders for runs, node runs and events with deterministic ids and times. */
import type { NodeRun, Run, RunEvent, TokenUsage } from "@flowaid/workflow-core";

export const RUN_ID = "00000000-0000-4000-8000-000000000001";
const T0 = Date.parse("2026-09-23T10:00:00.000Z");

export const at = (ms: number) => new Date(T0 + ms).toISOString();
/** A UUID from a small number. */
export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: RUN_ID,
    workspaceId: uid(900),
    workflowId: uid(901),
    workflowVersionId: uid(902),
    environmentId: uid(903),
    status: "completed",
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
    lastSeq: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    costUsd: 0,
    nodeRunCount: 0,
    createdAt: at(0),
    startedAt: at(0),
    endedAt: at(10_000),
    ...overrides,
  };
}

export interface NodeRunSpec {
  n: number;
  nodeId: string;
  scope?: string;
  attempt?: number;
  kind?: string;
  nodeType?: string | null;
  status?: NodeRun["status"];
  seq: number;
  endSeq?: number | null;
  start?: number;
  end?: number;
  costUsd?: number;
  usage?: TokenUsage | null;
  reusedFrom?: number;
  error?: NodeRun["error"];
  decision?: NodeRun["decision"];
  firedPorts?: string[];
}

export function makeNodeRun(s: NodeRunSpec): NodeRun {
  const start = s.start ?? s.seq * 100;
  const end = s.end ?? start + 50;
  const final = s.endSeq !== null;
  return {
    id: uid(s.n),
    runId: RUN_ID,
    nodeId: s.nodeId,
    scope: s.scope ?? "",
    attempt: s.attempt ?? 1,
    status: s.status ?? "completed",
    kind: s.kind ?? "task",
    nodeType: s.nodeType === undefined ? `flowaid.data.${s.nodeId}` : s.nodeType,
    nodeName: s.nodeId.replace(/_/g, " "),
    input: null,
    output: null,
    firedPorts: s.firedPorts ?? ["done"],
    decision: s.decision ?? null,
    error: s.error ?? null,
    usage: s.usage ?? null,
    costUsd: s.costUsd ?? 0,
    latencyMs: final ? end - start : null,
    queueLatencyMs: 5,
    idempotencyKey: null,
    inputHash: null,
    reusedFromNodeRunId: s.reusedFrom === undefined ? null : uid(s.reusedFrom),
    pool: "general",
    scheduledSeq: s.seq,
    endedSeq: final ? (s.endSeq ?? s.seq + 1) : null,
    startedAt: at(start),
    endedAt: final ? at(end) : null,
  };
}

/** A node event addressed to node run `n`. */
export function nodeEvent<T extends RunEvent["type"]>(
  type: T,
  n: number,
  nodeId: string,
  seq: number,
  fields: Record<string, unknown> = {},
  address: { scope?: string; attempt?: number } = {},
): RunEvent {
  return {
    type,
    runId: RUN_ID,
    seq,
    at: at(seq * 100),
    nodeRunId: uid(n),
    nodeId,
    scope: address.scope ?? "",
    attempt: address.attempt ?? 1,
    ...fields,
  } as unknown as RunEvent;
}

export const errorInfo = (code: string, message = code.toLowerCase()) =>
  ({ code, message, retryable: false }) as NodeRun["error"] & object;
