/** NodeResult helpers (CONTRACTS.ts §16). Throwing from `execute` is equivalent to `fail(toFlowaidError(thrown))`. */
import {
  toFlowaidError,
  type DecisionResult,
  type JsonValue,
  type PortName,
  type TokenUsage,
} from "@flowaid/workflow-core";
import type { NodeResult, SuspendRequest } from "./types.js";

export function ok<T>(
  output: T,
  extra: { route?: PortName; usage?: TokenUsage; costUsd?: number; decision?: DecisionResult } = {},
): NodeResult<T> {
  return { kind: "ok", output, ...extra };
}

export function suspend<T>(wait: SuspendRequest, state: JsonValue): NodeResult<T> {
  return { kind: "suspend", wait, state };
}

export function fail<T>(error: unknown): NodeResult<T> {
  return { kind: "error", error: toFlowaidError(error) };
}
