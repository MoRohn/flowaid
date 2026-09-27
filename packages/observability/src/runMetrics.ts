/**
 * Records a finished run into the metric registry (`METRICS`): the run itself, its node runs,
 * model spend and tokens, decisions, tool calls, failovers, provider errors, human outcomes and
 * retries. The worker calls it once per terminal run with the run's event log, so every metric is
 * derived from the same events the trace viewer shows.
 */
import type { NodeRun, Run, RunEvent } from "@flowaid/workflow-core";
import type { Instruments } from "./metrics.js";

export interface RunMetricLabels {
  /** workflow label (id or slug; bounded cardinality per workspace) */
  workflow: string;
  /** environment name */
  env: string;
}

export function recordRunMetrics(
  instruments: Instruments,
  input: { run: Run; events: readonly RunEvent[]; nodeRuns: readonly NodeRun[] },
  labels: RunMetricLabels,
): void {
  const { run, events, nodeRuns } = input;
  instruments.runsTotal.add(1, {
    workflow: labels.workflow,
    env: labels.env,
    status: run.status,
    origin: run.origin,
  });
  if (run.startedAt && run.endedAt)
    instruments.runDurationMs.record(
      Math.max(0, Date.parse(run.endedAt) - Date.parse(run.startedAt)),
      {},
    );
  const typeOf = new Map<string, string>();
  for (const nr of nodeRuns) {
    const type = nr.nodeType ?? nr.kind;
    typeOf.set(nr.id, type);
    if (
      nr.status === "completed" ||
      nr.status === "failed" ||
      nr.status === "skipped" ||
      nr.status === "cancelled"
    )
      instruments.nodeRunsTotal.add(1, { type, status: nr.status });
    if (nr.latencyMs !== null && nr.latencyMs !== undefined && nr.status !== "skipped")
      instruments.nodeDurationMs.record(nr.latencyMs, { type });
    if (nr.queueLatencyMs !== null && nr.queueLatencyMs !== undefined)
      instruments.queueLatencyMs.record(nr.queueLatencyMs, {});
  }
  for (const e of events) {
    // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- only metric-bearing events
    switch (e.type) {
      case "GENERATION_COMPLETED":
        instruments.aiCostUsd.add(e.costUsd, { provider: e.provider, model: e.model });
        instruments.tokensTotal.add(e.usage.inputTokens, {
          provider: e.provider,
          model: e.model,
          direction: "input",
        });
        instruments.tokensTotal.add(e.usage.outputTokens, {
          provider: e.provider,
          model: e.model,
          direction: "output",
        });
        break;
      case "DECISION_COMPLETED":
        instruments.decisionConfidence.record(e.decision.confidence, {
          kind: e.decision.kind,
          provider: e.decision.provider,
        });
        if (e.decision.costUsd > 0)
          instruments.aiCostUsd.add(e.decision.costUsd, {
            provider: e.decision.provider,
            model: e.decision.model,
          });
        break;
      case "PROVIDER_FAILOVER":
        instruments.providerFailoverTotal.add(1, { from: e.from, to: e.to });
        instruments.providerErrorsTotal.add(1, { provider: e.from, code: e.error.code });
        break;
      case "TOOL_RETURNED":
        instruments.toolCallsTotal.add(1, { tool: e.tool, status: e.ok ? "ok" : "error" });
        instruments.toolDurationMs.record(e.latencyMs, {});
        break;
      case "HUMAN_APPROVAL_RECEIVED":
        instruments.humanTasksTotal.add(1, {
          mode: "approval",
          action: e.response.action,
        });
        break;
      case "HUMAN_TASK_EXPIRED":
        instruments.humanTasksTotal.add(1, { mode: "approval", action: "expired" });
        break;
      case "NODE_RETRIED":
        instruments.retriesTotal.add(1, {
          type: typeOf.get(e.nodeRunId) ?? "unknown",
          code: e.error.code,
        });
        break;
      case "RUN_LEASE_TAKEN":
        instruments.leaseTakeoversTotal.add(1, {});
        break;
      default:
        // every other event type carries nothing the registry counts
        break;
    }
  }
}
