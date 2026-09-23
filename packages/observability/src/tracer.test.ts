import { afterEach, describe, expect, it } from "vitest";
import { context, metrics, propagation, trace, SpanStatusCode } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace";
import { ProviderError, type DecisionResult } from "@flowaid/workflow-core";
import {
  annotateDecision,
  getMeter,
  getTracer,
  injectTraceContext,
  setupTelemetry,
  withExtractedContext,
  withNodeRunSpan,
  withSpan,
} from "./tracer.js";

function telemetry(global = false) {
  const exporter = new InMemorySpanExporter();
  const t = setupTelemetry({
    serviceName: "flowaid-worker",
    serviceVersion: "0.1.0",
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
    prometheus: false,
    global,
  });
  return { ...t, exporter };
}

afterEach(() => {
  trace.disable();
  metrics.disable();
  propagation.disable();
  context.disable();
});

const decision: DecisionResult = {
  kind: "boolean",
  value: true,
  pYes: 0.91,
  probabilities: { true: 0.91, false: 0.09 },
  confidence: 0.91,
  provider: "typesafe",
  model: "jev-1.13.0",
  latencyMs: 120,
  costUsd: 0.0002,
  attempts: [],
};

describe("tracing", () => {
  it("records a flowaid.node_run span with the documented attributes", async () => {
    const t = telemetry();
    const result = await withNodeRunSpan(
      t.tracer,
      {
        runId: "r1",
        nodeRunId: "nr1",
        nodeId: "gate",
        nodeType: "flowaid.decision.boolean",
        scope: "loop#2",
        attempt: 2,
      },
      (span) => {
        annotateDecision(span, decision);
        return Promise.resolve(42);
      },
    );
    expect(result).toBe(42);
    const [span] = t.exporter.getFinishedSpans();
    expect(span?.name).toBe("flowaid.node_run");
    expect(span?.attributes).toMatchObject({
      "node.id": "gate",
      "node.type": "flowaid.decision.boolean",
      scope: "loop#2",
      attempt: 2,
      provider: "typesafe",
      model: "jev-1.13.0",
      "decision.confidence": 0.91,
    });
    expect(span?.resource.attributes["service.name"]).toBe("flowaid-worker");
    await t.shutdown();
  });

  it("marks failed spans with the flowaid error code and re-throws", async () => {
    const t = telemetry();
    await expect(
      withSpan(t.tracer, "provider.call", { provider: "openai" }, () =>
        Promise.reject(new ProviderError("upstream 500", true, "openai")),
      ),
    ).rejects.toThrow("upstream 500");
    const [span] = t.exporter.getFinishedSpans();
    expect(span?.status).toEqual({ code: SpanStatusCode.ERROR, message: "upstream 500" });
    expect(span?.attributes["flowaid.error.code"]).toBe("PROVIDER_ERROR");
    expect(span?.events.map((e) => e.name)).toEqual(["exception"]);
  });

  it("nests spans and carries the trace across a queue hop (W3C traceparent)", async () => {
    const t = telemetry(true);
    let headers: Record<string, string> = {};
    await withSpan(getTracer(), "run.step", {}, async () => {
      headers = injectTraceContext();
      await withSpan(getTracer(), "tool.call", {}, () => Promise.resolve());
    });
    expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    await withExtractedContext(headers, () =>
      withSpan(getTracer(), "worker.job", {}, () => Promise.resolve()),
    );

    const spans = t.exporter.getFinishedSpans();
    const step = spans.find((s) => s.name === "run.step");
    const tool = spans.find((s) => s.name === "tool.call");
    const job = spans.find((s) => s.name === "worker.job");
    expect(tool?.parentSpanContext?.spanId).toBe(step?.spanContext().spanId);
    expect(job?.spanContext().traceId).toBe(step?.spanContext().traceId);
    expect(job?.parentSpanContext?.spanId).toBe(step?.spanContext().spanId);
    expect(getMeter()).toBeDefined();
    await t.shutdown();
  });

  it("samples root traces by ratio", async () => {
    const exporter = new InMemorySpanExporter();
    const t = setupTelemetry({
      serviceName: "x",
      sampleRatio: 0,
      spanProcessors: [new SimpleSpanProcessor({ exporter })],
      prometheus: false,
      global: false,
    });
    await withSpan(t.tracer, "dropped", {}, () => Promise.resolve());
    expect(exporter.getFinishedSpans()).toHaveLength(0);
    await t.flush();
    await t.shutdown();
  });

  it("configures OTLP exporters when an endpoint is set", async () => {
    const t = setupTelemetry({
      serviceName: "x",
      otlpEndpoint: "http://127.0.0.1:1/",
      otlpHeaders: { "x-api-key": "k" },
      global: false,
    });
    expect(t.prometheusHandler).toBeTypeOf("function");
    // Nothing was recorded, so shutting down sends nothing to the unreachable collector.
    await t.shutdown();
  });
});
