/**
 * The Prometheus metric registry (ARCHITECTURE.md §10.5). `METRICS` is the single list of names,
 * instrument kinds, units and labels; `createInstruments(meter)` turns it into typed OpenTelemetry
 * instruments whose label sets are checked at compile time:
 *
 *   instruments.runsTotal.add(1, { workflow, env, status, origin });
 *
 * Counters are declared without the `_total` suffix; the Prometheus exporter appends it, so the
 * scraped names are exactly the ones in the architecture document. Units are kept in the names
 * (`_ms`, `_usd`), so instruments carry no OpenTelemetry unit (which would add a second suffix).
 */
import type {
  Attributes,
  Counter,
  Gauge,
  Histogram,
  Meter,
  UpDownCounter,
} from "@opentelemetry/api";

export type MetricKind = "counter" | "histogram" | "gauge" | "updown";

export interface MetricDefinition {
  /** OpenTelemetry instrument name (the Prometheus name, minus `_total` for counters). */
  name: string;
  kind: MetricKind;
  help: string;
  labels: readonly string[];
  /** Explicit histogram bucket boundaries. */
  buckets?: readonly number[];
}

/** Latency buckets in milliseconds: 5 ms … 10 min. */
export const LATENCY_BUCKETS_MS = [
  5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000, 300_000, 600_000,
] as const;
/** Run duration buckets in milliseconds: 100 ms … 24 h (runs can wait on people). */
export const RUN_DURATION_BUCKETS_MS = [
  100, 500, 1_000, 5_000, 15_000, 60_000, 300_000, 900_000, 3_600_000, 14_400_000, 86_400_000,
] as const;
/** Confidence buckets over [0, 1]. */
export const CONFIDENCE_BUCKETS = [
  0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99,
] as const;

const define = <const K extends MetricKind, const L extends readonly string[]>(
  name: string,
  kind: K,
  help: string,
  labels: L,
  buckets?: readonly number[],
) => ({ name, kind, help, labels, ...(buckets ? { buckets } : {}) }) as const;

/** Every flowaid metric; keys are the instrument handles returned by `createInstruments`. */
export const METRICS = {
  runsTotal: define("flowaid_runs", "counter", "Runs that reached a terminal status.", [
    "workflow",
    "env",
    "status",
    "origin",
  ] as const),
  runDurationMs: define(
    "flowaid_run_duration_ms",
    "histogram",
    "Wall-clock duration of finished runs, in milliseconds.",
    [] as const,
    RUN_DURATION_BUCKETS_MS,
  ),
  queueLatencyMs: define(
    "flowaid_queue_latency_ms",
    "histogram",
    "Time a node run waited in the queue before a worker started it, in milliseconds.",
    [] as const,
    LATENCY_BUCKETS_MS,
  ),
  nodeRunsTotal: define("flowaid_node_runs", "counter", "Node runs by type and final status.", [
    "type",
    "status",
  ] as const),
  nodeDurationMs: define(
    "flowaid_node_duration_ms",
    "histogram",
    "Node run latency by node type, in milliseconds.",
    ["type"] as const,
    LATENCY_BUCKETS_MS,
  ),
  aiCostUsd: define("flowaid_ai_cost_usd", "counter", "Model spend in US dollars.", [
    "provider",
    "model",
  ] as const),
  tokensTotal: define("flowaid_tokens", "counter", "Model tokens by direction (input, output).", [
    "provider",
    "model",
    "direction",
  ] as const),
  decisionConfidence: define(
    "flowaid_decision_confidence",
    "histogram",
    "Confidence of typed decisions.",
    ["kind", "provider"] as const,
    CONFIDENCE_BUCKETS,
  ),
  providerFailoverTotal: define(
    "flowaid_provider_failover",
    "counter",
    "Provider chain hops from one provider to the next.",
    ["from", "to"] as const,
  ),
  providerErrorsTotal: define(
    "flowaid_provider_errors",
    "counter",
    "Provider call failures by error code.",
    ["provider", "code"] as const,
  ),
  toolCallsTotal: define("flowaid_tool_calls", "counter", "Tool calls by outcome.", [
    "tool",
    "status",
  ] as const),
  toolDurationMs: define(
    "flowaid_tool_duration_ms",
    "histogram",
    "Tool call latency, in milliseconds.",
    [] as const,
    LATENCY_BUCKETS_MS,
  ),
  humanTasksTotal: define("flowaid_human_tasks", "counter", "Human task outcomes.", [
    "mode",
    "action",
  ] as const),
  retriesTotal: define("flowaid_retries", "counter", "Node retries by node type and error code.", [
    "type",
    "code",
  ] as const),
  queueDepth: define("flowaid_queue_depth", "gauge", "Jobs waiting per queue.", ["queue"] as const),
  leaseTakeoversTotal: define(
    "flowaid_lease_takeovers",
    "counter",
    "Run leases taken over from a lost worker.",
    [] as const,
  ),
  workerActiveRuns: define(
    "flowaid_worker_active_runs",
    "gauge",
    "Runs a worker pool is executing right now.",
    ["pool"] as const,
  ),
} as const satisfies Record<string, MetricDefinition>;

export type MetricKey = keyof typeof METRICS;

/** The scraped Prometheus name of a metric (`_total` appended to counters). */
export function prometheusName(key: MetricKey): string {
  const metric: MetricDefinition = METRICS[key];
  return metric.kind === "counter" ? `${metric.name}_total` : metric.name;
}

type LabelsOf<K extends MetricKey> = (typeof METRICS)[K]["labels"][number];
/** The label set of a metric: every declared label, as a string. */
export type MetricLabels<K extends MetricKey> = [LabelsOf<K>] extends [never]
  ? Record<string, never>
  : Record<LabelsOf<K>, string>;

interface Typed<K extends MetricKey> {
  counter: { add(value: number, labels: MetricLabels<K>): void };
  updown: { add(value: number, labels: MetricLabels<K>): void };
  histogram: { record(value: number, labels: MetricLabels<K>): void };
  gauge: { record(value: number, labels: MetricLabels<K>): void };
}

export type Instruments = {
  [K in MetricKey]: Typed<K>[(typeof METRICS)[K]["kind"]];
};

/** Creates one OpenTelemetry instrument per registry entry. */
export function createInstruments(meter: Meter): Instruments {
  const out: Record<string, unknown> = {};
  for (const [key, metric] of Object.entries(METRICS) as Array<[MetricKey, MetricDefinition]>) {
    const options = { description: metric.help, unit: "" };
    let instrument:
      Counter<Attributes> | UpDownCounter<Attributes> | Histogram<Attributes> | Gauge<Attributes>;
    switch (metric.kind) {
      case "counter":
        instrument = meter.createCounter(metric.name, options);
        break;
      case "updown":
        instrument = meter.createUpDownCounter(metric.name, options);
        break;
      case "gauge":
        instrument = meter.createGauge(metric.name, options);
        break;
      case "histogram":
        instrument = meter.createHistogram(metric.name, {
          ...options,
          ...(metric.buckets ? { advice: { explicitBucketBoundaries: [...metric.buckets] } } : {}),
        });
        break;
    }
    out[key] = instrument;
  }
  return out as Instruments;
}
