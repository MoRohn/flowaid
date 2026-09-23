/**
 * §8 Errors: the serialisable `ErrorInfo`, the `FlowaidError` class hierarchy
 * (one class per `ErrorCode` with `httpStatus` and `retryable`), the
 * `toFlowaidError` normaliser and the HTTP error envelope.
 */
import { z } from "zod";
import { JsonValueSchema, type JsonValue } from "./json.js";
import { NodeIdSchema, type NodeId } from "./ids.js";
import { ErrorCodeSchema, type ErrorCode } from "./policy.js";
import { DiagnosticSchema, type Diagnostic } from "./diagnostics.js";

/** Serialisable error record stored on runs, node runs and events. */
export interface ErrorInfo {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  runId?: string;
  nodeId?: NodeId;
  nodeRunId?: string;
  /** redacted before persistence */
  details?: JsonValue;
  cause?: ErrorInfo;
}
/** Zod schema for {@link ErrorInfo} (recursive through `cause`). */
export const ErrorInfoSchema: z.ZodType<ErrorInfo> = z.lazy(() =>
  z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    runId: z.string().optional(),
    nodeId: NodeIdSchema.optional(),
    nodeRunId: z.string().optional(),
    details: JsonValueSchema.optional(),
    cause: ErrorInfoSchema.optional(),
  }),
);

/** Where an error happened; merged into {@link ErrorInfo} by `toInfo`. */
export interface ErrorContext {
  runId?: string;
  nodeId?: NodeId;
  nodeRunId?: string;
}

/**
 * Base class of every flowaid error. Subclasses fix `code`, `retryable` and
 * `httpStatus`; `details` is JSON that is redacted before persistence; a
 * `cause` that is itself a `FlowaidError` is serialised recursively.
 */
export abstract class FlowaidError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly retryable: boolean;
  readonly httpStatus: number = 500;
  readonly details: JsonValue | undefined;

  constructor(message: string, details?: JsonValue, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.details = details;
  }

  /** Serialises the error (and any `FlowaidError` cause) for storage and the wire. */
  toInfo(ctx?: ErrorContext): ErrorInfo {
    const info: ErrorInfo = { code: this.code, message: this.message, retryable: this.retryable };
    if (ctx?.runId !== undefined) info.runId = ctx.runId;
    if (ctx?.nodeId !== undefined) info.nodeId = ctx.nodeId;
    if (ctx?.nodeRunId !== undefined) info.nodeRunId = ctx.nodeRunId;
    if (this.details !== undefined) info.details = this.details;
    if (this.cause instanceof FlowaidError) info.cause = this.cause.toInfo();
    return info;
  }
}

/** Converts diagnostics to plain JSON for `details` (drops `undefined` optionals). */
function diagnosticsToJson(diagnostics: readonly Diagnostic[]): JsonValue {
  return JsonValueSchema.parse(
    JSON.parse(JSON.stringify(diagnostics.map((d) => DiagnosticSchema.parse(d)))),
  );
}

/** The definition did not compile (422); `diagnostics` carries every error. */
export class WorkflowValidationError extends FlowaidError {
  readonly code = "WORKFLOW_VALIDATION_ERROR" as const;
  readonly retryable = false;
  override readonly httpStatus = 422;
  constructor(readonly diagnostics: readonly Diagnostic[]) {
    super(`${diagnostics.length} diagnostic(s)`, { diagnostics: diagnosticsToJson(diagnostics) });
  }
}
/** A value failed schema validation (422); `issues` lists path/message pairs. */
export class SchemaValidationError extends FlowaidError {
  readonly code = "SCHEMA_VALIDATION_ERROR" as const;
  readonly retryable = false;
  override readonly httpStatus = 422;
  constructor(
    message: string,
    readonly issues: readonly { path: string; message: string }[],
  ) {
    super(message, { issues: issues.map((i) => ({ path: i.path, message: i.message })) });
  }
}
/** A node's `execute()` failed; the node decides whether the failure is retryable. */
export class NodeExecutionError extends FlowaidError {
  readonly code = "NODE_EXECUTION_ERROR" as const;
  constructor(
    message: string,
    readonly retryable: boolean,
    details?: JsonValue,
    options?: { cause?: unknown },
  ) {
    super(message, details, options);
  }
}
/** A tool call (MCP, OpenAPI, workflow, builtin, http) failed (502). */
export class ToolExecutionError extends FlowaidError {
  readonly code = "TOOL_EXECUTION_ERROR" as const;
  override readonly httpStatus = 502;
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly tool: string,
    details?: JsonValue,
  ) {
    super(message, details);
  }
}
/** A model provider returned an error (502). */
export class ProviderError extends FlowaidError {
  readonly code = "PROVIDER_ERROR" as const;
  override readonly httpStatus = 502;
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly provider: string,
    details?: JsonValue,
  ) {
    super(message, details);
  }
}
/** A provider rate-limited the call (429); retryable, optionally after `retryAfterMs`. */
export class ProviderRateLimitedError extends FlowaidError {
  readonly code = "PROVIDER_RATE_LIMITED" as const;
  readonly retryable = true;
  override readonly httpStatus = 429;
  constructor(
    readonly provider: string,
    readonly retryAfterMs?: number,
  ) {
    super(`${provider} rate limited`, retryAfterMs === undefined ? undefined : { retryAfterMs });
  }
}
/** A provider is overloaded (503); retryable. */
export class ProviderOverloadedError extends FlowaidError {
  readonly code = "PROVIDER_OVERLOADED" as const;
  readonly retryable = true;
  override readonly httpStatus = 503;
  constructor(readonly provider: string) {
    super(`${provider} overloaded`);
  }
}
/** A credential is missing, unbound, invalid or rejected (401). */
export class CredentialError extends FlowaidError {
  readonly code = "CREDENTIAL_ERROR" as const;
  readonly retryable = false;
  override readonly httpStatus = 401;
}
/** A node, join, loop or run exceeded its timeout (504); retryable. */
export class TimeoutError extends FlowaidError {
  readonly code = "TIMEOUT_ERROR" as const;
  readonly retryable = true;
  override readonly httpStatus = 504;
}
/** The platform rate-limited the caller (429); retryable, optionally after `retryAfterMs`. */
export class RateLimitError extends FlowaidError {
  readonly code = "RATE_LIMIT_ERROR" as const;
  readonly retryable = true;
  override readonly httpStatus = 429;
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message, retryAfterMs === undefined ? undefined : { retryAfterMs });
  }
}
/** The run or node was cancelled (409). */
export class CancelledError extends FlowaidError {
  readonly code = "CANCELLED_ERROR" as const;
  readonly retryable = false;
  override readonly httpStatus = 409;
}
/** A declared bound (`maxIterations`, `maxCostUsd`, …) was exceeded. */
export class BoundsExceededError extends FlowaidError {
  readonly code = "BOUNDS_EXCEEDED" as const;
  readonly retryable = false;
  constructor(
    readonly bound:
      | "maxIterations"
      | "timeoutMs"
      | "maxCostUsd"
      | "maxTokens"
      | "maxNodeRuns"
      | "maxSubflowDepth",
    readonly limit: number,
    readonly actual: number,
  ) {
    super(`${bound} exceeded (${actual} > ${limit})`, { bound, limit, actual });
  }
}
/** A required input port had no value at execution time. */
export class InputMissingError extends FlowaidError {
  readonly code = "INPUT_MISSING" as const;
  readonly retryable = false;
}
/** A node's output did not satisfy its declared output schema. */
export class OutputSchemaMismatchError extends FlowaidError {
  readonly code = "OUTPUT_SCHEMA_MISMATCH" as const;
  readonly retryable = false;
}
/** A FlowExpr expression or template failed to evaluate. */
export class ExpressionError extends FlowaidError {
  readonly code = "EXPRESSION_ERROR" as const;
  readonly retryable = false;
}
/** Sandboxed code failed or violated its limits. */
export class SandboxError extends FlowaidError {
  readonly code = "SANDBOX_ERROR" as const;
  readonly retryable = false;
}
/** The worker holding a lease died or lost its fence; retryable by another worker. */
export class WorkerLostError extends FlowaidError {
  readonly code = "WORKER_LOST" as const;
  readonly retryable = true;
}
/** An idempotency `none` node was interrupted and cannot be re-executed safely. */
export class NonIdempotentInterruptedError extends FlowaidError {
  readonly code = "NONIDEMPOTENT_INTERRUPTED" as const;
  readonly retryable = false;
}
/** A synchronous run is waiting for a human (202); `humanTaskId` identifies the task. */
export class HumanApprovalRequired extends FlowaidError {
  readonly code = "HUMAN_APPROVAL_REQUIRED" as const;
  readonly retryable = false;
  override readonly httpStatus = 202;
  constructor(readonly humanTaskId: string) {
    super("Human approval required", { humanTaskId });
  }
}
/** A human task expired before it was answered. */
export class HumanTaskExpiredError extends FlowaidError {
  readonly code = "HUMAN_TASK_EXPIRED" as const;
  readonly retryable = false;
}
/** A child run failed; `childRunId` identifies it. */
export class SubflowError extends FlowaidError {
  readonly code = "SUBFLOW_ERROR" as const;
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly childRunId: string,
    details?: JsonValue,
  ) {
    super(message, details);
  }
}
/** The root scope drained without any output node completing. */
export class NoOutputError extends FlowaidError {
  readonly code = "NO_OUTPUT" as const;
  readonly retryable = false;
}
/** A network call failed (502); retryable. */
export class NetworkError extends FlowaidError {
  readonly code = "NETWORK_ERROR" as const;
  readonly retryable = true;
  override readonly httpStatus = 502;
}
/** Resource not found (404). */
export class NotFoundError extends FlowaidError {
  readonly code = "NOT_FOUND" as const;
  readonly retryable = false;
  override readonly httpStatus = 404;
}
/** Optimistic-concurrency or state conflict (409). */
export class ConflictError extends FlowaidError {
  readonly code = "CONFLICT" as const;
  readonly retryable = false;
  override readonly httpStatus = 409;
}
/** Missing or invalid authentication (401). */
export class UnauthorizedError extends FlowaidError {
  readonly code = "UNAUTHORIZED" as const;
  readonly retryable = false;
  override readonly httpStatus = 401;
}
/** Authenticated but not permitted (403). */
export class ForbiddenError extends FlowaidError {
  readonly code = "FORBIDDEN" as const;
  readonly retryable = false;
  override readonly httpStatus = 403;
}
/** Malformed request (400). */
export class BadRequestError extends FlowaidError {
  readonly code = "BAD_REQUEST" as const;
  readonly retryable = false;
  override readonly httpStatus = 400;
}
/** Request body too large (413). */
export class PayloadTooLargeError extends FlowaidError {
  readonly code = "PAYLOAD_TOO_LARGE" as const;
  readonly retryable = false;
  override readonly httpStatus = 413;
}
/** Unexpected failure (500). */
export class InternalError extends FlowaidError {
  readonly code = "INTERNAL" as const;
  readonly retryable = false;
}

/** True for `AbortError`s from `AbortSignal`/`fetch` (including `DOMException`). */
function isAbortError(u: unknown): boolean {
  return typeof u === "object" && u !== null && "name" in u && u.name === "AbortError";
}

/** True for Zod parse errors (by class or, for foreign zod copies, by shape). */
function isZodError(u: unknown): u is z.ZodError {
  if (u instanceof z.ZodError) return true;
  return (
    typeof u === "object" &&
    u !== null &&
    "name" in u &&
    u.name === "ZodError" &&
    "issues" in u &&
    Array.isArray(u.issues)
  );
}

/** Formats a Zod issue path as an RFC 6901 JSON pointer (`""` for the root). */
function issuePathToPointer(path: readonly PropertyKey[]): string {
  return path
    .map((segment) => "/" + String(segment).replace(/~/g, "~0").replace(/\//g, "~1"))
    .join("");
}

/**
 * Wraps unknown throws: FlowaidError passthrough; AbortError → CancelledError;
 * Zod errors → SchemaValidationError (issues as pointer/message pairs);
 * everything else → InternalError (an `Error`'s message and name are kept,
 * the original value becomes `cause`).
 */
export function toFlowaidError(u: unknown): FlowaidError {
  if (u instanceof FlowaidError) return u;
  if (isAbortError(u)) {
    const message = u instanceof Error && u.message.length > 0 ? u.message : "Operation aborted";
    return new CancelledError(message, undefined, { cause: u });
  }
  if (isZodError(u)) {
    const issues = u.issues.map((issue) => ({
      path: issuePathToPointer(issue.path),
      message: issue.message,
    }));
    return new SchemaValidationError(`${issues.length} validation issue(s)`, issues);
  }
  if (u instanceof Error) {
    return new InternalError(
      u.message.length > 0 ? u.message : u.name,
      { name: u.name },
      { cause: u },
    );
  }
  if (typeof u === "string") return new InternalError(u, undefined, { cause: u });
  return new InternalError("Unknown error", undefined, { cause: u });
}

/** Wire envelope for HTTP errors (snake_case per product spec). */
export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    run_id: z.string().optional(),
    node_id: z.string().optional(),
    node_run_id: z.string().optional(),
    details: JsonValueSchema.optional(),
    request_id: z.string(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
