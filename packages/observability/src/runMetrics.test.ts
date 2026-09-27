import { describe, expect, it } from "vitest";
import type { NodeRun, Run, RunEvent } from "@flowaid/workflow-core";
import { startMetricsListener } from "./listener.js";
import { recordRunMetrics } from "./runMetrics.js";
import { setupTelemetry } from "./tracer.js";

const run = {
  id: "r1",
  status: "failed",
  origin: "api",
  startedAt: "2026-09-27T12:00:00.000Z",
  endedAt: "2026-09-27T12:00:02.000Z",
} as Run;

const nodeRuns = [
  {
    id: "n1",
    nodeType: "flowaid.decision.boolean",
    kind: "task",
    status: "completed",
    latencyMs: 300,
    queueLatencyMs: 4,
  },
  {
    id: "n2",
    nodeType: "flowaid.tools.http",
    kind: "task",
    status: "failed",
    latencyMs: 90,
    queueLatencyMs: 2,
  },
] as unknown as NodeRun[];

const events = [
  {
    type: "DECISION_COMPLETED",
    nodeRunId: "n1",
    decision: {
      kind: "boolean",
      provider: "typesafe",
      model: "jev-1",
      confidence: 0.93,
      costUsd: 0.00002,
    },
  },
  {
    type: "GENERATION_COMPLETED",
    provider: "openai",
    model: "gpt-x",
    costUsd: 0.01,
    usage: { inputTokens: 100, outputTokens: 20 },
  },
  { type: "TOOL_RETURNED", tool: "http", ok: false, latencyMs: 80 },
  { type: "NODE_RETRIED", nodeRunId: "n2", error: { code: "TIMEOUT" } },
  {
    type: "PROVIDER_FAILOVER",
    from: "openai",
    to: "anthropic",
    error: { code: "RATE_LIMIT_ERROR" },
  },
] as unknown as RunEvent[];

describe("recordRunMetrics", () => {
  it("exposes the run's metrics in Prometheus format", async () => {
    const telemetry = setupTelemetry({ serviceName: "test", global: false });
    recordRunMetrics(
      telemetry.instruments,
      { run, events, nodeRuns },
      { workflow: "wf", env: "dev" },
    );
    const handler = telemetry.prometheusHandler;
    if (!handler) throw new Error("no prometheus handler");
    const listener = await startMetricsListener({ port: 0, host: "127.0.0.1", handler });
    try {
      const text = await (await fetch(`http://127.0.0.1:${listener.port}/metrics`)).text();
      expect(text).toMatch(/flowaid_runs_total\{[^}]*status="failed"[^}]*\} 1/);
      expect(text).toMatch(/flowaid_node_runs_total\{[^}]*type="flowaid.tools.http"[^}]*\} 1/);
      expect(text).toMatch(/flowaid_tokens_total\{[^}]*direction="input"[^}]*\} 100/);
      expect(text).toMatch(
        /flowaid_retries_total\{[^}]*code="TIMEOUT"[^}]*type="flowaid.tools.http"[^}]*\} 1|flowaid_retries_total\{[^}]*type="flowaid.tools.http"[^}]*\} 1/,
      );
      expect(text).toMatch(/flowaid_provider_failover_total\{[^}]*\} 1/);
      expect(text).toContain("flowaid_decision_confidence_bucket");
      expect(text).toMatch(/flowaid_tool_calls_total\{[^}]*status="error"[^}]*\} 1/);
    } finally {
      await listener.close();
      await telemetry.shutdown();
    }
  });
});
