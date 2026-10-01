/**
 * Credentials during a run: a node's slots map to workflow secret names (`op.credentials`), bound
 * per environment to credentials that are decrypted once per run (`RunCredentials`) and learned by
 * the redactor. Providers resolve through the workflow's secrets of the matching credential type,
 * then the server's own keys (TYPESAFE_API_KEY, OPENAI_API_KEY, …) as a fallback.
 */
import type { CredentialService, RunCredentials } from "@flowaid/credentials";
import type { CredentialAccess } from "@flowaid/node-sdk";
import {
  CredentialError,
  type CredentialRepository,
  type ExecutionPlan,
} from "@flowaid/workflow-core";
import type { ExecutionCall } from "@flowaid/workflow-runtime";

export interface ServerKeys {
  typesafe?: string;
  openai?: string;
  anthropic?: string;
  ollamaHost?: string;
}

export class RunCredentialCache {
  private readonly byRun = new Map<string, RunCredentials>();
  constructor(private readonly service: CredentialService) {}
  for(runId: string): RunCredentials {
    let c = this.byRun.get(runId);
    if (!c) this.byRun.set(runId, (c = this.service.forRun()));
    return c;
  }
  release(runId: string): void {
    this.byRun.get(runId)?.release();
    this.byRun.delete(runId);
  }
}

/**
 * A node's credential slots: the credential bound to the slot's secret in the run's environment,
 * else the server's own key for the secret's credential type (the same fallback providers use, and
 * the reason a run starts with a required secret unbound when the server has its key).
 */
export function credentialAccessFor(
  call: ExecutionCall,
  repo: CredentialRepository,
  cache: RunCredentialCache,
  plan?: ExecutionPlan,
  keys: ServerKeys = {},
): CredentialAccess {
  const op = call.node.op;
  const slots = op.kind === "task" ? op.credentials : {};
  return {
    has: (slot) => slot in slots,
    get: async (slot) => {
      const secret = slots[slot];
      if (!secret)
        throw new CredentialError(`credential slot '${slot}' is not bound in this workflow`);
      const credentialId = await repo.resolveBinding(call.workflowId, call.environmentId, secret);
      if (credentialId) return cache.for(call.runId).get(credentialId);
      const type = plan?.secrets.find((s) => s.name === secret)?.credentialType;
      const fallback = type ? serverKeyCredential(type, keys) : undefined;
      if (fallback) return { ...fallback };
      throw new CredentialError(
        `secret ${secret} is not bound in environment ${call.environment}${
          type ? ` and the server has no key for ${type}` : ""
        }`,
      );
    },
  };
}

const FALLBACK: Record<string, (k: ServerKeys) => Record<string, string> | undefined> = {
  "typesafe.api_key": (k) => (k.typesafe ? { apiKey: k.typesafe } : undefined),
  "openai.api_key": (k) => (k.openai ? { apiKey: k.openai } : undefined),
  "anthropic.api_key": (k) => (k.anthropic ? { apiKey: k.anthropic } : undefined),
  "ollama.host": (k) => (k.ollamaHost ? { host: k.ollamaHost } : undefined),
  // "no credential" Ollama means the server's own OLLAMA_HOST when one is configured
  "ollama.none": (k) => (k.ollamaHost ? { host: k.ollamaHost } : undefined),
};

/** The server's own key for a credential type (TYPESAFE_API_KEY, …), when configured. */
export function serverKeyCredential(
  credentialType: string,
  keys: ServerKeys,
): Record<string, string> | undefined {
  return FALLBACK[credentialType]?.(keys);
}

/** `ResolveContext.credential` for provider factories. */
export function providerCredential(
  call: ExecutionCall,
  plan: ExecutionPlan | undefined,
  repo: CredentialRepository,
  cache: RunCredentialCache,
  keys: ServerKeys,
) {
  return async (
    providerId: string,
    credentialType: string | undefined,
  ): Promise<{ id: string; value: Record<string, string> } | undefined> => {
    if (!credentialType) return undefined;
    for (const s of plan?.secrets ?? []) {
      if (s.credentialType !== credentialType) continue;
      const id = await repo.resolveBinding(call.workflowId, call.environmentId, s.name);
      if (id) {
        const value = await cache.for(call.runId).get(id);
        // an "Ollama (no credential)" credential reaches the configured OLLAMA_HOST
        return credentialType === "ollama.none" && !value.host && keys.ollamaHost
          ? { id, value: { ...value, host: keys.ollamaHost } }
          : { id, value };
      }
    }
    const fallback = FALLBACK[credentialType]?.(keys);
    return fallback ? { id: `server:${providerId}`, value: fallback } : undefined;
  };
}
