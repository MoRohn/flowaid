/** Errors the SDK throws: the API's error envelope (API.md §2) as an `Error`, and stream failures. */
import type { JsonValue } from "@flowaid/workflow-core";

/** The body of every failed API response. */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: JsonValue;
    request_id: string;
    run_id?: string;
    node_id?: string;
    node_run_id?: string;
  };
}

/** A non-2xx API response, carrying the envelope's fields. */
export class FlowaidApiError extends Error {
  override readonly name = "FlowaidApiError";
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly details: JsonValue | undefined;
  readonly requestId: string | undefined;
  readonly runId: string | undefined;
  readonly nodeId: string | undefined;

  constructor(status: number, envelope: Partial<ErrorEnvelope["error"]>, fallback: string) {
    super(envelope.message ?? fallback);
    this.status = status;
    this.code = envelope.code ?? `HTTP_${status}`;
    this.retryable = envelope.retryable ?? (status === 429 || status >= 500);
    this.details = envelope.details;
    this.requestId = envelope.request_id;
    this.runId = envelope.run_id;
    this.nodeId = envelope.node_id;
  }

  /** `404 { details: { reason: 'expired' } }`: the requested event position is no longer retained. */
  get expired(): boolean {
    const d = this.details;
    return (
      this.status === 404 &&
      d !== null &&
      typeof d === "object" &&
      !Array.isArray(d) &&
      d.reason === "expired"
    );
  }
}

/** The run's event log no longer holds the resume position (API.md §5.1): re-read the run instead. */
export class StreamExpiredError extends Error {
  override readonly name = "StreamExpiredError";
  constructor(
    readonly runId: string,
    readonly lastEventId: number,
  ) {
    super(`run ${runId}: events after ${lastEventId} are no longer retained`);
  }
}

/** The stream failed `attempts` times in a row; `cause` is the last failure. */
export class StreamDisconnectedError extends Error {
  override readonly name = "StreamDisconnectedError";
  constructor(
    readonly runId: string,
    readonly attempts: number,
    options?: { cause?: unknown },
  ) {
    super(`run ${runId}: the event stream failed ${attempts} times in a row`, options);
  }
}
