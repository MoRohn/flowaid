/**
 * §15 Sandbox (RFC-0019): what a `code`/`shell` node asks of the sandbox, and the executor
 * interface `@flowaid/sandbox` implements. The runtime binds an executor and the node's bridges
 * (SafeFetch, tools, state) into `ExecutionContext.sandbox`.
 */
import type { JsonObject, JsonSchema, JsonValue } from "./json.js";
import type { SafeFetch } from "./providers.js";

/** Run user code: an async function body receiving `inputs`; its return value is the output. */
export interface SandboxRunRequest {
  language: "javascript" | "typescript";
  code: string;
  inputs: JsonObject;
  timeoutMs: number;
  /** isolate heap limit (default 128) */
  memoryMb?: number;
  allowNetwork: boolean;
  /** hosts `fetch` may reach when allowNetwork (exact names or `*.suffix`) */
  allowedHosts: string[];
  /** tool names the code may call (only tools that need no approval) */
  tools: string[];
  /** validates the returned value (SCHEMA_VALIDATION_ERROR on mismatch) */
  outputSchema?: JsonSchema;
}

export interface SandboxLogLine {
  level: "debug" | "info" | "warn" | "error";
  message: string;
}

export interface SandboxRunResult {
  output: JsonValue;
  logs: SandboxLogLine[];
  durationMs: number;
}

/** Run a shell script in a throwaway container (no network, read-only root, bounded memory/pids). */
export interface SandboxShellRequest {
  script: string;
  /** container image (operator allow-listed); the executor's default when omitted */
  image?: string;
  stdin?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  memoryMb?: number;
}

export interface SandboxShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/** Host services the code may reach, each already scoped to the calling node. */
export interface SandboxBridges {
  signal: AbortSignal;
  fetch?: SafeFetch;
  callTool?(name: string, args: JsonValue): Promise<JsonValue>;
  stateGet?(key: string): Promise<JsonValue | null>;
  stateSet?(key: string, value: JsonValue): Promise<void>;
}

export interface SandboxExecutor {
  readonly kind: "isolated-vm" | "container";
  run(req: SandboxRunRequest, bridges: SandboxBridges): Promise<SandboxRunResult>;
  /** only container executors run shell scripts */
  shell?(req: SandboxShellRequest, signal: AbortSignal): Promise<SandboxShellResult>;
}
