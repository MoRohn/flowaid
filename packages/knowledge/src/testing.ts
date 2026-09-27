/**
 * The `VectorIndexAdapter` contract suite (UPGRADE_PLAN P6-09): every adapter that stores its own
 * data runs it — the memory index here, pgvector in @flowaid/database against real Postgres.
 * `make()` returns a fresh, empty adapter (and optionally a cleanup); sources and documents are
 * random ids, so a shared database is fine.
 */
import { describe, expect, it } from "vitest";
import type { IndexedChunk, VectorIndexAdapter } from "@flowaid/workflow-core";
import { hashedEmbedding } from "./fakeEmbedding.js";

export interface ContractOptions {
  dimensions?: number;
  /** ids the adapter's storage accepts (uuids for pgvector) */
  newId: () => string;
  /** create the source / document rows an adapter with foreign keys needs */
  prepare?: (sourceId: string, documentIds: string[]) => Promise<void>;
}

export function vectorIndexContract(
  name: string,
  make: () => Promise<VectorIndexAdapter> | VectorIndexAdapter,
  o: ContractOptions,
): void {
  const dims = o.dimensions ?? 64;
  const chunk = (
    documentId: string,
    ordinal: number,
    content: string,
    metadata: Record<string, string> = {},
  ): IndexedChunk => ({
    id: o.newId(),
    documentId,
    ordinal,
    content,
    tokens: Math.ceil(content.length / 4),
    metadata,
    embedding: hashedEmbedding(content, dims),
  });
  const setup = async () => {
    const index = await make();
    const source = o.newId();
    const other = o.newId();
    const docA = o.newId();
    const docB = o.newId();
    const docC = o.newId();
    await o.prepare?.(source, [docA, docB]);
    await o.prepare?.(other, [docC]);
    await index.upsert(source, docA, [
      chunk(docA, 0, "Refunds are issued to the original card within five business days.", {
        lang: "en",
      }),
      chunk(docA, 1, "Chargebacks are handled by the payments team.", { lang: "en" }),
    ]);
    await index.upsert(source, docB, [
      chunk(docB, 0, "Reset your password from the sign-in page.", { lang: "de" }),
    ]);
    await index.upsert(other, docC, [chunk(docC, 0, "Refunds for gift cards are not possible.")]);
    return { index, source, other, docA, docB, docC };
  };

  describe(`VectorIndexAdapter contract: ${name}`, () => {
    it("finds the nearest chunk by vector, only in the requested sources", async () => {
      const { index, source, docA } = await setup();
      const hits = await index.queryVector(
        [source],
        hashedEmbedding("how are refunds issued to my card", dims),
        2,
      );
      expect(hits[0]).toMatchObject({ documentId: docA, ordinal: 0 });
      expect(hits[0]?.content).toContain("Refunds are issued");
      expect(hits.every((h) => h.content !== "Refunds for gift cards are not possible.")).toBe(
        true,
      );
      expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? -1);
    });

    it("applies metadata filters", async () => {
      const { index, source } = await setup();
      const hits = await index.queryVector([source], hashedEmbedding("password", dims), 5, {
        lang: "de",
      });
      expect(hits.map((h) => h.content)).toEqual(["Reset your password from the sign-in page."]);
    });

    it("ranks by keywords when it supports full-text search", async () => {
      const { index, source } = await setup();
      if (!index.supportsKeyword || !index.queryKeyword) return;
      const hits = await index.queryKeyword([source], "chargebacks payments", 5);
      expect(hits[0]?.content).toBe("Chargebacks are handled by the payments team.");
    });

    it("replaces a document's chunks on upsert and deletes documents and sources", async () => {
      const { index, source, other, docA } = await setup();
      await index.upsert(source, docA, [chunk(docA, 0, "Refunds now take ten days.")]);
      expect(await index.stats(source)).toMatchObject({ chunks: 2 });
      const hits = await index.queryVector([source], hashedEmbedding("refunds", dims), 10);
      expect(hits.filter((h) => h.documentId === docA).map((h) => h.content)).toEqual([
        "Refunds now take ten days.",
      ]);
      await index.deleteDocument(source, docA);
      expect(await index.stats(source)).toMatchObject({ chunks: 1 });
      await index.deleteSource(source);
      expect(await index.stats(source)).toMatchObject({ chunks: 0 });
      expect(await index.stats(other)).toMatchObject({ chunks: 1 });
    });
  });
}
