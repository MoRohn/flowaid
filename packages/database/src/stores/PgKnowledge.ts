/**
 * Knowledge in Postgres (ARCHITECTURE.md §10.8, DATABASE.md): `PgVectorIndex` is the pgvector
 * `VectorIndexAdapter` over `chunks` — cosine distance on `embedding::vector(<d>)` (served by the
 * per-dimension partial HNSW indexes of migration 0005) and full-text rank on the generated `tsv`
 * column — and `PgKnowledgeStore` keeps sources and documents. Both are scoped to one workspace
 * and run under its row-level security. `PgKnowledgeStore` satisfies `@flowaid/knowledge`'s
 * `KnowledgeStore` structurally (this package does not depend on that one).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { uuidv7 } from "@flowaid/shared";
import type {
  IndexHit,
  IndexedChunk,
  JsonObject,
  KnowledgeFilter,
  KnowledgeSourceSummary,
  VectorIndexAdapter,
} from "@flowaid/workflow-core";
import type { Database } from "../db.js";
import { chunks, documents, knowledgeSources } from "../schema.js";

const MAX_DIMENSIONS = 16000;

function filterSql(filter?: KnowledgeFilter) {
  return filter && Object.keys(filter).length
    ? sql`and c.metadata @> ${JSON.stringify(filter)}::jsonb`
    : sql``;
}

interface HitRow extends Record<string, unknown> {
  id: string;
  document_id: string;
  ordinal: number;
  content: string;
  metadata: JsonObject;
  score: number | string;
}

const toHit = (r: HitRow): IndexHit => ({
  chunkId: r.id,
  documentId: r.document_id,
  ordinal: r.ordinal,
  content: r.content,
  metadata: r.metadata,
  score: Number(r.score),
});

export class PgVectorIndex implements VectorIndexAdapter {
  readonly kind = "pgvector";
  readonly supportsKeyword = true;
  constructor(
    private readonly db: Database,
    private readonly workspaceId: string,
  ) {}

  async upsert(sourceId: string, documentId: string, rows: IndexedChunk[]): Promise<void> {
    await this.db.tenant(this.workspaceId, async (tx) => {
      await tx
        .delete(chunks)
        .where(and(eq(chunks.documentId, documentId), eq(chunks.sourceId, sourceId)));
      for (let i = 0; i < rows.length; i += 500)
        await tx.insert(chunks).values(
          rows.slice(i, i + 500).map((c) => ({
            id: c.id,
            workspaceId: this.workspaceId,
            documentId,
            sourceId,
            ordinal: c.ordinal,
            content: c.content,
            tokens: c.tokens,
            metadata: c.metadata,
            embedding: c.embedding,
          })),
        );
    });
  }

  async queryVector(
    sourceIds: readonly string[],
    vector: number[],
    k: number,
    filter?: KnowledgeFilter,
  ): Promise<IndexHit[]> {
    const d = vector.length;
    if (sourceIds.length === 0 || d === 0) return [];
    if (!Number.isInteger(d) || d > MAX_DIMENSIONS)
      throw new RangeError(`unsupported vector size ${d}`);
    if (vector.some((x) => !Number.isFinite(x)))
      throw new RangeError("the query vector has non-finite values");
    const dims = sql.raw(String(d));
    const q = `[${vector.join(",")}]`;
    const rows = await this.db.tenant(this.workspaceId, (tx) =>
      tx.execute<HitRow>(sql`
        select c.id, c.document_id, c.ordinal, c.content, c.metadata,
               1 - (c.embedding::vector(${dims}) <=> ${q}::vector(${dims})) as score
        from chunks c
        where c.workspace_id = ${this.workspaceId}
          and c.source_id in (${sql.join(
            sourceIds.map((s) => sql`${s}::uuid`),
            sql`, `,
          )})
          and c.embedding is not null and vector_dims(c.embedding) = ${d}
          ${filterSql(filter)}
        order by c.embedding::vector(${dims}) <=> ${q}::vector(${dims})
        limit ${Math.max(1, k)}`),
    );
    return [...rows].map(toHit);
  }

  async queryKeyword(
    sourceIds: readonly string[],
    text: string,
    k: number,
    filter?: KnowledgeFilter,
  ): Promise<IndexHit[]> {
    if (sourceIds.length === 0 || !text.trim()) return [];
    const rows = await this.db.tenant(this.workspaceId, (tx) =>
      tx.execute<HitRow>(sql`
        with q as (
          -- every word may match (OR), ranked by cover density: a question finds passages
          -- that share only some of its words
          select to_tsquery('simple', string_agg(quote_literal(w), ' | ')) as query
          from regexp_split_to_table(lower(${text}), '[^[:alnum:]]+') as w
          where length(w) > 1
        )
        select c.id, c.document_id, c.ordinal, c.content, c.metadata,
               ts_rank_cd(c.tsv, q.query) as score
        from chunks c, q
        where c.workspace_id = ${this.workspaceId}
          and c.source_id in (${sql.join(
            sourceIds.map((s) => sql`${s}::uuid`),
            sql`, `,
          )})
          and q.query is not null and c.tsv @@ q.query
          ${filterSql(filter)}
        order by score desc, c.ordinal
        limit ${Math.max(1, k)}`),
    );
    return [...rows].map(toHit);
  }

  async deleteDocument(sourceId: string, documentId: string): Promise<void> {
    await this.db.tenant(this.workspaceId, (tx) =>
      tx
        .delete(chunks)
        .where(and(eq(chunks.sourceId, sourceId), eq(chunks.documentId, documentId))),
    );
  }

  async deleteSource(sourceId: string): Promise<void> {
    await this.db.tenant(this.workspaceId, (tx) =>
      tx.delete(chunks).where(eq(chunks.sourceId, sourceId)),
    );
  }

  async stats(sourceId: string): Promise<{ documents: number; chunks: number }> {
    const [r] = await this.db.tenant(this.workspaceId, (tx) =>
      tx
        .select({
          documents: sql<number>`count(distinct ${chunks.documentId})::int`,
          chunks: sql<number>`count(*)::int`,
        })
        .from(chunks)
        .where(eq(chunks.sourceId, sourceId)),
    );
    return { documents: r?.documents ?? 0, chunks: r?.chunks ?? 0 };
  }
}

export interface PgSourceRecord {
  id: string;
  name: string;
  kind: string;
  status: KnowledgeSourceSummary["status"];
  pipeline: {
    chunker?: JsonObject;
    embedding?: { provider: string; model: string } | null;
    index?: { adapter: string; [key: string]: unknown };
  };
  documents: number;
  chunks: number;
}

export interface PgDocumentWrite {
  sourceId: string;
  externalId: string;
  title: string | null;
  uri: string | null;
  mimeType: string | null;
  contentHash: string;
  metadata: JsonObject;
  chunkCount: number;
  status: "pending" | "indexed" | "error" | "deleted";
  content?: string | null;
  error?: string | null;
}

/** Sources and documents of one workspace (the `KnowledgeStore` of `@flowaid/knowledge`). */
export class PgKnowledgeStore {
  constructor(
    private readonly db: Database,
    private readonly workspaceId: string,
  ) {}

  private async sourcesWhere(id?: string): Promise<PgSourceRecord[]> {
    return this.db.tenant(this.workspaceId, async (tx) => {
      const rows = await tx
        .select({
          s: knowledgeSources,
          documents: sql<number>`(select count(*)::int from documents d where d.source_id = "knowledge_sources"."id" and d.status <> 'deleted')`,
          chunks: sql<number>`(select coalesce(sum(d.chunk_count), 0)::int from documents d where d.source_id = "knowledge_sources"."id" and d.status = 'indexed')`,
        })
        .from(knowledgeSources)
        .where(
          and(
            eq(knowledgeSources.workspaceId, this.workspaceId),
            id ? eq(knowledgeSources.id, id) : undefined,
          ),
        )
        .orderBy(knowledgeSources.name);
      return rows.map((r) => ({
        id: r.s.id,
        name: r.s.name,
        kind: r.s.kind,
        status: r.s.status,
        pipeline: r.s.pipeline,
        documents: Number(r.documents),
        chunks: Number(r.chunks),
      }));
    });
  }

  listSources(): Promise<PgSourceRecord[]> {
    return this.sourcesWhere();
  }

  async getSource(id: string): Promise<PgSourceRecord | null> {
    return (await this.sourcesWhere(id))[0] ?? null;
  }

  async getDocument(sourceId: string, externalId: string) {
    const [d] = await this.db.tenant(this.workspaceId, (tx) =>
      tx
        .select()
        .from(documents)
        .where(and(eq(documents.sourceId, sourceId), eq(documents.externalId, externalId))),
    );
    return d
      ? {
          id: d.id,
          sourceId: d.sourceId,
          externalId: d.externalId,
          contentHash: d.contentHash,
          status: d.status,
          chunkCount: d.chunkCount,
          title: d.title,
          uri: d.uri,
        }
      : null;
  }

  async saveDocument(doc: PgDocumentWrite): Promise<string> {
    const values = {
      title: doc.title,
      uri: doc.uri,
      mimeType: doc.mimeType,
      contentHash: doc.contentHash,
      metadata: doc.metadata,
      chunkCount: doc.chunkCount,
      status: doc.status,
      error: doc.error ?? null,
      updatedAt: new Date(),
      ...(doc.content !== undefined ? { content: doc.content } : {}),
    };
    const [row] = await this.db.tenant(this.workspaceId, (tx) =>
      tx
        .insert(documents)
        .values({
          id: uuidv7(),
          workspaceId: this.workspaceId,
          sourceId: doc.sourceId,
          externalId: doc.externalId,
          ...values,
        })
        .onConflictDoUpdate({ target: [documents.sourceId, documents.externalId], set: values })
        .returning({ id: documents.id }),
    );
    if (!row) throw new Error("document upsert returned no row");
    return row.id;
  }

  async deleteDocument(sourceId: string, externalId: string): Promise<string | null> {
    const [row] = await this.db.tenant(this.workspaceId, (tx) =>
      tx
        .delete(documents)
        .where(and(eq(documents.sourceId, sourceId), eq(documents.externalId, externalId)))
        .returning({ id: documents.id }),
    );
    return row?.id ?? null;
  }

  async documentsById(ids: readonly string[]) {
    const out = new Map<string, { title: string | null; uri: string | null; sourceId: string }>();
    if (ids.length === 0) return out;
    const rows = await this.db.tenant(this.workspaceId, (tx) =>
      tx
        .select({
          id: documents.id,
          title: documents.title,
          uri: documents.uri,
          sourceId: documents.sourceId,
        })
        .from(documents)
        .where(inArray(documents.id, [...ids])),
    );
    for (const r of rows) out.set(r.id, { title: r.title, uri: r.uri, sourceId: r.sourceId });
    return out;
  }

  /** Marks a source's sync state (the ingestion job). */
  async setSourceStatus(
    id: string,
    status: KnowledgeSourceSummary["status"],
    o: { error?: string | null; stats?: JsonObject; synced?: boolean } = {},
  ): Promise<void> {
    await this.db.tenant(this.workspaceId, (tx) =>
      tx
        .update(knowledgeSources)
        .set({
          status,
          lastError: o.error ?? null,
          updatedAt: new Date(),
          ...(o.stats ? { stats: o.stats } : {}),
          ...(o.synced ? { lastSyncAt: new Date() } : {}),
        })
        .where(eq(knowledgeSources.id, id)),
    );
  }

  /** Documents of a source (the ingestion job re-indexes stored uploads; deletes vanished ones). */
  async sourceDocuments(sourceId: string): Promise<
    {
      id: string;
      externalId: string;
      content: string | null;
      title: string | null;
      uri: string | null;
      mimeType: string | null;
      metadata: JsonObject;
      status: string;
    }[]
  > {
    return this.db.tenant(this.workspaceId, (tx) =>
      tx
        .select({
          id: documents.id,
          externalId: documents.externalId,
          content: documents.content,
          title: documents.title,
          uri: documents.uri,
          mimeType: documents.mimeType,
          metadata: documents.metadata,
          status: documents.status,
        })
        .from(documents)
        .where(eq(documents.sourceId, sourceId))
        .orderBy(documents.externalId),
    );
  }
}
