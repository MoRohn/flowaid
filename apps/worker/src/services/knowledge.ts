/**
 * The workspace knowledge base in the worker (ARCHITECTURE.md §10.8): `ctx.knowledge` for
 * retrieval nodes and the ingestion job share one factory. Chunks live in pgvector unless the
 * source's pipeline names a remote index (Qdrant, Pinecone, Weaviate, Milvus, Chroma,
 * Elasticsearch, OpenSearch), whose key is the source's credential. Embedding models resolve their
 * key from the source's `pipeline.embeddingCredentialId`, else the workspace's newest
 * workspace-wide credential of the provider's type, else the server's keys.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { CredentialService } from "@flowaid/credentials";
import {
  PgKnowledgeStore,
  PgVectorIndex,
  credentials,
  knowledgeSources,
  type Database,
} from "@flowaid/database";
import {
  KnowledgeService,
  REMOTE_INDEX_KINDS,
  remoteIndex,
  type RemoteIndexKind,
  type SourceRecord,
} from "@flowaid/knowledge";
import type { ProviderRegistry } from "@flowaid/providers";
import { uuidv7 } from "@flowaid/shared";
import { NotFoundError, type SafeFetch, type VectorIndexAdapter } from "@flowaid/workflow-core";
import type { ServerKeys } from "./credentials.js";

export interface KnowledgeDeps {
  db: Database;
  credentials: CredentialService;
  registry: ProviderRegistry;
  http: SafeFetch;
  serverKeys: ServerKeys;
}

const SERVER_KEY: Record<string, (k: ServerKeys) => Record<string, string> | undefined> = {
  "openai.api_key": (k) => (k.openai ? { apiKey: k.openai } : undefined),
  "anthropic.api_key": (k) => (k.anthropic ? { apiKey: k.anthropic } : undefined),
  "ollama.host": (k) => (k.ollamaHost ? { host: k.ollamaHost } : undefined),
  "ollama.none": (k): Record<string, string> => (k.ollamaHost ? { host: k.ollamaHost } : {}),
};

/** The newest workspace-wide credential of a type (a passing test ranks first). */
async function workspaceCredential(
  db: Database,
  workspaceId: string,
  type: string,
): Promise<string | null> {
  const [row] = await db.tenant(workspaceId, (tx) =>
    tx
      .select({ id: credentials.id })
      .from(credentials)
      .where(
        and(
          eq(credentials.workspaceId, workspaceId),
          eq(credentials.type, type),
          sql`${credentials.environmentId} is null`,
          sql`${credentials.allowedWorkflowIds} is null`,
        ),
      )
      .orderBy(sql`${credentials.lastTestOk} desc nulls last`, desc(credentials.createdAt))
      .limit(1),
  );
  return row?.id ?? null;
}

/** The index a source's chunks live in. */
export async function indexFor(
  deps: KnowledgeDeps,
  workspaceId: string,
  source: Pick<SourceRecord, "id" | "pipeline">,
  signal?: AbortSignal,
): Promise<VectorIndexAdapter> {
  const cfg = source.pipeline.index;
  const adapter = cfg?.adapter ?? "pgvector";
  if (adapter === "pgvector") return new PgVectorIndex(deps.db, workspaceId);
  if (!(REMOTE_INDEX_KINDS as readonly string[]).includes(adapter))
    throw new NotFoundError(`unknown index adapter ${adapter}`);
  const [row] = await deps.db.tenant(workspaceId, (tx) =>
    tx
      .select({ credentialId: knowledgeSources.credentialId })
      .from(knowledgeSources)
      .where(eq(knowledgeSources.id, source.id)),
  );
  const secret = row?.credentialId ? await deps.credentials.decrypt(row.credentialId) : {};
  const apiKey = secret.apiKey ?? secret.token ?? secret.key;
  return remoteIndex(
    adapter as RemoteIndexKind,
    {
      url: typeof cfg?.url === "string" ? cfg.url : "",
      collection: typeof cfg?.collection === "string" ? cfg.collection : "flowaid_chunks",
      ...(apiKey ? { apiKey } : {}),
      ...(typeof cfg?.dimensions === "number" ? { dimensions: cfg.dimensions } : {}),
    },
    deps.http,
    signal,
  );
}

/** The knowledge service of one workspace (runs pass their call context for signals and ids). */
export function knowledgeServiceFor(
  deps: KnowledgeDeps,
  workspaceId: string,
  call: { signal?: AbortSignal; runId?: string; nodeRunId?: string } = {},
): KnowledgeService {
  const store = new PgKnowledgeStore(deps.db, workspaceId);
  const indexes = new Map<string, Promise<VectorIndexAdapter>>();
  // sources may name the credential their embedding model uses (else workspace, else server key)
  const embeddingCredential = new Map<string, string>();
  return new KnowledgeService({
    store,
    index: (source) => {
      const credentialId = (source.pipeline as { embeddingCredentialId?: unknown })
        .embeddingCredentialId;
      if (source.pipeline.embedding && typeof credentialId === "string")
        embeddingCredential.set(
          `${source.pipeline.embedding.provider}/${source.pipeline.embedding.model}`,
          credentialId,
        );
      let index = indexes.get(source.id);
      if (!index)
        indexes.set(source.id, (index = indexFor(deps, workspaceId, source, call.signal)));
      return index;
    },
    embedder: (ref) =>
      deps.registry.embedding(ref, {
        workspaceId,
        http: deps.http,
        ...(call.signal ? { signal: call.signal } : {}),
        credential: async (providerId, credentialType) => {
          if (!credentialType) return undefined;
          const id =
            embeddingCredential.get(`${ref.provider}/${ref.model}`) ??
            (await workspaceCredential(deps.db, workspaceId, credentialType));
          if (id) return { id, value: await deps.credentials.decrypt(id) };
          const key = SERVER_KEY[credentialType]?.(deps.serverKeys);
          return key ? { id: `server:${providerId}`, value: key } : undefined;
        },
      }),
    newId: uuidv7,
    call: {
      ...(call.signal ? { signal: call.signal } : {}),
      ...(call.runId ? { runId: call.runId } : {}),
      ...(call.nodeRunId ? { nodeRunId: call.nodeRunId } : {}),
    },
  });
}
