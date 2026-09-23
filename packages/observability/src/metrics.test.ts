import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { METRICS, prometheusName, type MetricKey } from "./metrics.js";
import { setupTelemetry } from "./tracer.js";

const keys = Object.keys(METRICS) as MetricKey[];

/** Calls a Prometheus request handler and returns the exposition text. */
async function scrape(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<string> {
  return new Promise((resolve) => {
    const res = {
      statusCode: 0,
      setHeader: () => res,
      end: (body: string) => resolve(body),
    };
    handler({} as IncomingMessage, res as unknown as ServerResponse);
  });
}

describe("METRICS", () => {
  it("matches the registry snapshot", () => {
    const registry = keys.map((key) => {
      const m = METRICS[key];
      return `${prometheusName(key)} ${m.kind}${m.labels.length ? ` {${m.labels.join(",")}}` : ""}`;
    });
    expect(registry).toMatchInlineSnapshot(`
      [
        "flowaid_runs_total counter {workflow,env,status,origin}",
        "flowaid_run_duration_ms histogram",
        "flowaid_queue_latency_ms histogram",
        "flowaid_node_runs_total counter {type,status}",
        "flowaid_node_duration_ms histogram {type}",
        "flowaid_ai_cost_usd_total counter {provider,model}",
        "flowaid_tokens_total counter {provider,model,direction}",
        "flowaid_decision_confidence histogram {kind,provider}",
        "flowaid_provider_failover_total counter {from,to}",
        "flowaid_provider_errors_total counter {provider,code}",
        "flowaid_tool_calls_total counter {tool,status}",
        "flowaid_tool_duration_ms histogram",
        "flowaid_human_tasks_total counter {mode,action}",
        "flowaid_retries_total counter {type,code}",
        "flowaid_queue_depth gauge {queue}",
        "flowaid_lease_takeovers_total counter",
        "flowaid_worker_active_runs gauge {pool}",
      ]
    `);
  });

  it("lists exactly the names and labels of ARCHITECTURE.md §10.5", () => {
    const doc = readFileSync(
      fileURLToPath(new URL("../../../docs/design/ARCHITECTURE.md", import.meta.url)),
      "utf8",
    );
    const section = doc.slice(doc.indexOf("### 10.5"), doc.indexOf("### 10.6"));
    const documented = [...section.matchAll(/`(flowaid_[a-z_]+)(?:\{([a-z,]+)\})?`/g)].map(
      (m) => `${m[1]}${m[2] ? `{${m[2]}}` : ""}`,
    );
    const registered = keys.map((key) => {
      const labels = METRICS[key].labels;
      return `${prometheusName(key)}${labels.length ? `{${labels.join(",")}}` : ""}`;
    });
    expect(documented).toHaveLength(17);
    expect(registered).toEqual(documented);
  });

  it("serves the documented names in Prometheus text format", async () => {
    const telemetry = setupTelemetry({ serviceName: "flowaid-test", global: false });
    const i = telemetry.instruments;
    i.runsTotal.add(1, { workflow: "wf", env: "production", status: "completed", origin: "api" });
    i.runDurationMs.record(1_250, {});
    i.nodeRunsTotal.add(3, { type: "flowaid.ai.generate", status: "completed" });
    i.aiCostUsd.add(0.0125, { provider: "openai", model: "gpt-4.1-mini" });
    i.tokensTotal.add(900, { provider: "openai", model: "gpt-4.1-mini", direction: "input" });
    i.decisionConfidence.record(0.82, { kind: "choice", provider: "typesafe" });
    i.queueDepth.record(7, { queue: "runs" });
    i.leaseTakeoversTotal.add(1, {});
    i.workerActiveRuns.record(2, { pool: "general" });
    const text = await scrape(telemetry.prometheusHandler ?? (() => undefined));
    await telemetry.shutdown();

    expect(text).toContain(
      'flowaid_runs_total{workflow="wf",env="production",status="completed",origin="api"} 1',
    );
    expect(text).toContain("# TYPE flowaid_run_duration_ms histogram");
    expect(text).toContain('flowaid_run_duration_ms_bucket{le="5000"} 1');
    expect(text).toContain(
      'flowaid_ai_cost_usd_total{provider="openai",model="gpt-4.1-mini"} 0.0125',
    );
    expect(text).toContain(
      'flowaid_decision_confidence_bucket{kind="choice",provider="typesafe",le="0.9"} 1',
    );
    expect(text).toContain('flowaid_queue_depth{queue="runs"} 7');
    expect(text).toContain("flowaid_lease_takeovers_total 1");
    expect(text).toContain('flowaid_worker_active_runs{pool="general"} 2');
    // No unit or scope suffixes leak into the names.
    expect(text).not.toMatch(/flowaid_[a-z_]+_total_total|otel_scope/);
  });
});
