CREATE TYPE "public"."document_index_state" AS ENUM('queued', 'running', 'ready', 'failed', 'cancel_requested', 'canceled', 'superseded', 'deleted');--> statement-breakpoint
CREATE TABLE "document_indexes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"index_version" integer NOT NULL,
	"state" "document_index_state" DEFAULT 'queued' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"backend" text DEFAULT 'pageindex' NOT NULL,
	"mode" text DEFAULT 'local' NOT NULL,
	"config_hash" text NOT NULL,
	"settings" jsonb NOT NULL,
	"index_model" text,
	"backend_version" text,
	"job_id" uuid NOT NULL,
	"upstream_doc_id" text,
	"page_count" integer,
	"description" text,
	"outline" jsonb,
	"stage" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"remote_deleted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"sha256" text NOT NULL,
	"bytes" integer NOT NULL,
	"media_type" text NOT NULL,
	"file_name" text NOT NULL,
	"artifact_id" uuid,
	"page_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_indexes" ADD CONSTRAINT "document_indexes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_indexes" ADD CONSTRAINT "document_indexes_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_indexes" ADD CONSTRAINT "document_indexes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_indexes" ADD CONSTRAINT "document_indexes_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_indexes_ws_state_idx" ON "document_indexes" USING btree ("workspace_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "document_indexes_doc_version_uq" ON "document_indexes" USING btree ("document_id","index_version");--> statement-breakpoint
CREATE UNIQUE INDEX "document_indexes_active_uq" ON "document_indexes" USING btree ("document_id") WHERE "document_indexes"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "document_indexes_live_uq" ON "document_indexes" USING btree ("version_id","config_hash") WHERE "document_indexes"."state" IN ('queued','running','ready','cancel_requested');--> statement-breakpoint
CREATE UNIQUE INDEX "document_indexes_job_uq" ON "document_indexes" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "document_versions_ws_idx" ON "document_versions" USING btree ("workspace_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_doc_version_uq" ON "document_versions" USING btree ("document_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_doc_sha_uq" ON "document_versions" USING btree ("document_id","sha256");--> statement-breakpoint
-- Row-level security like every tenant table (migrations/0001_rls.sql).
ALTER TABLE "document_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "document_versions_tenant" ON "document_versions" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "document_versions" TO flowaid_app;--> statement-breakpoint
ALTER TABLE "document_indexes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_indexes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "document_indexes_tenant" ON "document_indexes" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "document_indexes" TO flowaid_app;
