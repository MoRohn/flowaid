/**
 * The JSON-only message protocol between the worker and a plugin host process (ARCHITECTURE.md
 * §3.5, D21). The worker sends `execute`; the host runs the plugin node and asks the worker for
 * every context service it touches (`call`, answered by `reply`), streams one-way `note`s (logs,
 * events, deltas) and finally answers `done`. `abort` cancels an execution.
 */
import type { ErrorInfo, JsonObject, JsonValue } from "@flowaid/workflow-core";

/** What a plugin node's `ctx` exposes synchronously, sent with `execute`. */
export interface ContextSnapshot {
  run: JsonObject;
  node: JsonObject;
  config: JsonObject;
  vars: JsonObject;
  scope: JsonObject;
  budget: { remainingCostUsd: number | null; remainingTokens: number | null; remainingMs: number };
  resume?: JsonValue;
  /** credential slots `ctx.credentials.has()` answers true for */
  credentialSlots: string[];
  /** synchronous provider facts (id, model, capabilities, dimensions) for the refs in `config` */
  providers: Record<string, JsonObject>;
  sandbox: boolean;
}

/** A serialised `Response` (bodies are base64; SafeFetch already caps their size). */
export interface WireResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
  url: string;
}

export type ToHost =
  /** `modulePath`: an installed package's entry file (the worker resolved it); else allow-listed */
  | { type: "init"; packageName: string; version?: string; modulePath?: string }
  | {
      type: "execute";
      id: string;
      nodeType: string;
      version: string;
      input: JsonObject;
      ctx: ContextSnapshot;
    }
  | { type: "abort"; id: string }
  | { type: "reply"; callId: string; ok: true; value: JsonValue }
  | { type: "reply"; callId: string; ok: false; error: ErrorInfo }
  | { type: "chunk"; callId: string; value: JsonValue }
  | { type: "end"; callId: string };

export type FromHost =
  | { type: "ready"; nodes: string[] }
  | { type: "init_failed"; message: string }
  | { type: "call"; id: string; callId: string; method: string; args: JsonValue[] }
  | { type: "note"; id: string; kind: "log" | "event" | "stream"; payload: JsonValue }
  | { type: "done"; id: string; result: JsonValue };

/** The key of a provider snapshot: `<kind>|<provider>|<model>|<credentialSlot>`. */
export function providerKey(
  kind: "decision" | "generation" | "embedding",
  ref: { provider: string; model: string },
  slot?: string,
): string {
  return `${kind}|${ref.provider}|${ref.model}|${slot ?? ""}`;
}
