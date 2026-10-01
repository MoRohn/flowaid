/**
 * The judge for an evaluation's `judge` checks: an LLM decision provider over the generation model
 * the AI builder uses (`selectGenerationModel`: the workspace's `settings.advisorModel`, else the
 * first default whose provider has a workspace credential or a server key). Its calls are priced
 * by the provider registry like any generation, so their cost lands on the evaluation.
 */
import type { CredentialService } from "@flowaid/credentials";
import { workspaces, type Database } from "@flowaid/database";
import { NO_JUDGE_MODEL } from "@flowaid/evaluation";
import {
  LLMDecisionProvider,
  selectGenerationModel,
  type ProviderRegistry,
  type ResolveContext,
} from "@flowaid/providers";
import type { DecisionProvider, JsonObject, SafeFetch } from "@flowaid/workflow-core";
import { eq } from "drizzle-orm";
import { serverKeyCredential, type ServerKeys } from "./credentials.js";
import { workspaceCredential } from "./knowledge.js";

export interface JudgeDeps {
  db: Database;
  registry: ProviderRegistry;
  credentials: CredentialService;
  http: SafeFetch;
  serverKeys: ServerKeys;
}

export type JudgeResolution =
  { judge: DecisionProvider; provider: string; model: string } | { judge: null; reason: string };

/** The workspace's judge, or why there is none (the message judge checks then fail with). */
export async function evaluationJudge(
  deps: JudgeDeps,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<JudgeResolution> {
  const [ws] = await deps.db.system((tx) =>
    tx
      .select({ settings: workspaces.settings })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId)),
  );
  const settings = (ws?.settings ?? {}) as JsonObject;
  const ref = await selectGenerationModel({
    configured: settings.advisorModel,
    registered: deps.registry.list("generation").map((f) => f.id),
    hasKey: async (type) =>
      Boolean(
        serverKeyCredential(type, deps.serverKeys) ||
        (await workspaceCredential(deps.db, workspaceId, type)),
      ),
  });
  if (!ref) return { judge: null, reason: NO_JUDGE_MODEL };
  const ctx: ResolveContext = {
    workspaceId,
    http: deps.http,
    ...(signal ? { signal } : {}),
    credential: async (providerId, credentialType) => {
      if (!credentialType) return undefined;
      const id = await workspaceCredential(deps.db, workspaceId, credentialType);
      if (id) return { id, value: await deps.credentials.decrypt(id) };
      const server = serverKeyCredential(credentialType, deps.serverKeys);
      return server ? { id: `server:${providerId}`, value: server } : undefined;
    },
  };
  try {
    const generation = await deps.registry.generation(ref, ctx);
    return {
      judge: new LLMDecisionProvider(generation),
      provider: ref.provider,
      model: ref.model,
    };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return {
      judge: null,
      reason: `no judge model available: ${ref.provider}/${ref.model} could not be used (${why})`,
    };
  }
}
