/**
 * One-line summaries and colour families for run events. Every function here
 * is exhaustive over the real `RunEvent` union (CONTRACTS.ts §11) and reads
 * the payload fields the runtime emits (`latencyMs`, `firedPorts`,
 * `checkpointSeq`, …); a new event type is a compile error, never a silent
 * "log" row.
 */
import type { RunEvent, RunEventType, RunOrigin } from "@/types";
import { assertNever } from "@/types";
import { ORIGIN_LABEL } from "@/lib/categories";
import { formatCost, formatMs, formatProbability, formatTokens } from "@/lib/format";

export type EventFamily =
  | "run"
  | "node"
  | "flow"
  | "loop"
  | "subflow"
  | "decision"
  | "generation"
  | "tool"
  | "provider"
  | "checkpoint"
  | "human"
  | "log";

export const EVENT_FAMILIES: readonly EventFamily[] = [
  "run",
  "node",
  "flow",
  "loop",
  "subflow",
  "decision",
  "generation",
  "tool",
  "provider",
  "checkpoint",
  "human",
  "log",
];

export const EVENT_FAMILY_LABEL: Record<EventFamily, string> = {
  run: "Run",
  node: "Node",
  flow: "Flow",
  loop: "Loop",
  subflow: "Subflow",
  decision: "Decision",
  generation: "Generation",
  tool: "Tool",
  provider: "Provider",
  checkpoint: "Checkpoint",
  human: "Human",
  log: "Telemetry",
};

/** Colour family for an event type. Exhaustive: adding an event type without a family fails to compile. */
export function eventFamily(type: RunEventType): EventFamily {
  switch (type) {
    case "RUN_CREATED":
    case "RUN_STARTED":
    case "RUN_LEASE_TAKEN":
    case "RUN_WAITING":
    case "RUN_RESUMED":
    case "RUN_CANCEL_REQUESTED":
    case "RUN_OUTPUT":
    case "RUN_COMPLETED":
    case "RUN_FAILED":
    case "RUN_CANCELLED":
    case "RUN_TIMED_OUT":
    case "HEARTBEAT":
      return "run";
    case "CHECKPOINT_CREATED":
      return "checkpoint";
    case "NODE_SCHEDULED":
    case "NODE_STARTED":
    case "NODE_COMPLETED":
    case "NODE_FAILED":
    case "NODE_RETRIED":
    case "NODE_SKIPPED":
    case "NODE_CANCELLED":
    case "NODE_WAITING":
    case "NODE_DELEGATED":
      return "node";
    case "BRANCH_EVALUATED":
    case "JOIN_ARRIVED":
    case "TIMER_SET":
    case "TIMER_FIRED":
    case "EVENT_RECEIVED":
      return "flow";
    case "LOOP_ITERATION_STARTED":
    case "LOOP_ITERATION_COMPLETED":
    case "LOOP_EXITED":
    case "FOREACH_STARTED":
    case "FOREACH_ITEM_COMPLETED":
      return "loop";
    case "SUBFLOW_STARTED":
    case "SUBFLOW_COMPLETED":
      return "subflow";
    case "DECISION_REQUESTED":
    case "DECISION_COMPLETED":
      return "decision";
    case "PROVIDER_FAILOVER":
      return "provider";
    case "GENERATION_STARTED":
    case "GENERATION_COMPLETED":
    case "GENERATION_DELTA":
      return "generation";
    case "TOOL_CALLED":
    case "TOOL_RETURNED":
      return "tool";
    case "HUMAN_APPROVAL_REQUESTED":
    case "HUMAN_APPROVAL_RECEIVED":
    case "HUMAN_TASK_ESCALATED":
    case "HUMAN_TASK_EXPIRED":
      return "human";
    case "LOG":
    case "METRIC":
    case "ARTIFACT_CREATED":
    case "STATE_WRITTEN":
      return "log";
    default:
      return assertNever(type, "run event type");
  }
}

/** Events that represent a failure and should read in the danger colour. */
export function eventIsFailure(type: RunEventType): boolean {
  return type === "NODE_FAILED" || type === "RUN_FAILED" || type === "RUN_TIMED_OUT";
}

/** Events that represent a warning-level condition (retries, failover, cancellation, expiry). */
export function eventIsWarning(type: RunEventType): boolean {
  return (
    type === "NODE_RETRIED" ||
    type === "PROVIDER_FAILOVER" ||
    type === "RUN_CANCELLED" ||
    type === "RUN_CANCEL_REQUESTED" ||
    type === "NODE_CANCELLED" ||
    type === "HUMAN_TASK_EXPIRED"
  );
}

/** Events carrying a node address (`nodeId`, `nodeRunId`, `scope`, `attempt`). */
export type NodeRunEvent = Extract<
  RunEvent,
  { nodeId: string; nodeRunId: string; scope: string; attempt: number }
>;

export function isNodeRunEvent(event: RunEvent): event is NodeRunEvent {
  return "nodeRunId" in event && "nodeId" in event && "scope" in event && "attempt" in event;
}

/** The node id an event points at, if any (`RUN_OUTPUT` and `RUN_RESUMED` name a node without the full address). */
export function eventNodeId(event: RunEvent): string | undefined {
  if (isNodeRunEvent(event)) return event.nodeId;
  if (event.type === "RUN_OUTPUT") return event.nodeId;
  return undefined;
}

/** The event without its envelope (`runId`, `seq`, `at`, `type` and the node address): what the payload block shows. */
export function eventPayload(event: RunEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (key === "runId" || key === "seq" || key === "at" || key === "type" || key === "ephemeral")
      continue;
    if (key === "nodeRunId" || key === "nodeId" || key === "scope" || key === "attempt") continue;
    out[key] = value;
  }
  return out;
}

function truncate(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

function originLabel(origin: RunOrigin): string {
  return ORIGIN_LABEL[origin];
}

function attemptSuffix(attempt: number): string {
  return attempt > 1 ? ` (attempt ${attempt})` : "";
}

function scopeSuffix(scope: string): string {
  return scope ? ` [${scope}]` : "";
}

function firedRoute(firedPorts: readonly string[]): string | undefined {
  const route = firedPorts.find((p) => p !== "done");
  return route ?? (firedPorts.length ? firedPorts[0] : undefined);
}

function decisionValueLabel(event: Extract<RunEvent, { type: "DECISION_COMPLETED" }>): string {
  const d = event.decision;
  switch (d.kind) {
    case "boolean":
      return d.value ? "yes" : "no";
    case "choice":
      return d.value;
    case "score":
      return `${d.value.toFixed(2)} ${d.levelLabel}`;
    default:
      return assertNever(d, "decision kind");
  }
}

/**
 * One-line human summary of an event, e.g.
 * `Intent → security (0.81) · jev-1.13.0 · 84 ms`. `nodeName` is the join
 * from the definition; without it the node id is used.
 */
export function summarizeEvent(event: RunEvent, nodeName?: string): string {
  const node = nodeName ?? eventNodeId(event) ?? "node";
  switch (event.type) {
    case "RUN_CREATED":
      return `Created by ${originLabel(event.origin)} (${event.mode})`;
    case "RUN_STARTED":
      return `Started on ${event.workerId}`;
    case "RUN_LEASE_TAKEN":
      return event.previousWorkerId
        ? `Lease taken by ${event.workerId} from ${event.previousWorkerId} (${event.reason})`
        : `Lease taken by ${event.workerId} (${event.reason})`;
    case "RUN_WAITING":
      return `Run waiting on ${event.reason} · ${event.nodeRunIds.length} node run${event.nodeRunIds.length === 1 ? "" : "s"}`;
    case "RUN_RESUMED":
      return `Run resumed after ${event.reason}`;
    case "RUN_CANCEL_REQUESTED":
      return event.reason
        ? `Cancel requested by ${event.by} · ${truncate(event.reason, 80)}`
        : `Cancel requested by ${event.by}`;
    case "RUN_OUTPUT":
      return `${node} produced the run output${event.outcome ? ` · ${event.outcome}` : ""}${event.earlyExit ? " · early exit" : ""}`;
    case "RUN_COMPLETED":
      return `Run completed · ${formatMs(event.durationMs)} · ${formatCost(event.costUsd)}${event.outcome ? ` · ${event.outcome}` : ""}`;
    case "RUN_FAILED":
      return `Run failed ${event.error.code} · ${truncate(event.error.message, 90)}`;
    case "RUN_CANCELLED":
      return `Run cancelled by ${event.by} · ${formatMs(event.durationMs)}`;
    case "RUN_TIMED_OUT":
      return `Run timed out after ${formatMs(event.timeoutMs)}`;
    case "CHECKPOINT_CREATED":
      return `Checkpoint at seq ${event.checkpointSeq}`;
    case "NODE_SCHEDULED":
      return event.reusedFromNodeRunId
        ? `${node} scheduled · reusing ${event.reusedFromNodeRunId}`
        : `${node} scheduled${scopeSuffix(event.scope)}${event.batchId ? ` · batch ${event.batchId}` : ""}`;
    case "NODE_STARTED":
      return `${node} started${attemptSuffix(event.attempt)} · ${event.pool}`;
    case "NODE_COMPLETED": {
      const route = firedRoute(event.firedPorts);
      const parts = [`${node} ${event.reused ? "reused" : "completed"}`];
      if (route && route !== "done") parts.push(`→ ${route}`);
      parts.push(`· ${formatMs(event.latencyMs)}`);
      if (event.costUsd > 0) parts.push(`· ${formatCost(event.costUsd)}`);
      return parts.join(" ");
    }
    case "NODE_FAILED":
      return `${node} failed ${event.error.code} · ${truncate(event.error.message, 90)}${event.terminal ? " · terminal" : ""}`;
    case "NODE_RETRIED":
      return `${node} retrying attempt ${event.nextAttempt} after ${formatMs(event.delayMs)} · ${event.error.code}`;
    case "NODE_SKIPPED":
      return `${node} skipped · ${event.reason.replace(/_/g, " ")}`;
    case "NODE_CANCELLED":
      return `${node} cancelled · ${event.reason.replace(/_/g, " ")}`;
    case "NODE_WAITING":
      return `${node} waiting on ${event.reason} · ${event.ref}`;
    case "NODE_DELEGATED":
      return `${node} delegated to ${event.pool} · job ${event.jobId}`;
    case "BRANCH_EVALUATED":
      return event.taken.length
        ? `${node} → ${event.taken.join(", ")}`
        : `${node} → no branch taken`;
    case "JOIN_ARRIVED":
      return `${node} join ${event.status} from ${event.from} · ${event.arrived}/${event.expected}`;
    case "LOOP_ITERATION_STARTED":
      return `${node} iteration ${event.iteration + 1} started`;
    case "LOOP_ITERATION_COMPLETED":
      return `${node} iteration ${event.iteration + 1} completed${event.exit ? " · exit" : ""} · ${formatCost(event.costUsd)}`;
    case "LOOP_EXITED":
      return `${node} exited after ${event.iterations} iteration${event.iterations === 1 ? "" : "s"} · ${event.reason.replace(/_/g, " ")}`;
    case "FOREACH_STARTED":
      return `${node} over ${event.itemCount} item${event.itemCount === 1 ? "" : "s"} · concurrency ${event.concurrency}`;
    case "FOREACH_ITEM_COMPLETED":
      return `${node} item ${event.index + 1} ${event.status}${event.error ? ` · ${event.error.code}` : ""}`;
    case "SUBFLOW_STARTED":
      return `${node} started subflow ${event.childRunId} · depth ${event.depth}`;
    case "SUBFLOW_COMPLETED":
      return `${node} subflow ${event.status}${event.error ? ` · ${event.error.code}` : ""}`;
    case "TIMER_SET":
      return `${node} timer set · ${event.purpose.replace(/_/g, " ")} at ${event.fireAt}`;
    case "TIMER_FIRED":
      return `${node} timer fired · ${event.purpose.replace(/_/g, " ")}`;
    case "EVENT_RECEIVED":
      return `${node} received ${event.eventName}`;
    case "DECISION_REQUESTED":
      return `${node} asked ${event.provider}:${event.model} · ${event.questionCount} question${event.questionCount === 1 ? "" : "s"}`;
    case "DECISION_COMPLETED": {
      const d = event.decision;
      return `${node} → ${decisionValueLabel(event)} (${formatProbability(d.confidence)}) · ${d.model} · ${formatMs(d.latencyMs)}`;
    }
    case "PROVIDER_FAILOVER":
      return `${node} failover ${event.from} → ${event.to} · ${event.error.code} · ${truncate(event.error.message, 80)}`;
    case "GENERATION_STARTED":
      return `${node} generating with ${event.provider}:${event.model}${event.stream ? " · streaming" : ""}`;
    case "GENERATION_COMPLETED":
      return `${node} completed · ${formatTokens(event.usage.outputTokens)} tokens out · ${formatCost(event.costUsd)} · ${formatMs(event.latencyMs)}`;
    case "GENERATION_DELTA":
      return `${node} ${event.channel} delta · “${truncate(event.delta, 60)}”`;
    case "TOOL_CALLED":
      return `${node} called ${event.tool} (${event.source})${event.coerced ? " · args coerced" : ""}`;
    case "TOOL_RETURNED":
      return event.ok
        ? `${node} · ${event.tool} returned · ${formatMs(event.latencyMs)}`
        : `${node} · ${event.tool} failed${event.error ? ` ${event.error.code}` : ""} · ${formatMs(event.latencyMs)}`;
    case "HUMAN_APPROVAL_REQUESTED": {
      const who = event.request.assignees.length ? event.request.assignees.join(", ") : "anyone";
      return `${node} waiting for ${event.request.mode.type} · ${who} · ${truncate(event.request.title, 60)}`;
    }
    case "HUMAN_APPROVAL_RECEIVED":
      return `${node} ${event.response.action}${event.response.action === "choose" ? ` ${event.response.option}` : ""} by ${event.by}`;
    case "HUMAN_TASK_ESCALATED":
      return `${node} escalated to ${event.to.join(", ")} · ${event.reason}`;
    case "HUMAN_TASK_EXPIRED":
      return `${node} review expired · ${event.action}`;
    case "LOG":
      return `${node} · ${event.level.toUpperCase()} ${truncate(event.message, 100)}`;
    case "METRIC":
      return `${node} · ${event.name} = ${Number.isInteger(event.value) ? String(event.value) : event.value.toFixed(3)}`;
    case "ARTIFACT_CREATED":
      return `${node} wrote ${event.name} · ${event.mimeType} · ${formatTokens(event.bytes)} B`;
    case "STATE_WRITTEN":
      return `${node} wrote ${event.namespace}/${event.key} · ${formatTokens(event.bytes)} B`;
    case "HEARTBEAT":
      return "Heartbeat";
    default:
      return assertNever(event, "run event");
  }
}
