/**
 * The knowledge base behind the API's routes (ARCHITECTURE.md §10.8): the same service the worker
 * serves `ctx.knowledge` with, for the query playground and document deletes. Chunks live in
 * pgvector unless the source's pipeline names a remote index, whose key is the source's
 * credential. Embedding models use the source's `pipeline.embeddingCredentialId`, else the
 * workspace's credential of the provider's type, else the server's key.
 */
import { eq } from "drizzle-orm";
import { PgKnowledgeStore, PgVectorIndex, knowledgeSources } from "@flowaid/database";
import {
  KnowledgeService,
  REMOTE_INDEX_KINDS,
  remoteIndex,
  type RemoteIndexKind,
  type SourceRecord,
} from "@flowaid/knowledge";
import { uuidv7 } from "@flowaid/shared";
import { NotFoundError, type VectorIndexAdapter } from "@flowaid/workflow-core";
import type { ApiContext } from "../context.js";
import { registryOf, resolveContext } from "./advisor.js";

/** The index a source's chunks live in. */
export async function indexFor(
  ctx: ApiContext,
  workspaceId: string,
  source: Pick<SourceRecord, "id" | "pipeline">,
  signal?: AbortSignal,
): Promise<VectorIndexAdapter> {
  const cfg = source.pipeline.index;
  const adapter = cfg?.adapter ?? "pgvector";
  if (adapter === "pgvector") return new PgVectorIndex(ctx.db, workspaceId);
  if (!(REMOTE_INDEX_KINDS as readonly string[]).includes(adapter))
    throw new NotFoundError(`unknown index adapter ${adapter}`);
  const [row] = await ctx.db.tenant(workspaceId, (tx) =>
    tx
      .select({ credentialId: knowledgeSources.credentialId })
      .from(knowledgeSources)
      .where(eq(knowledgeSources.id, source.id)),
  );
  const secret = row?.credentialId ? await ctx.credentials.decrypt(row.credentialId) : {};
  const apiKey = secret.apiKey ?? secret.token ?? secret.key;
  return remoteIndex(
    adapter as RemoteIndexKind,
    {
      url: typeof cfg?.url === "string" ? cfg.url : "",
      collection: typeof cfg?.collection === "string" ? cfg.collection : "flowaid_chunks",
      ...(apiKey ? { apiKey } : {}),
      ...(typeof cfg?.dimensions === "number" ? { dimensions: cfg.dimensions } : {}),
    },
    ctx.http,
    signal,
  );
}

export function knowledgeServiceFor(
  ctx: ApiContext,
  workspaceId: string,
  signal?: AbortSignal,
): KnowledgeService {
  const base = resolveContext(ctx, workspaceId, signal);
  const embeddingCredential = new Map<string, string>();
  return new KnowledgeService({
    store: new PgKnowledgeStore(ctx.db, workspaceId),
    index: (source) => {
      const credentialId = (source.pipeline as { embeddingCredentialId?: unknown })
        .embeddingCredentialId;
      if (source.pipeline.embedding && typeof credentialId === "string")
        embeddingCredential.set(
          `${source.pipeline.embedding.provider}/${source.pipeline.embedding.model}`,
          credentialId,
        );
      return indexFor(ctx, workspaceId, source, signal);
    },
    embedder: (ref) =>
      registryOf(ctx).embedding(ref, {
        ...base,
        credential: async (providerId, credentialType) => {
          const id = embeddingCredential.get(`${ref.provider}/${ref.model}`);
          if (id && credentialType) return { id, value: await ctx.credentials.decrypt(id) };
          return base.credential(providerId, credentialType);
        },
      }),
    newId: uuidv7,
    call: { ...(signal ? { signal } : {}), runId: "knowledge:playground" },
  });
}
