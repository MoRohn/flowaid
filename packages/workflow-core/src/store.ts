/**
 * §17 Store and infrastructure interfaces.
 * Implemented by @flowaid/database (Postgres) and by in-memory test doubles in workflow-runtime/testing.
 */
import type { JsonValue } from "./json.js";
import type { NodeId, PortName, ScopePath, SecretName } from "./ids.js";
import type { WorkerPool } from "./manifest.js";
import type { DecisionResult } from "./decision.js";
import type { HumanRequest, HumanResponse } from "./human.js";
import type { NodeRun, Run } from "./run.js";
import type {
  DurableRunEvent,
  RunEventOf,
  RunEventType,
  TimerPurpose,
  WaitReason,
} from "./events.js";
import type { DataClass } from "./json.js";

/** A durable human task row. */
export interface HumanTask {
  id: string;
  workspaceId: string;
  runId: string;
  nodeRunId: string;
  nodeId: NodeId;
  scope: ScopePath;
  workflowId: string;
  request: HumanRequest;
  status: "open" | "responded" | "expired" | "cancelled";
  response: HumanResponse | null;
  respondedBy: string | null;
  respondedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** A durable timer row (authoritative in Postgres). */
export interface RunTimer {
  id: string;
  runId: string;
  nodeRunId: string | null;
  purpose: TimerPurpose;
  fireAt: string;
}

/** The single-writer lease of a run. */
export interface LeaseInfo {
  runId: string;
  workerId: string;
  leaseUntil: string;
  lastSeq: number;
}

/** Fencing parameters of an append. */
export interface AppendOptions {
  /** Fencing: the append fails with WorkerLostError unless runs.lease_owner === leaseOwner and runs.last_seq === expectedSeq. */
  leaseOwner: string;
  expectedSeq: number;
}

/** Persistence of runs, events, checkpoints, leases, timers and human tasks. */
export interface RunStore {
  createRun(run: Run, created: RunEventOf<"RUN_CREATED">): Promise<void>;
  getRun(runId: string): Promise<Run | null>;
  /** Appends durable events with dense seq, applies projections (runs, node_runs, human_tasks, run_timers) in ONE transaction, then notifies. */
  appendEvents(
    runId: string,
    events: readonly Omit<DurableRunEvent, "seq" | "runId" | "at">[],
    opts: AppendOptions,
  ): Promise<{ firstSeq: number; lastSeq: number }>;
  listEvents(
    runId: string,
    afterSeq: number,
    limit: number,
    types?: readonly RunEventType[],
  ): Promise<DurableRunEvent[]>;
  listNodeRuns(runId: string): Promise<NodeRun[]>;
  getNodeOutput(
    runId: string,
    scope: ScopePath,
    nodeId: NodeId,
  ): Promise<{ output: JsonValue; nodeRunId: string; attempt: number } | null>;
  /** (nodeId, scope, inputHash) → recorded output/decision for recorded replay, restart and fork. */
  recordedOutputs(runId: string): Promise<
    Map<
      string,
      {
        nodeRunId: string;
        output: JsonValue;
        firedPorts: PortName[];
        decision: DecisionResult | null;
      }
    >
  >;
  saveCheckpoint(runId: string, seq: number, state: JsonValue): Promise<void>;
  latestCheckpoint(
    runId: string,
    maxSeq: number,
  ): Promise<{ seq: number; state: JsonValue } | null>;
  acquireLease(runId: string, workerId: string, ttlMs: number): Promise<LeaseInfo | null>;
  renewLease(runId: string, workerId: string, ttlMs: number): Promise<boolean>;
  releaseLease(runId: string, workerId: string): Promise<void>;
  expiredLeases(now: Date, limit: number): Promise<LeaseInfo[]>;
  dueTimers(now: Date, limit: number): Promise<RunTimer[]>;
  markTimerFired(timerId: string): Promise<boolean>;
  cancelRequest(runId: string): Promise<{ by: string; reason: string | null; at: string } | null>;
  getHumanTask(id: string): Promise<HumanTask | null>;
  /** CAS open → responded; returns false if the task was not open. */
  respondHumanTask(id: string, response: HumanResponse, by: string): Promise<boolean>;
}

/** Binary artifact storage (S3/MinIO/filesystem). */
export interface ArtifactStore {
  put(input: {
    workspaceId: string;
    runId: string | null;
    nodeRunId: string | null;
    name: string;
    mimeType: string;
    data: Uint8Array;
    dataClass: DataClass;
  }): Promise<{ id: string; sha256: string; bytes: number }>;
  get(id: string): Promise<Uint8Array>;
  signedUrl(id: string, ttlMs: number): Promise<string>;
  delete(id: string): Promise<void>;
}

/** Queue names: one per worker pool plus control and background queues. */
export type QueueName =
  `run:${WorkerPool}` | "run:control" | "schedule" | "ingest" | "evaluation" | "trace_review";
/** Every job payload. */
export type Job =
  | { type: "run.start"; runId: string }
  | { type: "run.resume"; runId: string; reason: WaitReason | "manual_retry" | "recovery" }
  | { type: "run.control"; runId: string; action: "cancel"; by: string; reason: string | null }
  | {
      type: "run.signal";
      runId: string;
      signal:
        | { type: "subflow_completed"; childRunId: string }
        | { type: "delegated_result"; nodeRunId: string }
        | { type: "event"; eventName: string; payload: JsonValue };
    }
  | { type: "node.exec"; runId: string; nodeRunId: string; pool: WorkerPool }
  | { type: "timer.fire"; runId: string; timerId: string }
  | { type: "schedule.tick"; scheduleId: string; at: string }
  | { type: "ingest.source"; sourceId: string }
  | { type: "evaluation.run"; evaluationRunId: string }
  | { type: "trace_review.run"; runId: string };

/** Job queue (BullMQ or Postgres). */
export interface QueueDriver {
  enqueue(
    queue: QueueName,
    job: Job,
    opts?: { delayMs?: number; jobId?: string; priority?: number },
  ): Promise<void>;
  consume(
    queue: QueueName,
    handler: (job: Job) => Promise<void>,
    opts: { concurrency: number },
  ): Promise<{ stop(): Promise<void> }>;
  /** Accelerator for run_timers (authoritative rows live in Postgres). May be a no-op for the Postgres driver. */
  scheduleTimer(timer: RunTimer): Promise<void>;
  cancelTimer(timerId: string): Promise<void>;
  close(): Promise<void>;
}

/** Pub/sub fan-out for live event notifications. */
export interface EventBus {
  /** Payload carries ids only ({ runId, fromSeq, toSeq }) or an ephemeral event; subscribers re-read durable events by seq. */
  publish(channel: string, message: JsonValue): Promise<void>;
  subscribe(channel: string, onMessage: (message: JsonValue) => void): Promise<() => Promise<void>>;
}

/** Credential ciphertext access, injected into `@flowaid/credentials`. */
export interface CredentialRepository {
  getCiphertext(credentialId: string): Promise<{
    workspaceId: string;
    type: string;
    ciphertext: string;
    wrappedDataKey: string;
    keyVersion: number;
    provider: string;
    externalRef: string | null;
    scopes: string[];
  } | null>;
  resolveBinding(
    workflowId: string,
    environmentId: string,
    secretName: SecretName,
  ): Promise<string | null>;
  touch(credentialId: string, usedAt: Date): Promise<void>;
}
