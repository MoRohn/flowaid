import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BadRequestError,
  BoundsExceededError,
  CancelledError,
  ConflictError,
  CredentialError,
  ErrorEnvelopeSchema,
  ErrorInfoSchema,
  ExpressionError,
  FlowaidError,
  ForbiddenError,
  HumanApprovalRequired,
  HumanTaskExpiredError,
  InputMissingError,
  InternalError,
  NetworkError,
  NoOutputError,
  NodeExecutionError,
  NonIdempotentInterruptedError,
  NotFoundError,
  OutputSchemaMismatchError,
  PayloadTooLargeError,
  ProviderError,
  ProviderOverloadedError,
  ProviderRateLimitedError,
  RateLimitError,
  SandboxError,
  SchemaValidationError,
  SubflowError,
  TimeoutError,
  ToolExecutionError,
  UnauthorizedError,
  WorkerLostError,
  WorkflowValidationError,
  toFlowaidError,
} from "./errors.js";
import { ErrorCodeSchema, type ErrorCode } from "./policy.js";
import type { Diagnostic } from "./diagnostics.js";

/** One instance of every error class with its expected contract. */
const CASES: { error: FlowaidError; code: ErrorCode; httpStatus: number; retryable: boolean }[] = [
  {
    error: new WorkflowValidationError([]),
    code: "WORKFLOW_VALIDATION_ERROR",
    httpStatus: 422,
    retryable: false,
  },
  {
    error: new SchemaValidationError("bad", [{ path: "/a", message: "x" }]),
    code: "SCHEMA_VALIDATION_ERROR",
    httpStatus: 422,
    retryable: false,
  },
  {
    error: new NodeExecutionError("boom", true),
    code: "NODE_EXECUTION_ERROR",
    httpStatus: 500,
    retryable: true,
  },
  {
    error: new NodeExecutionError("boom", false),
    code: "NODE_EXECUTION_ERROR",
    httpStatus: 500,
    retryable: false,
  },
  {
    error: new ToolExecutionError("tool", false, "search"),
    code: "TOOL_EXECUTION_ERROR",
    httpStatus: 502,
    retryable: false,
  },
  {
    error: new ProviderError("prov", true, "openai"),
    code: "PROVIDER_ERROR",
    httpStatus: 502,
    retryable: true,
  },
  {
    error: new ProviderRateLimitedError("typesafe", 1500),
    code: "PROVIDER_RATE_LIMITED",
    httpStatus: 429,
    retryable: true,
  },
  {
    error: new ProviderOverloadedError("anthropic"),
    code: "PROVIDER_OVERLOADED",
    httpStatus: 503,
    retryable: true,
  },
  {
    error: new CredentialError("missing"),
    code: "CREDENTIAL_ERROR",
    httpStatus: 401,
    retryable: false,
  },
  { error: new TimeoutError("slow"), code: "TIMEOUT_ERROR", httpStatus: 504, retryable: true },
  {
    error: new RateLimitError("too many", 100),
    code: "RATE_LIMIT_ERROR",
    httpStatus: 429,
    retryable: true,
  },
  {
    error: new CancelledError("cancelled"),
    code: "CANCELLED_ERROR",
    httpStatus: 409,
    retryable: false,
  },
  {
    error: new BoundsExceededError("maxIterations", 5, 6),
    code: "BOUNDS_EXCEEDED",
    httpStatus: 500,
    retryable: false,
  },
  {
    error: new InputMissingError("input"),
    code: "INPUT_MISSING",
    httpStatus: 500,
    retryable: false,
  },
  {
    error: new OutputSchemaMismatchError("output"),
    code: "OUTPUT_SCHEMA_MISMATCH",
    httpStatus: 500,
    retryable: false,
  },
  {
    error: new ExpressionError("expr"),
    code: "EXPRESSION_ERROR",
    httpStatus: 500,
    retryable: false,
  },
  { error: new SandboxError("sandbox"), code: "SANDBOX_ERROR", httpStatus: 500, retryable: false },
  { error: new WorkerLostError("lost"), code: "WORKER_LOST", httpStatus: 500, retryable: true },
  {
    error: new NonIdempotentInterruptedError("interrupted"),
    code: "NONIDEMPOTENT_INTERRUPTED",
    httpStatus: 500,
    retryable: false,
  },
  {
    error: new HumanApprovalRequired("7a1b2c3d-0000-4000-8000-000000000001"),
    code: "HUMAN_APPROVAL_REQUIRED",
    httpStatus: 202,
    retryable: false,
  },
  {
    error: new HumanTaskExpiredError("expired"),
    code: "HUMAN_TASK_EXPIRED",
    httpStatus: 500,
    retryable: false,
  },
  {
    error: new SubflowError("child failed", false, "child-run"),
    code: "SUBFLOW_ERROR",
    httpStatus: 500,
    retryable: false,
  },
  { error: new NoOutputError("none"), code: "NO_OUTPUT", httpStatus: 500, retryable: false },
  { error: new NetworkError("net"), code: "NETWORK_ERROR", httpStatus: 502, retryable: true },
  { error: new NotFoundError("nf"), code: "NOT_FOUND", httpStatus: 404, retryable: false },
  { error: new ConflictError("conflict"), code: "CONFLICT", httpStatus: 409, retryable: false },
  {
    error: new UnauthorizedError("unauth"),
    code: "UNAUTHORIZED",
    httpStatus: 401,
    retryable: false,
  },
  { error: new ForbiddenError("forbidden"), code: "FORBIDDEN", httpStatus: 403, retryable: false },
  { error: new BadRequestError("bad"), code: "BAD_REQUEST", httpStatus: 400, retryable: false },
  {
    error: new PayloadTooLargeError("big"),
    code: "PAYLOAD_TOO_LARGE",
    httpStatus: 413,
    retryable: false,
  },
  { error: new InternalError("internal"), code: "INTERNAL", httpStatus: 500, retryable: false },
];

describe("error classes", () => {
  it("covers every ErrorCode", () => {
    const covered = new Set(CASES.map((c) => c.code));
    for (const code of ErrorCodeSchema.options) expect(covered.has(code), code).toBe(true);
  });

  for (const { error, code, httpStatus, retryable } of CASES) {
    it(`${error.constructor.name}: code=${code} httpStatus=${httpStatus} retryable=${retryable}`, () => {
      expect(error).toBeInstanceOf(FlowaidError);
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe(code);
      expect(error.httpStatus).toBe(httpStatus);
      expect(error.retryable).toBe(retryable);
      expect(error.name).toBe(error.constructor.name);
      const info = error.toInfo();
      expect(info.code).toBe(code);
      expect(info.retryable).toBe(retryable);
      expect(info.message).toBe(error.message);
      expect(ErrorInfoSchema.safeParse(info).success).toBe(true);
      if (error.details === undefined) expect(info).not.toHaveProperty("details");
      else expect(info.details).toEqual(error.details);
    });
  }

  it("toInfo merges the context and omits absent fields", () => {
    const e = new TimeoutError("slow", { ms: 5 });
    expect(e.toInfo()).toEqual({
      code: "TIMEOUT_ERROR",
      message: "slow",
      retryable: true,
      details: { ms: 5 },
    });
    expect(e.toInfo({ runId: "r", nodeId: "n", nodeRunId: "nr" })).toEqual({
      code: "TIMEOUT_ERROR",
      message: "slow",
      retryable: true,
      runId: "r",
      nodeId: "n",
      nodeRunId: "nr",
      details: { ms: 5 },
    });
    expect(e.toInfo({ runId: "r" })).not.toHaveProperty("nodeId");
  });

  it("toInfo serialises a FlowaidError cause recursively and ignores foreign causes", () => {
    const inner = new NetworkError("ECONNRESET", { host: "x" });
    const mid = new ProviderError("upstream", true, "openai", undefined);
    const outer = new NodeExecutionError(
      "node failed",
      true,
      { attempt: 2 },
      { cause: new NodeExecutionError("wrap", false, undefined, { cause: inner }) },
    );
    const info = outer.toInfo({ runId: "r1" });
    expect(info.cause).toEqual({
      code: "NODE_EXECUTION_ERROR",
      message: "wrap",
      retryable: false,
      cause: {
        code: "NETWORK_ERROR",
        message: "ECONNRESET",
        retryable: true,
        details: { host: "x" },
      },
    });
    expect(info.cause).not.toHaveProperty("runId");
    expect(ErrorInfoSchema.safeParse(info).success).toBe(true);
    const foreign = new NodeExecutionError("x", false, undefined, { cause: new Error("plain") });
    expect(foreign.toInfo()).not.toHaveProperty("cause");
    expect(mid.toInfo()).not.toHaveProperty("cause");
  });

  it("exposes constructor-specific fields and details", () => {
    const diag: Diagnostic = {
      code: "E_CYCLE",
      severity: "error",
      message: "cycle",
      location: { nodeId: "a" },
    };
    const wv = new WorkflowValidationError([diag]);
    expect(wv.diagnostics).toEqual([diag]);
    expect(wv.message).toBe("1 diagnostic(s)");
    expect(wv.details).toEqual({ diagnostics: [diag] });
    expect(new WorkflowValidationError([{ ...diag, related: undefined }]).details).toEqual({
      diagnostics: [diag],
    });

    const sv = new SchemaValidationError("invalid", [{ path: "/a/0", message: "required" }]);
    expect(sv.issues).toEqual([{ path: "/a/0", message: "required" }]);
    expect(sv.details).toEqual({ issues: [{ path: "/a/0", message: "required" }] });

    expect(new ToolExecutionError("t", true, "search", { status: 500 }).tool).toBe("search");
    expect(new ProviderError("p", false, "ollama").provider).toBe("ollama");
    const rl = new ProviderRateLimitedError("typesafe", 250);
    expect(rl.message).toBe("typesafe rate limited");
    expect(rl.details).toEqual({ retryAfterMs: 250 });
    expect(new ProviderRateLimitedError("typesafe").details).toBeUndefined();
    expect(new ProviderOverloadedError("x").message).toBe("x overloaded");
    expect(new RateLimitError("r", 10).details).toEqual({ retryAfterMs: 10 });
    expect(new RateLimitError("r").details).toBeUndefined();
    const be = new BoundsExceededError("maxCostUsd", 1, 1.5);
    expect(be.message).toBe("maxCostUsd exceeded (1.5 > 1)");
    expect(be.details).toEqual({ bound: "maxCostUsd", limit: 1, actual: 1.5 });
    expect(be.bound).toBe("maxCostUsd");
    const ha = new HumanApprovalRequired("task-1");
    expect(ha.humanTaskId).toBe("task-1");
    expect(ha.message).toBe("Human approval required");
    expect(ha.details).toEqual({ humanTaskId: "task-1" });
    expect(new SubflowError("s", true, "child").childRunId).toBe("child");
  });
});

describe("toFlowaidError", () => {
  it("passes FlowaidError instances through unchanged", () => {
    const e = new NotFoundError("gone");
    expect(toFlowaidError(e)).toBe(e);
  });

  it("maps AbortError to CancelledError", () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    const mapped = toFlowaidError(abort);
    expect(mapped).toBeInstanceOf(CancelledError);
    expect(mapped.message).toBe("The operation was aborted");
    expect(mapped.cause).toBe(abort);

    const dom = new DOMException("aborted by signal", "AbortError");
    expect(toFlowaidError(dom)).toBeInstanceOf(CancelledError);

    const controller = new AbortController();
    controller.abort();
    expect(toFlowaidError(controller.signal.reason)).toBeInstanceOf(CancelledError);

    const empty = new Error("");
    empty.name = "AbortError";
    expect(toFlowaidError(empty).message).toBe("Operation aborted");
  });

  it("maps zod errors to SchemaValidationError with pointer paths", () => {
    const schema = z.object({ a: z.array(z.object({ b: z.string() })), "x/y": z.number() });
    const result = schema.safeParse({ a: [{ b: 1 }], "x/y": "no" });
    if (result.success) throw new Error("expected failure");
    const mapped = toFlowaidError(result.error);
    expect(mapped).toBeInstanceOf(SchemaValidationError);
    if (!(mapped instanceof SchemaValidationError)) throw new Error("unreachable");
    expect(mapped.httpStatus).toBe(422);
    expect(mapped.issues.map((i) => i.path)).toEqual(["/a/0/b", "/x~1y"]);
    expect(mapped.issues.every((i) => i.message.length > 0)).toBe(true);
    expect(mapped.message).toBe("2 validation issue(s)");
  });

  it("maps zod-shaped errors from a foreign zod copy", () => {
    const fake = Object.assign(new Error("foreign"), {
      name: "ZodError",
      issues: [{ path: ["k"], message: "bad", code: "custom" }],
    });
    const mapped = toFlowaidError(fake);
    expect(mapped).toBeInstanceOf(SchemaValidationError);
    if (!(mapped instanceof SchemaValidationError)) throw new Error("unreachable");
    expect(mapped.issues).toEqual([{ path: "/k", message: "bad" }]);
  });

  it("maps plain errors to InternalError keeping message, name and cause", () => {
    const plain = new TypeError("oops");
    const mapped = toFlowaidError(plain);
    expect(mapped).toBeInstanceOf(InternalError);
    expect(mapped.message).toBe("oops");
    expect(mapped.details).toEqual({ name: "TypeError" });
    expect(mapped.cause).toBe(plain);
    expect(mapped.retryable).toBe(false);
    expect(mapped.httpStatus).toBe(500);
    expect(toFlowaidError(new RangeError("")).message).toBe("RangeError");
  });

  it("maps non-error throws to InternalError", () => {
    expect(toFlowaidError("a string")).toBeInstanceOf(InternalError);
    expect(toFlowaidError("a string").message).toBe("a string");
    expect(toFlowaidError(42).message).toBe("Unknown error");
    expect(toFlowaidError(null).message).toBe("Unknown error");
    expect(toFlowaidError(undefined).message).toBe("Unknown error");
    expect(toFlowaidError({ some: "object" }).cause).toEqual({ some: "object" });
  });
});

describe("ErrorEnvelopeSchema", () => {
  it("validates the snake_case wire envelope", () => {
    const envelope = {
      error: {
        code: "NOT_FOUND",
        message: "gone",
        retryable: false,
        request_id: "req-1",
        run_id: "r",
      },
    };
    expect(ErrorEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(
      ErrorEnvelopeSchema.safeParse({
        error: { code: "NOPE", message: "", retryable: false, request_id: "x" },
      }).success,
    ).toBe(false);
    expect(
      ErrorEnvelopeSchema.safeParse({ error: { code: "NOT_FOUND", message: "", retryable: false } })
        .success,
    ).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Mapping table and cause preservation.
 * ──────────────────────────────────────────────────────────────────────────── */

describe("toFlowaidError mapping table", () => {
  const abort = Object.assign(new Error("aborted by caller"), { name: "AbortError" });
  const zodFailure = z.object({ n: z.number() }).safeParse({ n: "x" });
  if (zodFailure.success) throw new Error("expected a zod failure");
  const plain = new Error("plain failure");
  const typed = new SyntaxError("bad token");
  const flowaid = new ForbiddenError("nope", { role: "viewer" });

  const table: {
    label: string;
    input: unknown;
    ctor: new (...args: never[]) => FlowaidError;
    code: ErrorCode;
    httpStatus: number;
    retryable: boolean;
    message: string;
    cause: unknown;
  }[] = [
    {
      label: "FlowaidError passthrough",
      input: flowaid,
      ctor: ForbiddenError,
      code: "FORBIDDEN",
      httpStatus: 403,
      retryable: false,
      message: "nope",
      cause: undefined,
    },
    {
      label: "AbortError (Error subclass by name)",
      input: abort,
      ctor: CancelledError,
      code: "CANCELLED_ERROR",
      httpStatus: 409,
      retryable: false,
      message: "aborted by caller",
      cause: abort,
    },
    {
      label: "ZodError",
      input: zodFailure.error,
      ctor: SchemaValidationError,
      code: "SCHEMA_VALIDATION_ERROR",
      httpStatus: 422,
      retryable: false,
      message: "1 validation issue(s)",
      cause: undefined,
    },
    {
      label: "plain Error",
      input: plain,
      ctor: InternalError,
      code: "INTERNAL",
      httpStatus: 500,
      retryable: false,
      message: "plain failure",
      cause: plain,
    },
    {
      label: "built-in Error subclass",
      input: typed,
      ctor: InternalError,
      code: "INTERNAL",
      httpStatus: 500,
      retryable: false,
      message: "bad token",
      cause: typed,
    },
    {
      label: "string",
      input: "oops",
      ctor: InternalError,
      code: "INTERNAL",
      httpStatus: 500,
      retryable: false,
      message: "oops",
      cause: "oops",
    },
    {
      label: "number",
      input: 7,
      ctor: InternalError,
      code: "INTERNAL",
      httpStatus: 500,
      retryable: false,
      message: "Unknown error",
      cause: 7,
    },
    {
      label: "null",
      input: null,
      ctor: InternalError,
      code: "INTERNAL",
      httpStatus: 500,
      retryable: false,
      message: "Unknown error",
      cause: null,
    },
    {
      label: "undefined",
      input: undefined,
      ctor: InternalError,
      code: "INTERNAL",
      httpStatus: 500,
      retryable: false,
      message: "Unknown error",
      cause: undefined,
    },
    {
      label: "plain object",
      input: { some: "object" },
      ctor: InternalError,
      code: "INTERNAL",
      httpStatus: 500,
      retryable: false,
      message: "Unknown error",
      cause: { some: "object" },
    },
  ];

  for (const row of table) {
    it(`${row.label} → ${row.ctor.name}`, () => {
      const mapped = toFlowaidError(row.input);
      expect(mapped).toBeInstanceOf(row.ctor);
      expect(mapped.code).toBe(row.code);
      expect(mapped.httpStatus).toBe(row.httpStatus);
      expect(mapped.retryable).toBe(row.retryable);
      expect(mapped.message).toBe(row.message);
      expect(mapped.cause).toEqual(row.cause);
      expect(mapped.name).toBe(row.ctor.name);
      expect(ErrorInfoSchema.safeParse(mapped.toInfo()).success).toBe(true);
      expect(ErrorCodeSchema.options).toContain(mapped.toInfo().code);
    });
  }

  it("is idempotent: mapping a mapped error returns the same instance", () => {
    for (const row of table) {
      const once = toFlowaidError(row.input);
      expect(toFlowaidError(once)).toBe(once);
    }
  });

  it("keeps the thrown value as `cause` so the original stack survives on InternalError", () => {
    const original = new RangeError("too big");
    const mapped = toFlowaidError(original);
    expect(mapped.cause).toBe(original);
    expect(mapped.details).toEqual({ name: "RangeError" });
    if (!(mapped.cause instanceof Error)) throw new Error("cause is the original error");
    expect(mapped.cause.stack).toBe(original.stack);
  });
});

describe("cause preservation", () => {
  it("serialises a FlowaidError chain of any depth through toInfo() and validates as ErrorInfo", () => {
    const root = new NetworkError("socket hang up", { host: "crm.example.com" });
    const provider = new ProviderError("upstream failed", true, "openai", undefined);
    const withCause = new ToolExecutionError("tool failed", true, "fetch", { status: 502 });
    // `cause` is an Error option; only FlowaidError causes are serialised, recursively.
    const level3 = new NodeExecutionError("node failed", true, undefined, {
      cause: new SubflowError("child failed", false, "child-1", undefined),
    });
    const level2 = new NodeExecutionError("wrapped", false, { attempt: 2 }, { cause: root });
    const level1 = new NodeExecutionError("outer", true, undefined, { cause: level2 });
    const info = level1.toInfo({ runId: "r1", nodeId: "fetch_account", nodeRunId: "nr1" });
    expect(info).toEqual({
      code: "NODE_EXECUTION_ERROR",
      message: "outer",
      retryable: true,
      runId: "r1",
      nodeId: "fetch_account",
      nodeRunId: "nr1",
      cause: {
        code: "NODE_EXECUTION_ERROR",
        message: "wrapped",
        retryable: false,
        details: { attempt: 2 },
        cause: {
          code: "NETWORK_ERROR",
          message: "socket hang up",
          retryable: true,
          details: { host: "crm.example.com" },
        },
      },
    });
    expect(ErrorInfoSchema.safeParse(info).success).toBe(true);
    expect(level3.toInfo().cause).toEqual({
      code: "SUBFLOW_ERROR",
      message: "child failed",
      retryable: false,
    });
    expect(provider.toInfo()).not.toHaveProperty("cause");
    expect(withCause.toInfo()).not.toHaveProperty("cause");
  });

  it("keeps the context on the outer record only and never on the cause chain", () => {
    const inner = new TimeoutError("slow", undefined, { cause: new NetworkError("reset") });
    const outer = new NodeExecutionError("failed", true, undefined, { cause: inner });
    const info = outer.toInfo({ runId: "r", nodeId: "n", nodeRunId: "nr" });
    expect(info.cause).not.toHaveProperty("runId");
    expect(info.cause?.cause).not.toHaveProperty("nodeRunId");
    expect(info.cause?.cause?.code).toBe("NETWORK_ERROR");
  });

  it("preserves a non-Flowaid cause on the instance but leaves it out of toInfo()", () => {
    const plain = new TypeError("not a function");
    const wrapped = new SandboxError("script failed", { line: 3 }, { cause: plain });
    expect(wrapped.cause).toBe(plain);
    expect(wrapped.toInfo()).toEqual({
      code: "SANDBOX_ERROR",
      message: "script failed",
      retryable: false,
      details: { line: 3 },
    });
  });

  it("carries a mapped cause end to end: unknown throw → toFlowaidError → wrapped → toInfo()", () => {
    const thrown: unknown = new Error("ECONNREFUSED");
    const mapped = toFlowaidError(thrown);
    const nodeError = new NodeExecutionError("http call failed", true, undefined, {
      cause: mapped,
    });
    const info = nodeError.toInfo({ nodeId: "fetch_account" });
    expect(info.cause).toEqual({
      code: "INTERNAL",
      message: "ECONNREFUSED",
      retryable: false,
      details: { name: "Error" },
    });
    expect(mapped.cause).toBe(thrown);
    expect(ErrorInfoSchema.safeParse(info).success).toBe(true);
    expect(JSON.parse(JSON.stringify(info))).toEqual(info);
  });

  it("round-trips ErrorInfo with nested causes through ErrorInfoSchema unchanged", () => {
    const info = {
      code: "PROVIDER_ERROR",
      message: "p",
      retryable: true,
      cause: {
        code: "NETWORK_ERROR",
        message: "n",
        retryable: true,
        cause: { code: "INTERNAL", message: "i", retryable: false, details: null },
      },
    };
    expect(ErrorInfoSchema.parse(info)).toEqual(info);
    expect(
      ErrorInfoSchema.safeParse({
        ...info,
        cause: { code: "NOPE", message: "x", retryable: false },
      }).success,
    ).toBe(false);
    expect(ErrorInfoSchema.safeParse({ ...info, nodeId: "Bad Id" }).success).toBe(false);
  });
});
