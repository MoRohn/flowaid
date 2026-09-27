-- Knowledge (P6-09, ARCHITECTURE.md §10.8). Each source chooses its embedding model, so
-- chunks.embedding becomes an unsized vector shared by every dimension. HNSW needs a fixed
-- dimension, hence one partial expression index per common embedding size; the pgvector adapter
-- queries `embedding::vector(<d>)` with `vector_dims(embedding) = <d>`, which these indexes serve
-- (other sizes are searched exactly). documents.content keeps the normalised text of uploads so a
-- source can be re-indexed after its pipeline changes; documents.error records indexing failures.
DROP INDEX "chunks_embedding_hnsw";--> statement-breakpoint
ALTER TABLE "chunks" ALTER COLUMN "embedding" SET DATA TYPE vector;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "content" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "error" text;--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw_384" ON "chunks" USING hnsw (("embedding"::vector(384)) vector_cosine_ops) WHERE vector_dims("embedding") = 384;--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw_768" ON "chunks" USING hnsw (("embedding"::vector(768)) vector_cosine_ops) WHERE vector_dims("embedding") = 768;--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw_1024" ON "chunks" USING hnsw (("embedding"::vector(1024)) vector_cosine_ops) WHERE vector_dims("embedding") = 1024;--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw_1536" ON "chunks" USING hnsw (("embedding"::vector(1536)) vector_cosine_ops) WHERE vector_dims("embedding") = 1536;
