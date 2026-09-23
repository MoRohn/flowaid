CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."data_class" AS ENUM('public', 'internal', 'sensitive', 'pii');--> statement-breakpoint
CREATE TYPE "public"."node_run_status" AS ENUM('pending', 'running', 'waiting', 'retry_wait', 'completed', 'failed', 'skipped', 'cancelled', 'reused');--> statement-breakpoint
CREATE TYPE "public"."retention_class" AS ENUM('standard', 'short', 'long', 'none');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'starting', 'running', 'waiting', 'waiting_for_human', 'retrying', 'completed', 'failed', 'cancelled', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'admin', 'editor', 'operator', 'viewer');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"environment_id" uuid,
	"workflow_ids" jsonb,
	"is_service_account" boolean DEFAULT false NOT NULL,
	"rate_limit_per_min" integer,
	"created_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid,
	"node_run_id" uuid,
	"workflow_id" uuid,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"storage" text NOT NULL,
	"storage_key" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"data_class" "data_class" DEFAULT 'internal' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"user_agent" text,
	"request_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"tokens" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector(1536),
	"tsv" "tsvector"
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"storage" text DEFAULT 'db' NOT NULL,
	"ciphertext" text,
	"wrapped_data_key" text,
	"key_version" integer,
	"external_ref" text,
	"public_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"environment_id" uuid,
	"allowed_workflow_ids" jsonb,
	"last_tested_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_used_at" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"title" text,
	"uri" text,
	"mime_type" text,
	"content_hash" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encryption_keys" (
	"version" integer PRIMARY KEY NOT NULL,
	"wrapped_kek" text NOT NULL,
	"master_provider" text NOT NULL,
	"master_kcv" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"protected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"set_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"input" jsonb NOT NULL,
	"expected" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_results" (
	"evaluation_run_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"run_id" uuid,
	"passed" boolean NOT NULL,
	"checks" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "evaluation_results_evaluation_run_id_case_id_pk" PRIMARY KEY("evaluation_run_id","case_id")
);
--> statement-breakpoint
CREATE TABLE "evaluation_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"set_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"baseline_evaluation_run_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"concurrency" integer DEFAULT 4 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"summary" jsonb,
	"report" jsonb,
	"gate" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "evaluation_sets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workflow_id" uuid,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"input_schema" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_subscriptions" (
	"workspace_id" uuid NOT NULL,
	"event_name" text NOT NULL,
	"correlation_key" text,
	"run_id" uuid NOT NULL,
	"node_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_subscriptions_run_id_node_run_id_pk" PRIMARY KEY("run_id","node_run_id")
);
--> statement-breakpoint
CREATE TABLE "human_task_review_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "human_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"node_run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"workflow_id" uuid NOT NULL,
	"request" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assignees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"response" jsonb,
	"responded_by" text,
	"responded_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"payload" jsonb NOT NULL,
	"artifact_id" uuid,
	"error" jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb NOT NULL,
	"pipeline" jsonb NOT NULL,
	"credential_id" uuid,
	"status" text DEFAULT 'new' NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_exposures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"description" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_servers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"transport" text NOT NULL,
	"url" text,
	"command" text,
	"args" jsonb,
	"env" jsonb,
	"auth_kind" text DEFAULT 'none' NOT NULL,
	"credential_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"discovered_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"discovered_resources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"discovered_prompts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_policy" jsonb DEFAULT '{"allow":["*"],"deny":[],"approvalRequired":[]}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"info" jsonb NOT NULL,
	"base_url" text,
	"credential_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"kind" text NOT NULL,
	"node_type" text,
	"node_name" text NOT NULL,
	"status" "node_run_status" NOT NULL,
	"pool" text DEFAULT 'general' NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"fired_ports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decision" jsonb,
	"decision_kind" text,
	"decision_value" text,
	"decision_confidence" numeric(6, 5),
	"decision_provider" text,
	"error" jsonb,
	"usage" jsonb,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"latency_ms" integer,
	"queue_latency_ms" integer,
	"idempotency_key" text,
	"input_hash" text,
	"reused_from_node_run_id" uuid,
	"wait_state" jsonb,
	"worker_id" text,
	"scheduled_seq" integer NOT NULL,
	"ended_seq" integer,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"credential_id" uuid,
	"events" jsonb DEFAULT '["human_task.created","run.failed","trace_review.page"]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid,
	"package_name" text NOT NULL,
	"version" text NOT NULL,
	"source" text NOT NULL,
	"integrity" text,
	"manifests" jsonb NOT NULL,
	"credential_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'disabled' NOT NULL,
	"pool" text DEFAULT 'general' NOT NULL,
	"error" text,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"queue" text NOT NULL,
	"payload" jsonb NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_checkpoints" (
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_checkpoints_run_id_seq_pk" PRIMARY KEY("run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"node_run_id" uuid,
	"node_id" text,
	"scope" text,
	"payload" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "run_events_run_id_seq_pk" PRIMARY KEY("run_id","seq"),
	CONSTRAINT "run_events_payload_size" CHECK (pg_column_size("run_events"."payload") < 262144)
);
--> statement-breakpoint
CREATE TABLE "run_timers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"node_run_id" uuid,
	"purpose" text NOT NULL,
	"fire_at" timestamp with time zone NOT NULL,
	"fired_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"locked_by" text,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"workflow_version_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"origin" text NOT NULL,
	"mode" text NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"outcome" text,
	"error" jsonb,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"parent_run_id" uuid,
	"parent_node_run_id" uuid,
	"source_run_id" uuid,
	"session_id" text,
	"idempotency_key" text,
	"idempotency_hash" text,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"cancel_requested_by" text,
	"cancel_reason" text,
	"usage" jsonb DEFAULT '{"inputTokens":0,"outputTokens":0}'::jsonb NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"node_run_count" integer DEFAULT 0 NOT NULL,
	"privacy" jsonb DEFAULT '{"sensitive":false,"containsPII":false,"doNotPersist":false,"replayable":true}'::jsonb NOT NULL,
	"data_class" "data_class" DEFAULT 'internal' NOT NULL,
	"retention_class" "retention_class" DEFAULT 'standard' NOT NULL,
	"review" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"cron" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"overlap" text DEFAULT 'skip' NOT NULL,
	"catch_up" text DEFAULT 'skip' NOT NULL,
	"max_catch_up" integer DEFAULT 10 NOT NULL,
	"jitter_ms" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_run_id" uuid,
	"last_error" text,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_references" (
	"workspace_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"secret_name" text NOT NULL,
	"credential_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secret_references_workflow_id_environment_id_secret_name_pk" PRIMARY KEY("workflow_id","environment_id","secret_name")
);
--> statement-breakpoint
CREATE TABLE "state_entries" (
	"workspace_id" uuid NOT NULL,
	"namespace" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "state_entries_workspace_id_namespace_key_pk" PRIMARY KEY("workspace_id","namespace","key")
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"definition" jsonb NOT NULL,
	"required_secrets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_resources" jsonb DEFAULT '{"mcpServers":[],"knowledgeSources":[]}'::jsonb NOT NULL,
	"triggers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"definitions" jsonb NOT NULL,
	"source" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credential_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"status" text DEFAULT 'invited' NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"password_changed_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"webhook_id" uuid NOT NULL,
	"run_id" uuid,
	"direction" text NOT NULL,
	"external_id" text,
	"status" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"http_status" integer,
	"error" text,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"path" text NOT NULL,
	"signature" text NOT NULL,
	"require_timestamp" boolean DEFAULT true NOT NULL,
	"idempotency_header" text,
	"secret_credential_id" uuid,
	"response_mode" text DEFAULT 'async' NOT NULL,
	"input_pointer" text DEFAULT '/body' NOT NULL,
	"allowed_headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"callback_url" text,
	"callback_secret_credential_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_deployments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"variable_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"previous_version_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"deployed_by" uuid,
	"deployed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" integer,
	"label" text,
	"definition" jsonb NOT NULL,
	"definition_hash" text NOT NULL,
	"plan" jsonb NOT NULL,
	"plan_hash" text NOT NULL,
	"compiler_version" text NOT NULL,
	"catalog_snapshot" jsonb NOT NULL,
	"diagnostics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"evaluation_run_id" uuid,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"draft" jsonb NOT NULL,
	"draft_revision" integer DEFAULT 1 NOT NULL,
	"draft_diagnostics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"latest_version_id" uuid,
	"evaluation_set_id" uuid,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_cases" ADD CONSTRAINT "evaluation_cases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_cases" ADD CONSTRAINT "evaluation_cases_set_id_evaluation_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."evaluation_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_evaluation_run_id_evaluation_runs_id_fk" FOREIGN KEY ("evaluation_run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_case_id_evaluation_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."evaluation_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_set_id_evaluation_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."evaluation_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_workflow_version_id_workflow_versions_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_sets" ADD CONSTRAINT "evaluation_sets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_sets" ADD CONSTRAINT "evaluation_sets_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_subscriptions" ADD CONSTRAINT "event_subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_subscriptions" ADD CONSTRAINT "event_subscriptions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_task_review_tokens" ADD CONSTRAINT "human_task_review_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_task_review_tokens" ADD CONSTRAINT "human_task_review_tokens_task_id_human_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."human_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_tasks" ADD CONSTRAINT "human_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_tasks" ADD CONSTRAINT "human_tasks_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_exposures" ADD CONSTRAINT "mcp_exposures_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_exposures" ADD CONSTRAINT "mcp_exposures_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_exposures" ADD CONSTRAINT "mcp_exposures_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_runs" ADD CONSTRAINT "node_runs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_runs" ADD CONSTRAINT "node_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugins" ADD CONSTRAINT "plugins_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_checkpoints" ADD CONSTRAINT "run_checkpoints_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_timers" ADD CONSTRAINT "run_timers_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workflow_version_id_workflow_versions_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_references" ADD CONSTRAINT "secret_references_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_references" ADD CONSTRAINT "secret_references_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_references" ADD CONSTRAINT "secret_references_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_references" ADD CONSTRAINT "secret_references_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_entries" ADD CONSTRAINT "state_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tools" ADD CONSTRAINT "tools_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_secret_credential_id_credentials_id_fk" FOREIGN KEY ("secret_credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_callback_secret_credential_id_credentials_id_fk" FOREIGN KEY ("callback_secret_credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_deployments" ADD CONSTRAINT "workflow_deployments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_deployments" ADD CONSTRAINT "workflow_deployments_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_deployments" ADD CONSTRAINT "workflow_deployments_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_deployments" ADD CONSTRAINT "workflow_deployments_version_id_workflow_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_deployments" ADD CONSTRAINT "workflow_deployments_deployed_by_users_id_fk" FOREIGN KEY ("deployed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_ws_name_uq" ON "agents" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_uq" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_ws_idx" ON "api_keys" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "artifacts_run_idx" ON "artifacts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "artifacts_wf_idx" ON "artifacts" USING btree ("workflow_id") WHERE "artifacts"."workflow_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "artifacts_expires_idx" ON "artifacts" USING btree ("expires_at") WHERE "artifacts"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_ws_at_idx" ON "audit_events" USING btree ("workspace_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_resource_idx" ON "audit_events" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "chunks_doc_idx" ON "chunks" USING btree ("document_id","ordinal");--> statement-breakpoint
CREATE INDEX "chunks_source_idx" ON "chunks" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "chunks_embedding_hnsw" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "chunks_tsv_gin" ON "chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "chunks_meta_gin" ON "chunks" USING gin ("metadata");--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_ws_name_env_uq" ON "credentials" USING btree ("workspace_id","name",coalesce("environment_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "credentials_ws_type_idx" ON "credentials" USING btree ("workspace_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_source_external_uq" ON "documents" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_ws_name_uq" ON "environments" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "evaluation_cases_set_idx" ON "evaluation_cases" USING btree ("set_id","ordinal");--> statement-breakpoint
CREATE INDEX "evaluation_runs_set_idx" ON "evaluation_runs" USING btree ("set_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "evaluation_runs_version_idx" ON "evaluation_runs" USING btree ("workflow_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_sets_ws_name_uq" ON "evaluation_sets" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "event_subscriptions_lookup_idx" ON "event_subscriptions" USING btree ("workspace_id","event_name","correlation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "human_task_review_tokens_hash_uq" ON "human_task_review_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "human_task_review_tokens_task_idx" ON "human_task_review_tokens" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "human_tasks_ws_status_idx" ON "human_tasks" USING btree ("workspace_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "human_tasks_run_idx" ON "human_tasks" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "human_tasks_wf_idx" ON "human_tasks" USING btree ("workflow_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_provider_subject_uq" ON "identities" USING btree ("provider","subject");--> statement-breakpoint
CREATE INDEX "identities_user_idx" ON "identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "jobs_ws_created_idx" ON "jobs" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_expires_idx" ON "jobs" USING btree ("expires_at") WHERE "jobs"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_sources_ws_name_uq" ON "knowledge_sources" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_exposures_ws_tool_uq" ON "mcp_exposures" USING btree ("workspace_id","tool_name");--> statement-breakpoint
CREATE INDEX "mcp_exposures_wf_env_idx" ON "mcp_exposures" USING btree ("workflow_id","environment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_servers_ws_name_uq" ON "mcp_servers" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "models_ws_provider_model_uq" ON "models" USING btree ("workspace_id","provider","model");--> statement-breakpoint
CREATE UNIQUE INDEX "node_runs_addr_uq" ON "node_runs" USING btree ("run_id","scope","node_id","attempt");--> statement-breakpoint
CREATE INDEX "node_runs_run_idx" ON "node_runs" USING btree ("run_id","scheduled_seq");--> statement-breakpoint
CREATE INDEX "node_runs_ws_type_idx" ON "node_runs" USING btree ("workspace_id","node_type","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "node_runs_decision_idx" ON "node_runs" USING btree ("workspace_id","decision_kind","decision_confidence") WHERE "node_runs"."decision" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "node_runs_hash_idx" ON "node_runs" USING btree ("run_id","node_id","scope","input_hash");--> statement-breakpoint
CREATE INDEX "notifications_ws_idx" ON "notifications" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plugins_pkg_uq" ON "plugins" USING btree (coalesce("workspace_id", '00000000-0000-0000-0000-000000000000'::uuid),"package_name");--> statement-breakpoint
CREATE INDEX "queue_jobs_ready_idx" ON "queue_jobs" USING btree ("queue","priority","run_at") WHERE "queue_jobs"."done_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_uq" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "run_events_type_idx" ON "run_events" USING btree ("run_id","type");--> statement-breakpoint
CREATE INDEX "run_events_node_run_idx" ON "run_events" USING btree ("node_run_id");--> statement-breakpoint
CREATE INDEX "run_timers_due_idx" ON "run_timers" USING btree ("fire_at") WHERE "run_timers"."fired_at" IS NULL AND "run_timers"."cancelled_at" IS NULL;--> statement-breakpoint
CREATE INDEX "run_timers_run_idx" ON "run_timers" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "runs_ws_created_idx" ON "runs" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "runs_wf_created_idx" ON "runs" USING btree ("workflow_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "runs_ws_status_idx" ON "runs" USING btree ("workspace_id","status") WHERE "runs"."status" NOT IN ('completed','failed','cancelled','timed_out');--> statement-breakpoint
CREATE INDEX "runs_lease_idx" ON "runs" USING btree ("lease_until") WHERE "runs"."lease_owner" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "runs_idem_uq" ON "runs" USING btree ("workspace_id","idempotency_key") WHERE "runs"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "runs_parent_idx" ON "runs" USING btree ("parent_run_id");--> statement-breakpoint
CREATE INDEX "runs_session_idx" ON "runs" USING btree ("workspace_id","session_id");--> statement-breakpoint
CREATE INDEX "runs_expires_idx" ON "runs" USING btree ("expires_at") WHERE "runs"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "schedules_due_idx" ON "schedules" USING btree ("next_run_at") WHERE "schedules"."enabled";--> statement-breakpoint
CREATE INDEX "schedules_wf_env_idx" ON "schedules" USING btree ("workflow_id","environment_id");--> statement-breakpoint
CREATE INDEX "secret_references_cred_idx" ON "secret_references" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "state_entries_expires_idx" ON "state_entries" USING btree ("expires_at") WHERE "state_entries"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "templates_scope_slug_uq" ON "templates" USING btree (coalesce("workspace_id", '00000000-0000-0000-0000-000000000000'::uuid),"slug");--> statement-breakpoint
CREATE UNIQUE INDEX "tools_ws_name_uq" ON "tools" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "user_tokens_hash_uq" ON "user_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "user_tokens_user_idx" ON "user_tokens" USING btree ("user_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "webhook_deliveries_hook_idx" ON "webhook_deliveries" USING btree ("webhook_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "webhook_deliveries_pending_idx" ON "webhook_deliveries" USING btree ("next_attempt_at") WHERE "webhook_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_external_uq" ON "webhook_deliveries" USING btree ("webhook_id","external_id") WHERE "webhook_deliveries"."external_id" IS NOT NULL AND "webhook_deliveries"."direction" = 'inbound';--> statement-breakpoint
CREATE UNIQUE INDEX "webhooks_ws_path_uq" ON "webhooks" USING btree ("workspace_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_deployments_active_uq" ON "workflow_deployments" USING btree ("workflow_id","environment_id") WHERE "workflow_deployments"."active";--> statement-breakpoint
CREATE INDEX "workflow_deployments_wf_idx" ON "workflow_deployments" USING btree ("workflow_id","deployed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_versions_wf_version_uq" ON "workflow_versions" USING btree ("workflow_id","version") WHERE "workflow_versions"."version" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_versions_draft_hash_uq" ON "workflow_versions" USING btree ("workflow_id","plan_hash") WHERE "workflow_versions"."kind" = 'draft';--> statement-breakpoint
CREATE INDEX "workflow_versions_wf_idx" ON "workflow_versions" USING btree ("workflow_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_ws_slug_uq" ON "workflows" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "workflows_ws_updated_idx" ON "workflows" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_uq" ON "workspaces" USING btree ("slug");