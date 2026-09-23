/**
 * CONTRACTS.ts §16 — Node SDK. Transcribed from `docs/design/CONTRACTS.ts`; the parity test
 * (`contracts-parity.test.ts`) fails when a §16 name is added, renamed or dropped without an RFC.
 * `SafeFetch` is defined once in `@flowaid/workflow-core` and re-exported here; the other shared
 * types (§1–§15) are imported from there too.
 */
import type { z } from "zod";
import type {
  ControlPortSpec,
  CredentialSlot,
  DataClass,
  DecisionProvider,
  DecisionResult,
  EmbeddingProvider,
  FlowaidError,
  GenerationProvider,
  HumanRequest,
  HumanResponse,
  Idempotency,
  IdempotencySpec,
  JsonObject,
  JsonValue,
  ModelRef,
  NodeCapability,
  NodeId,
  NodeManifest,
  NodeMetadata,
  NodePolicy,
  NodeTypeId,
  PortName,
  PortRule,
  ProviderFactory,
  ProviderHop,
  RunOrigin,
  SafeFetch,
  ScopePath,
  Semver,
  TokenUsage,
  ToolDefinition,
  ToolResult,
  ToolSource,
  WorkerPool,
} from "@flowaid/workflow-core";

export type { SafeFetch };

export interface NodeLogger {
  debug(message: string, data?: JsonValue): void;
  info(message: string, data?: JsonValue): void;
  warn(message: string, data?: JsonValue): void;
  error(message: string, data?: JsonValue): void;
}
export interface CredentialAccess {
  /** Decrypted credential for a declared slot. Throws CredentialError for undeclared/unbound slots. Audited. */
  get(slot: string): Promise<Record<string, string>>;
  has(slot: string): boolean;
}
export interface ProviderAccess {
  /** Failover chain [primary, ...failover]; every hop visible in DecisionResult.attempts. `human` suspends (see NodeResult). */
  decision(chain: readonly ProviderHop[], opts?: { credentialSlot?: string }): DecisionProvider;
  generation(ref: ModelRef, opts?: { credentialSlot?: string }): GenerationProvider;
  embedding(ref: ModelRef, opts?: { credentialSlot?: string }): EmbeddingProvider;
}
export interface ToolAccess {
  list(): Promise<ToolDefinition[]>;
  /** Emits TOOL_CALLED/TOOL_RETURNED; checks capability against the bound credential's scopes. */
  call(
    source: ToolSource,
    name: string,
    args: JsonValue,
    opts?: { timeoutMs?: number },
  ): Promise<ToolResult>;
}
export interface StateAccess {
  get(namespace: "run" | "session" | "workspace", key: string): Promise<JsonValue | null>;
  set(
    namespace: "run" | "session" | "workspace",
    key: string,
    value: JsonValue,
    opts?: { ttlMs?: number },
  ): Promise<void>;
  /** compare-and-set on the entry version; returns false when the version moved */
  cas(
    namespace: "run" | "session" | "workspace",
    key: string,
    expectedVersion: number,
    value: JsonValue,
  ): Promise<boolean>;
}
export interface ArtifactAccess {
  put(
    name: string,
    data: Uint8Array | string,
    mimeType: string,
    opts?: { dataClass?: DataClass },
  ): Promise<{ $artifact: string }>;
  get(id: string): Promise<Uint8Array>;
  url(id: string, ttlMs: number): Promise<string>;
}
export type NodeEmittable =
  | { type: "METRIC"; name: string; value: number; labels?: Record<string, string> }
  | {
      type: "ARTIFACT_CREATED";
      artifactId: string;
      name: string;
      mimeType: string;
      bytes: number;
      dataClass: DataClass;
    };
export interface EventAccess {
  emit(event: NodeEmittable): void;
  /** GENERATION_DELTA (ephemeral) */
  stream(channel: "text" | "thinking" | "tool_args", delta: string): void;
}
export interface BudgetAccess {
  remainingCostUsd: number | null;
  remainingTokens: number | null;
  remainingMs: number;
}
/** What the node waits for when it returns NodeResult.suspend. */
export type SuspendRequest =
  | { kind: "human"; request: Omit<HumanRequest, "origin"> }
  | { kind: "event"; eventName: string; timeoutMs?: number };
/** Present on re-entry after a suspension. */
export type ResumeInfo =
  | { kind: "human"; state: JsonValue; response: HumanResponse; by: string; humanTaskId: string }
  | { kind: "event"; state: JsonValue; payload: JsonValue }
  | { kind: "timeout"; state: JsonValue };

export interface ExecutionContext<TConfig = JsonObject> {
  readonly run: {
    id: string;
    workflowId: string;
    workflowVersionId: string;
    environmentId: string;
    environment: string;
    workspaceId: string;
    origin: RunOrigin;
    startedAt: string;
    sessionId: string | null;
  };
  readonly node: {
    id: NodeId;
    name: string;
    type: NodeTypeId;
    scope: ScopePath;
    attempt: number;
    nodeRunId: string;
    idempotencyKey: string | null;
    idempotency: Idempotency;
  };
  /** rendered (templates/bindables resolved) and validated */
  readonly config: TConfig;
  readonly vars: Readonly<Record<string, JsonValue>>;
  readonly scope: { item?: JsonValue; index?: number; iteration?: number; carry?: JsonObject };
  /** cancellation + node timeout; nodes MUST pass it to every I/O call */
  readonly signal: AbortSignal;
  readonly logger: NodeLogger;
  readonly credentials: CredentialAccess;
  readonly providers: ProviderAccess;
  readonly tools: ToolAccess;
  readonly state: StateAccess;
  readonly artifacts: ArtifactAccess;
  readonly events: EventAccess;
  readonly budget: BudgetAccess;
  readonly http: SafeFetch;
  readonly clock: { now(): Date };
  readonly resume?: ResumeInfo;
}

export type NodeResult<TOutput> =
  | {
      kind: "ok";
      output: TOutput;
      /** a declared control port to fire instead of `done` */
      route?: PortName;
      usage?: TokenUsage;
      costUsd?: number;
      decision?: DecisionResult;
    }
  /** Durable suspension; the runtime persists `state` and re-invokes execute() with ctx.resume. Requires capability 'suspend'. */
  | { kind: "suspend"; wait: SuspendRequest; state: JsonValue }
  | { kind: "error"; error: FlowaidError };

export interface OptionItem {
  value: string;
  label: string;
  description?: string;
  group?: string;
}
export interface OptionContext {
  workspaceId: string;
  credentials: CredentialAccess;
  http: SafeFetch;
  signal: AbortSignal;
  search?: string;
}
export type OptionProvider<TConfig> = (args: {
  config: Partial<TConfig>;
  ctx: OptionContext;
}) => Promise<OptionItem[]>;

export interface NodeDefinition<
  TConfig extends z.ZodObject = z.ZodObject,
  TInput extends z.ZodObject = z.ZodObject,
  TOutput extends z.ZodObject = z.ZodObject,
> {
  id: NodeTypeId;
  version: Semver;
  metadata: NodeMetadata;
  /** Fields with .meta({ 'x-ui': { widget: 'template' } }) accept {{ }} templates; .meta({ 'x-ui': { bindable: true } }) accept Bindings. */
  configSchema: TConfig;
  /** one property per input port; .optional() ⇒ required:false */
  inputSchema: TInput;
  /** one property per output port */
  outputSchema: TOutput;
  dynamicInputs?: z.ZodType;
  controlPorts?: readonly ControlPortSpec[];
  portRules?: readonly PortRule[];
  credentials?: readonly CredentialSlot[];
  capabilities: readonly NodeCapability[];
  idempotency: IdempotencySpec;
  pool?: WorkerPool;
  decision?: NodeManifest["decision"];
  generation?: boolean;
  streams?: boolean;
  defaultPolicy?: Partial<NodePolicy>;
  optionProviders?: Record<string, OptionProvider<z.output<TConfig>>>;
  /** keyed by the version the config comes FROM; must yield a config valid for the next declared version */
  migrations?: Record<string, (config: JsonValue) => JsonValue>;
  execute(
    ctx: ExecutionContext<z.output<TConfig>>,
    input: z.output<TInput>,
  ): Promise<NodeResult<z.output<TOutput>>>;
}
export type AnyNodeDefinition = NodeDefinition<z.ZodObject, z.ZodObject, z.ZodObject>;

export interface CredentialTypeDefinition<S extends z.ZodObject = z.ZodObject> {
  id: string; // "typesafe.api_key"
  name: string;
  /** Fields; z.string().meta({ 'x-secret': true }) marks encrypted + redacted fields. Others are `publicFields`. */
  schema: S;
  /** Connection probe used by POST /v1/credentials/:id/test (runs in the worker). */
  test?: (
    value: z.output<S>,
    http: SafeFetch,
    signal: AbortSignal,
  ) => Promise<{ ok: boolean; message?: string }>;
  /** tool capability scopes this credential type may grant */
  scopes?: readonly string[];
}

export interface NodePackage {
  /** npm name; NodeTypeId prefix for third-party packages ("@community/slack" → "@community/slack.<name>") */
  name: string;
  version: Semver;
  nodes: readonly AnyNodeDefinition[];
  credentialTypes?: readonly CredentialTypeDefinition[];
  providers?: readonly ProviderFactory<DecisionProvider | GenerationProvider | EmbeddingProvider>[];
  /** SDK semver range the package was built against */
  sdk: string;
}
