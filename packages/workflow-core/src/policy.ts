/**
 * §5 Policies: error codes, retry/backoff, privacy, node and execution
 * policies, decision failover chains and container bounds.
 */
import { z } from "zod";
import { JsonPointerSchema } from "./json.js";
import { WorkerPoolSchema } from "./manifest.js";

/** Every error code a `FlowaidError` (and the HTTP error envelope) can carry. */
export const ErrorCodeSchema = z.enum([
  // validation / compile
  "WORKFLOW_VALIDATION_ERROR",
  "SCHEMA_VALIDATION_ERROR",
  // execution
  "NODE_EXECUTION_ERROR",
  "TOOL_EXECUTION_ERROR",
  "PROVIDER_ERROR",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_OVERLOADED",
  "CREDENTIAL_ERROR",
  "TIMEOUT_ERROR",
  "RATE_LIMIT_ERROR",
  "CANCELLED_ERROR",
  "BOUNDS_EXCEEDED",
  "INPUT_MISSING",
  "OUTPUT_SCHEMA_MISMATCH",
  "EXPRESSION_ERROR",
  "SANDBOX_ERROR",
  "WORKER_LOST",
  "NONIDEMPOTENT_INTERRUPTED",
  "HUMAN_APPROVAL_REQUIRED",
  "HUMAN_TASK_EXPIRED",
  "SUBFLOW_ERROR",
  "NO_OUTPUT",
  "NETWORK_ERROR",
  // api
  "NOT_FOUND",
  "CONFLICT",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "BAD_REQUEST",
  "PAYLOAD_TOO_LARGE",
  "INTERNAL",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** Retry backoff strategy. */
export const BackoffSchema = z.object({
  type: z.enum(["none", "fixed", "exponential"]).default("exponential"),
  initialMs: z.int().min(0).default(500),
  maxMs: z.int().min(0).default(30_000),
  factor: z.number().min(1).default(2),
  jitter: z.boolean().default(true),
});
/** Node retry policy. */
export const RetryPolicySchema = z.object({
  maxAttempts: z.int().min(1).max(20).default(1),
  backoff: BackoffSchema.prefault({}),
  /** Error codes that are retried. Default: every error whose instance has retryable=true. */
  retryOn: z.array(ErrorCodeSchema).optional(),
  /** Permit retries on idempotency 'none' nodes (compiler: W_RETRY_SIDE_EFFECT instead of E_RETRY_ON_IRREVERSIBLE). */
  allowOnIrreversible: z.boolean().default(false),
});
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

/** Write-time redaction and persistence policy. */
export const PrivacyPolicySchema = z.object({
  sensitive: z.boolean().default(false),
  containsPII: z.boolean().default(false),
  /** Outputs are kept in worker memory for the run only and stored as { "$redacted": true }. */
  doNotPersist: z.boolean().default(false),
  /** JSON pointers into input/output replaced by "[REDACTED]" before persistence. */
  redactFields: z.array(JsonPointerSchema).default([]),
});
export type PrivacyPolicy = z.infer<typeof PrivacyPolicySchema>;

/** Per-node policy overrides (all optional; resolved against the workflow defaults by the compiler). */
export const NodePolicySchema = z.object({
  timeoutMs: z.int().min(1).optional(),
  retry: RetryPolicySchema.optional(),
  /** route ⇒ fires control-out `failed`; ignore ⇒ outputs null, fires `done`. */
  onError: z.enum(["fail", "route", "ignore"]).default("fail"),
  maxCostUsd: z.number().positive().optional(),
  maxTokens: z.int().min(1).optional(),
  pool: WorkerPoolSchema.optional(),
  privacy: PrivacyPolicySchema.optional(),
});
export type NodePolicy = z.infer<typeof NodePolicySchema>;

/** A provider/model pair. */
export const ModelRefSchema = z.object({ provider: z.string().min(1), model: z.string().min(1) });
export type ModelRef = z.infer<typeof ModelRefSchema>;

/** One hop of a decision failover chain. `human` suspends the node for a reviewer and is always last. */
export const ProviderHopSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("typesafe"), model: z.string().default("jev-latest") }),
  z.object({ provider: z.literal("llm"), model: ModelRefSchema }),
  z.object({ provider: z.literal("rule") }),
  z.object({ provider: z.literal("human") }),
  z.object({ provider: z.literal("custom"), id: z.string().min(1), model: z.string().optional() }),
]);
export type ProviderHop = z.infer<typeof ProviderHopSchema>;

/** Workflow-level decision provider chain and batching switch. */
export const DecisionPolicySchema = z.object({
  primary: ProviderHopSchema.default({ provider: "typesafe", model: "jev-latest" }),
  failover: z.array(ProviderHopSchema).default([]),
  /** Compiler-computed batch groups are executed as one provider request. */
  batching: z.boolean().default(true),
});

/** Workflow-level execution policy (timeouts, budgets, concurrency, defaults, retention). */
export const ExecutionPolicySchema = z.object({
  timeoutMs: z
    .int()
    .min(1000)
    .default(15 * 60_000),
  maxCostUsd: z.number().positive().optional(),
  maxTokens: z.int().min(1).optional(),
  /** Global guard against runaway graphs (counts every node run incl. iterations). */
  maxNodeRuns: z.int().min(1).max(100_000).default(2_000),
  maxSubflowDepth: z.int().min(1).max(16).default(4),
  /** Concurrent node executions per run. */
  concurrency: z.int().min(1).max(64).default(8),
  defaultRetry: RetryPolicySchema.prefault({}),
  defaultNodeTimeoutMs: z.int().min(1).default(120_000),
  decisions: DecisionPolicySchema.prefault({}),
  privacy: PrivacyPolicySchema.prefault({}),
  retention: z.enum(["standard", "short", "long", "none"]).default("standard"),
});
export type ExecutionPolicy = z.infer<typeof ExecutionPolicySchema>;

/** Container (loop/foreach) bounds. */
export const BoundsSchema = z.object({
  maxIterations: z.int().min(1).max(10_000),
  timeoutMs: z.int().min(1).optional(),
  maxCostUsd: z.number().positive().optional(),
  maxTokens: z.int().min(1).optional(),
});
export type Bounds = z.infer<typeof BoundsSchema>;
