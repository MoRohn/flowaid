/**
 * OpenTelemetry wiring (ARCHITECTURE.md §10.5): one tracer provider and one meter provider per
 * process, with W3C trace-context propagation and async-local context.
 *
 * - Spans: an HTTP request, a run step, a node run (`flowaid.node_run`), a provider call and a
 *   tool call each get one. They are exported over OTLP/HTTP when `otlpEndpoint` is set
 *   (`OTEL_EXPORTER_OTLP_ENDPOINT`, read by `@flowaid/env`) and dropped otherwise, so tracing
 *   costs almost nothing when nobody collects it.
 * - Metrics: the `METRICS` registry, served in Prometheus text format on the internal listener
 *   (`prometheusHandler`) and also pushed over OTLP when an endpoint is set.
 *
 * Nothing here reads `process.env`: the caller passes the loaded configuration.
 */
import {
  context,
  metrics,
  propagation,
  trace,
  SpanStatusCode,
  type Attributes,
  type Meter,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type IMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  TracerProvider,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DecisionResult, ErrorInfo, NodeId, ScopePath } from "@flowaid/workflow-core";
import { createInstruments, type Instruments } from "./metrics.js";

export const INSTRUMENTATION_SCOPE = "@flowaid/observability";

export interface TelemetryOptions {
  /** `service.name`, e.g. `flowaid-api` or `flowaid-worker`. */
  serviceName: string;
  serviceVersion?: string;
  /** Extra resource attributes (deployment environment, pool, …). */
  resource?: Attributes;
  /** OTLP/HTTP base URL (`…/v1/traces` and `…/v1/metrics` are appended). */
  otlpEndpoint?: string;
  /** Headers for the OTLP exporter (e.g. an API key of the collector). */
  otlpHeaders?: Record<string, string>;
  /** Fraction of root traces sampled, 0…1 (children follow their parent). Default 1. */
  sampleRatio?: number;
  /** Serve Prometheus text through `prometheusHandler` (default true). */
  prometheus?: boolean;
  /** Push interval for OTLP metrics in milliseconds (default 30 000). */
  metricIntervalMs?: number;
  /** Extra span processors (tests use an in-memory exporter). */
  spanProcessors?: SpanProcessor[];
  /** Extra metric readers. */
  metricReaders?: IMetricReader[];
  /** Register as the global providers (default true). Tests pass false. */
  global?: boolean;
}

export interface Telemetry {
  tracer: Tracer;
  meter: Meter;
  instruments: Instruments;
  /** Writes the Prometheus exposition (set when `prometheus` is on). */
  prometheusHandler?: (request: IncomingMessage, response: ServerResponse) => void;
  /** Flushes pending spans and metrics. */
  flush(): Promise<void>;
  /** Flushes and stops exporting; call on SIGTERM. */
  shutdown(): Promise<void>;
}

const trimSlash = (url: string) => url.replace(/\/+$/, "");

/** Builds (and by default registers) the process's tracer and meter providers. */
export function setupTelemetry(options: TelemetryOptions): Telemetry {
  const resource = resourceFromAttributes({
    "service.name": options.serviceName,
    ...(options.serviceVersion ? { "service.version": options.serviceVersion } : {}),
    ...options.resource,
  });

  const spanProcessors: SpanProcessor[] = [...(options.spanProcessors ?? [])];
  if (options.otlpEndpoint) {
    spanProcessors.push(
      new BatchSpanProcessor({
        exporter: new OTLPTraceExporter({
          url: `${trimSlash(options.otlpEndpoint)}/v1/traces`,
          ...(options.otlpHeaders ? { headers: options.otlpHeaders } : {}),
        }),
      }),
    );
  }
  const ratio = Math.min(1, Math.max(0, options.sampleRatio ?? 1));
  const tracerProvider = new TracerProvider({
    resource,
    spanProcessors,
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) }),
  });

  const readers: IMetricReader[] = [...(options.metricReaders ?? [])];
  let prometheus: PrometheusExporter | undefined;
  if (options.prometheus ?? true) {
    prometheus = new PrometheusExporter({ preventServerStart: true, withoutScopeInfo: true });
    readers.push(prometheus);
  }
  if (options.otlpEndpoint) {
    readers.push(
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: `${trimSlash(options.otlpEndpoint)}/v1/metrics`,
          ...(options.otlpHeaders ? { headers: options.otlpHeaders } : {}),
        }),
        exportIntervalMillis: options.metricIntervalMs ?? 30_000,
      }),
    );
  }
  const meterProvider = new MeterProvider({ resource, readers });

  if (options.global ?? true) {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    trace.setGlobalTracerProvider(tracerProvider);
    metrics.setGlobalMeterProvider(meterProvider);
  }

  const tracer = tracerProvider.getTracer(INSTRUMENTATION_SCOPE, options.serviceVersion);
  const meter = meterProvider.getMeter(INSTRUMENTATION_SCOPE, options.serviceVersion);
  const telemetry: Telemetry = {
    tracer,
    meter,
    instruments: createInstruments(meter),
    flush: async () => {
      await Promise.all([tracerProvider.forceFlush(), meterProvider.forceFlush()]);
    },
    shutdown: async () => {
      await Promise.all([tracerProvider.shutdown(), meterProvider.shutdown()]);
    },
  };
  if (prometheus) {
    const exporter = prometheus;
    telemetry.prometheusHandler = (request, response) =>
      exporter.getMetricsRequestHandler(request, response);
  }
  return telemetry;
}

/** The global tracer (a no-op until `setupTelemetry` registered a provider). */
export function getTracer(): Tracer {
  return trace.getTracer(INSTRUMENTATION_SCOPE);
}

/** The global meter (a no-op until `setupTelemetry` registered a provider). */
export function getMeter(): Meter {
  return metrics.getMeter(INSTRUMENTATION_SCOPE);
}

/** Records an error on a span: status ERROR plus the flowaid error code and message. */
export function recordError(span: Span, error: unknown): void {
  const info = error as Partial<ErrorInfo> & { message?: string };
  const message = error instanceof Error ? error.message : (info.message ?? String(error));
  span.setStatus({ code: SpanStatusCode.ERROR, message });
  if (error instanceof Error) span.recordException(error);
  if (typeof info.code === "string") span.setAttribute("flowaid.error.code", info.code);
}

/**
 * Runs `fn` inside an active span; the span ends when the promise settles and is marked as an
 * error when it rejects (the rejection is re-thrown).
 */
export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      recordError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/** What a node run span describes (the attribute names of ARCHITECTURE.md §10.5). */
export interface NodeRunSpanInfo {
  runId: string;
  nodeRunId: string;
  nodeId: NodeId;
  nodeType: string | null;
  scope: ScopePath;
  attempt: number;
  workspaceId?: string;
}

/** Attributes of a `flowaid.node_run` span. */
export function nodeRunAttributes(info: NodeRunSpanInfo): Attributes {
  return {
    "flowaid.run.id": info.runId,
    "flowaid.node_run.id": info.nodeRunId,
    "node.id": info.nodeId,
    "node.type": info.nodeType ?? "",
    scope: info.scope,
    attempt: info.attempt,
    ...(info.workspaceId ? { "flowaid.workspace.id": info.workspaceId } : {}),
  };
}

/** Adds the provider, model and confidence of a decision to its node run span. */
export function annotateDecision(span: Span, decision: DecisionResult): void {
  span.setAttributes({
    provider: decision.provider,
    model: decision.model,
    "decision.kind": decision.kind,
    "decision.confidence": decision.confidence,
  });
}

/** Runs a node attempt inside a `flowaid.node_run` span. */
export function withNodeRunSpan<T>(
  tracer: Tracer,
  info: NodeRunSpanInfo,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan(tracer, "flowaid.node_run", nodeRunAttributes(info), fn);
}

/** Injects the active trace context into outgoing headers (queue jobs, HTTP calls). */
export function injectTraceContext(carrier: Record<string, string> = {}): Record<string, string> {
  propagation.inject(context.active(), carrier);
  return carrier;
}

/** Runs `fn` in the trace context carried by `carrier` (a job's headers, an HTTP request). */
export function withExtractedContext<T>(
  carrier: Readonly<Record<string, string | string[] | undefined>>,
  fn: () => T,
): T {
  return context.with(propagation.extract(context.active(), carrier), fn);
}
