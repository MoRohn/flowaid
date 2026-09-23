-- chunks.tsv becomes a generated column (DATABASE.md: to_tsvector('simple', content)), so the
-- full-text index can never drift from the content. The pgvector extension itself is created at
-- the top of 0000_init.sql because chunks.embedding needs it.
ALTER TABLE "chunks" DROP COLUMN "tsv";
--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "content")) STORED;
--> statement-breakpoint
CREATE INDEX "chunks_tsv_gin" ON "chunks" USING gin ("tsv");
