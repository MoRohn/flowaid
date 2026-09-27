/** An in-memory `KnowledgeStore` (tests, local runs and exported code packages). */
import type { DocumentRecord, DocumentWrite, KnowledgeStore, SourceRecord } from "./service.js";

export class MemoryKnowledgeStore implements KnowledgeStore {
  private readonly sources = new Map<string, SourceRecord>();
  private readonly docs = new Map<string, DocumentRecord & { content?: string | null }>();
  private seq = 0;

  addSource(
    s: Omit<SourceRecord, "documents" | "chunks" | "status"> &
      Partial<Pick<SourceRecord, "status">>,
  ): SourceRecord {
    const rec: SourceRecord = { status: "ready", ...s, documents: 0, chunks: 0 };
    this.sources.set(rec.id, rec);
    return rec;
  }

  private withCounts(s: SourceRecord): SourceRecord {
    const docs = [...this.docs.values()].filter(
      (d) => d.sourceId === s.id && d.status !== "deleted",
    );
    return { ...s, documents: docs.length, chunks: docs.reduce((n, d) => n + d.chunkCount, 0) };
  }

  listSources(): Promise<SourceRecord[]> {
    return Promise.resolve([...this.sources.values()].map((s) => this.withCounts(s)));
  }

  getSource(id: string): Promise<SourceRecord | null> {
    const s = this.sources.get(id);
    return Promise.resolve(s ? this.withCounts(s) : null);
  }

  getDocument(sourceId: string, externalId: string): Promise<DocumentRecord | null> {
    return Promise.resolve(
      [...this.docs.values()].find((d) => d.sourceId === sourceId && d.externalId === externalId) ??
        null,
    );
  }

  async saveDocument(doc: DocumentWrite): Promise<string> {
    const existing = await this.getDocument(doc.sourceId, doc.externalId);
    const id = existing?.id ?? `doc-${++this.seq}`;
    this.docs.set(id, {
      id,
      sourceId: doc.sourceId,
      externalId: doc.externalId,
      contentHash: doc.contentHash,
      status: doc.status,
      chunkCount: doc.chunkCount,
      title: doc.title,
      uri: doc.uri,
      ...(doc.content !== undefined ? { content: doc.content } : {}),
    });
    return id;
  }

  async deleteDocument(sourceId: string, externalId: string): Promise<string | null> {
    const d = await this.getDocument(sourceId, externalId);
    if (!d) return null;
    this.docs.delete(d.id);
    return d.id;
  }

  documentsById(ids: readonly string[]) {
    const out = new Map<string, { title: string | null; uri: string | null; sourceId: string }>();
    for (const id of ids) {
      const d = this.docs.get(id);
      if (d) out.set(id, { title: d.title, uri: d.uri, sourceId: d.sourceId });
    }
    return Promise.resolve(out);
  }
}
