/**
 * `createTestContext()` (ARCHITECTURE.md §3.7): an ExecutionContext with in-memory services, so a
 * node can be tested without a database, queue or network. Everything the node does is recorded
 * (`recorder`): emitted events, stream deltas, logs, tool calls, credential reads, state writes
 * and artifacts. Services of capabilities the node did not declare throw `ForbiddenError`.
 */
import {
  CredentialError,
  NetworkError,
  NotFoundError,
  ProviderError,
  type DecisionProvider,
  type EmbeddingProvider,
  type GenerationProvider,
  type Idempotency,
  type JsonObject,
  type JsonValue,
  type ModelRef,
  type NodeCapability,
  type ProviderHop,
  type RunOrigin,
  type ToolDefinition,
  type ToolResult,
  type ToolSource,
} from "@flowaid/workflow-core";
import { scopeContext } from "../context.js";
import type { ExecutionContext, NodeEmittable, ResumeInfo, SafeFetch } from "../types.js";

export interface RecordedToolCall {
  source: ToolSource;
  name: string;
  args: JsonValue;
  result: ToolResult | { error: string };
}

export interface Recorder {
  events: NodeEmittable[];
  deltas: { channel: "text" | "thinking" | "tool_args"; delta: string }[];
  logs: { level: "debug" | "info" | "warn" | "error"; message: string; data?: JsonValue }[];
  toolCalls: RecordedToolCall[];
  credentialReads: string[];
  stateWrites: { namespace: string; key: string; value: JsonValue }[];
  artifacts: Map<string, { name: string; mimeType: string; data: Uint8Array }>;
}

export interface TestTool {
  definition: ToolDefinition;
  handler: (args: JsonValue) => ToolResult | Promise<ToolResult>;
}

export interface TestContextOptions<C = JsonObject> {
  config?: C;
  /** Declared capabilities; services of the others throw ForbiddenError. Default: every capability. */
  capabilities?: readonly NodeCapability[];
  /** slot → decrypted credential fields */
  credentials?: Record<string, Record<string, string>>;
  providers?: {
    decision?: DecisionProvider | ((chain: readonly ProviderHop[]) => DecisionProvider);
    generation?: GenerationProvider | ((ref: ModelRef) => GenerationProvider);
    embedding?: EmbeddingProvider | ((ref: ModelRef) => EmbeddingProvider);
  };
  tools?: readonly TestTool[];
  http?: SafeFetch;
  vars?: Record<string, JsonValue>;
  scope?: ExecutionContext["scope"];
  now?: () => Date;
  signal?: AbortSignal;
  resume?: ResumeInfo;
  budget?: Partial<ExecutionContext["budget"]>;
  node?: Partial<ExecutionContext["node"]>;
  run?: Partial<ExecutionContext["run"]>;
}

const ALL_CAPABILITIES: NodeCapability[] = [
  "network",
  "credentials",
  "tools",
  "state",
  "artifacts",
  "streaming",
  "decision",
  "generation",
  "sandbox",
  "suspend",
];

function pick<T>(value: T | ((arg: never) => T) | undefined, arg: unknown, what: string): T {
  if (value === undefined) {
    throw new ProviderError(
      `No fake ${what} provider was given to createTestContext`,
      false,
      "test",
    );
  }
  return typeof value === "function" ? (value as (a: unknown) => T)(arg) : value;
}

export function createTestContext<C = JsonObject>(
  options: TestContextOptions<C> = {},
): { ctx: ExecutionContext<C>; recorder: Recorder } {
  const recorder: Recorder = {
    events: [],
    deltas: [],
    logs: [],
    toolCalls: [],
    credentialReads: [],
    stateWrites: [],
    artifacts: new Map(),
  };
  const credentials = options.credentials ?? {};
  const stateStore = new Map<string, { value: JsonValue; version: number }>();
  const tools = options.tools ?? [];
  const now = options.now ?? (() => new Date("2026-01-01T00:00:00.000Z"));
  let artifactSeq = 0;
  const log =
    (level: Recorder["logs"][number]["level"]) =>
    (message: string, data?: JsonValue): void => {
      recorder.logs.push(data === undefined ? { level, message } : { level, message, data });
    };

  const ctx: ExecutionContext<C> = {
    run: {
      id: "run_test",
      workflowId: "00000000-0000-4000-8000-000000000000",
      workflowVersionId: "00000000-0000-4000-8000-000000000001",
      environmentId: "00000000-0000-4000-8000-000000000002",
      environment: "test",
      workspaceId: "00000000-0000-4000-8000-000000000003",
      origin: "api" satisfies RunOrigin,
      startedAt: now().toISOString(),
      sessionId: null,
      ...options.run,
    },
    node: {
      id: "node_under_test",
      name: "Node under test",
      type: "flowaid.test.node",
      scope: "",
      attempt: 1,
      nodeRunId: "noderun_test",
      idempotencyKey: null,
      idempotency: "safe" satisfies Idempotency,
      ...options.node,
    },
    config: (options.config ?? {}) as C,
    vars: options.vars ?? {},
    scope: options.scope ?? {},
    signal: options.signal ?? new AbortController().signal,
    logger: { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") },
    credentials: {
      get: (slot) => {
        recorder.credentialReads.push(slot);
        const value = credentials[slot];
        if (!value)
          return Promise.reject(
            new CredentialError(`Credential slot '${slot}' is not bound in this test`),
          );
        return Promise.resolve({ ...value });
      },
      has: (slot) => Object.hasOwn(credentials, slot),
    },
    providers: {
      decision: (chain) => pick(options.providers?.decision, chain, "decision"),
      generation: (ref) => pick(options.providers?.generation, ref, "generation"),
      embedding: (ref) => pick(options.providers?.embedding, ref, "embedding"),
    },
    tools: {
      list: () => Promise.resolve(tools.map((t) => t.definition)),
      call: async (source, name, args) => {
        const tool = tools.find((t) => t.definition.name === name);
        if (!tool) {
          recorder.toolCalls.push({ source, name, args, result: { error: "not found" } });
          throw new NotFoundError(`No test tool '${name}'`);
        }
        const result = await tool.handler(args);
        recorder.toolCalls.push({ source, name, args, result });
        return result;
      },
    },
    state: {
      get: (namespace, key) =>
        Promise.resolve(stateStore.get(`${namespace}:${key}`)?.value ?? null),
      set: (namespace, key, value) => {
        const previous = stateStore.get(`${namespace}:${key}`);
        stateStore.set(`${namespace}:${key}`, { value, version: (previous?.version ?? 0) + 1 });
        recorder.stateWrites.push({ namespace, key, value });
        return Promise.resolve();
      },
      cas: (namespace, key, expectedVersion, value) => {
        const previous = stateStore.get(`${namespace}:${key}`);
        if ((previous?.version ?? 0) !== expectedVersion) return Promise.resolve(false);
        stateStore.set(`${namespace}:${key}`, { value, version: expectedVersion + 1 });
        recorder.stateWrites.push({ namespace, key, value });
        return Promise.resolve(true);
      },
    },
    artifacts: {
      put: (name, data, mimeType) => {
        artifactSeq += 1;
        const id = `artifact_${artifactSeq}`;
        recorder.artifacts.set(id, {
          name,
          mimeType,
          data: typeof data === "string" ? new TextEncoder().encode(data) : data,
        });
        return Promise.resolve({ $artifact: id });
      },
      get: (id) => {
        const artifact = recorder.artifacts.get(id);
        return artifact
          ? Promise.resolve(artifact.data)
          : Promise.reject(new NotFoundError(`No artifact ${id}`));
      },
      url: (id) => Promise.resolve(`memory://artifacts/${id}`),
    },
    events: {
      emit: (event) => void recorder.events.push(event),
      stream: (channel, delta) => void recorder.deltas.push({ channel, delta }),
    },
    budget: {
      remainingCostUsd: null,
      remainingTokens: null,
      remainingMs: 60_000,
      ...options.budget,
    },
    http:
      options.http ??
      (() => Promise.reject(new NetworkError("No http mock was given to createTestContext"))),
    clock: { now },
    ...(options.resume ? { resume: options.resume } : {}),
  };
  return { ctx: scopeContext(ctx, options.capabilities ?? ALL_CAPABILITIES), recorder };
}
