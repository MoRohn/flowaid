/**
 * Capability scoping of the ExecutionContext (ARCHITECTURE.md §3.2): a node only gets the
 * services it declared. Every method of an undeclared service throws `ForbiddenError`, so a
 * missing declaration fails loudly in tests and at run time instead of silently working.
 */
import { ForbiddenError, type NodeCapability } from "@flowaid/workflow-core";
import type {
  ArtifactAccess,
  CredentialAccess,
  EventAccess,
  ExecutionContext,
  ProviderAccess,
  SafeFetch,
  StateAccess,
  ToolAccess,
} from "./types.js";

function forbiddenError(capability: NodeCapability, what: string): ForbiddenError {
  return new ForbiddenError(
    `${what} needs the '${capability}' capability; declare it in the node's capabilities`,
  );
}

/** For synchronous members. */
function forbidden(capability: NodeCapability, what: string): never {
  throw forbiddenError(capability, what);
}

/** For members that return a Promise: they reject rather than throw, like the real service would. */
function rejected(capability: NodeCapability, what: string): Promise<never> {
  return Promise.reject(forbiddenError(capability, what));
}

/** Which capability unlocks which service. */
export const CAPABILITY_SERVICES: Readonly<Record<string, NodeCapability>> = {
  credentials: "credentials",
  http: "network",
  tools: "tools",
  state: "state",
  artifacts: "artifacts",
  "events.stream": "streaming",
  "providers.decision": "decision",
  "providers.generation": "generation",
  "providers.embedding": "generation",
};

/** Wraps a full context so that services of undeclared capabilities throw `ForbiddenError`. */
export function scopeContext<C>(
  ctx: ExecutionContext<C>,
  capabilities: readonly NodeCapability[],
): ExecutionContext<C> {
  const has = (c: NodeCapability) => capabilities.includes(c);
  const credentials: CredentialAccess = has("credentials")
    ? ctx.credentials
    : {
        get: () => rejected("credentials", "ctx.credentials.get"),
        has: () => forbidden("credentials", "ctx.credentials.has"),
      };
  const http: SafeFetch = has("network") ? ctx.http : () => rejected("network", "ctx.http");
  const tools: ToolAccess = has("tools")
    ? ctx.tools
    : {
        list: () => rejected("tools", "ctx.tools.list"),
        call: () => rejected("tools", "ctx.tools.call"),
      };
  const state: StateAccess = has("state")
    ? ctx.state
    : {
        get: () => rejected("state", "ctx.state.get"),
        set: () => rejected("state", "ctx.state.set"),
        cas: () => rejected("state", "ctx.state.cas"),
      };
  const artifacts: ArtifactAccess = has("artifacts")
    ? ctx.artifacts
    : {
        put: () => rejected("artifacts", "ctx.artifacts.put"),
        get: () => rejected("artifacts", "ctx.artifacts.get"),
        url: () => rejected("artifacts", "ctx.artifacts.url"),
      };
  const events: EventAccess = {
    emit: (event) => ctx.events.emit(event),
    stream: has("streaming")
      ? (channel, delta) => ctx.events.stream(channel, delta)
      : () => forbidden("streaming", "ctx.events.stream"),
  };
  const providers: ProviderAccess = {
    decision: has("decision")
      ? (chain, opts) => ctx.providers.decision(chain, opts)
      : () => forbidden("decision", "ctx.providers.decision"),
    generation: has("generation")
      ? (ref, opts) => ctx.providers.generation(ref, opts)
      : () => forbidden("generation", "ctx.providers.generation"),
    embedding: has("generation")
      ? (ref, opts) => ctx.providers.embedding(ref, opts)
      : () => forbidden("generation", "ctx.providers.embedding"),
  };
  return { ...ctx, credentials, http, tools, state, artifacts, events, providers };
}
