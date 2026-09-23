# @flowaid/observability

Logs, traces, metrics and run timelines for flowaid services, with secrets kept out of all of
them. Design: [ARCHITECTURE.md §10.5](../../docs/design/ARCHITECTURE.md).

| Module           | What it does                                                                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createLogger`   | pino JSON lines bound to `requestId / runId / nodeRunId / workspaceId`; `redact.paths` for auth headers, cookies, webhook tokens and review-link tokens; every line passes through the `Redactor`     |
| `setupTelemetry` | Tracer and meter providers with W3C propagation and async context; OTLP/HTTP export when an endpoint is configured, Prometheus text through `prometheusHandler`; ratio sampling                       |
| `METRICS`        | The 17 Prometheus metrics (names, kinds, labels, buckets); `createInstruments(meter)` returns instruments whose label sets are type-checked. A test keeps the list equal to the architecture document |
| `buildTimeline`  | Node runs and events → the spans of `GET /v1/runs/:id/trace`: nested loop/foreach scopes, retries as child spans, reused nodes, markers; folds live events over a lagging projection                  |
| `TraceReviewer`  | Deterministic short-circuits, then one choice and one boolean question over a compact, redacted trace summary through any `DecisionProvider`; `shouldReview` samples completed runs by a stable hash  |

## Logging without leaking

```ts
const redactor = credentials.redactor; // learns every decrypted value
const logger = createLogger({ service: "flowaid-worker" }, { redactor, level: env.LOG_LEVEL });
logger.child({ runId }).info({ req }, "calling the provider");
// Authorization, cookies and ?t= are censored by path; learned secrets (raw, base64,
// URL- and JSON-encoded) and Bearer/Basic credentials are replaced anywhere in the line.
```

## Tracing a node run

```ts
const telemetry = setupTelemetry({
  serviceName: "flowaid-worker",
  otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
await withNodeRunSpan(
  telemetry.tracer,
  { runId, nodeRunId, nodeId, nodeType, scope, attempt },
  async (span) => {
    const decision = await chain.decideChoice(state, question, ctx);
    annotateDecision(span, decision);
    telemetry.instruments.decisionConfidence.record(decision.confidence, {
      kind: "choice",
      provider: decision.provider,
    });
  },
);
```

Queue jobs carry the trace with `injectTraceContext()` on enqueue and `withExtractedContext(headers, fn)` in
the worker, so one trace spans the API request, the run steps and every node run.
