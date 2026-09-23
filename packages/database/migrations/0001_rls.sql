-- Row-level security (DATABASE.md, Conventions). Every tenant table gets ENABLE and FORCE ROW
-- LEVEL SECURITY, so the owner role is filtered too (only superusers and BYPASSRLS roles are
-- not). A row is visible when its workspace_id equals the transaction's app.workspace_id, or
-- when app.bypass_rls = 'on' (the retention sweep, reprojection, the worker's system scope and
-- DB_RLS=false). An unset or empty app.workspace_id matches nothing: the policies fail closed.
--
-- Global rows (workspace_id IS NULL) of plugins and templates are readable by every workspace
-- and writable only with the bypass. audit_events rows without a workspace (sign-ins) are
-- visible only with the bypass. Run-scoped tables without a workspace_id (run_events,
-- run_checkpoints, run_timers) and evaluation_results follow their parent through SECURITY
-- DEFINER functions, which lets the insert-only flowaid_code role pass the check without read
-- access to runs. users, identities, tokens, encryption_keys and queue_jobs are platform
-- tables without tenant data and without policies.
--
-- The roles are created NOLOGIN when missing (docker/postgres-init/01-roles.sql creates them
-- with passwords first in the compose stack).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flowaid_app') THEN
    CREATE ROLE flowaid_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flowaid_code') THEN
    CREATE ROLE flowaid_code NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;
--> statement-breakpoint
CREATE FUNCTION flowaid_bypass_rls() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(current_setting('app.bypass_rls', true), '') = 'on' $$;
--> statement-breakpoint
CREATE FUNCTION flowaid_workspace_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.workspace_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION flowaid_run_visible(p_run_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT flowaid_bypass_rls() OR EXISTS (
    SELECT 1 FROM runs WHERE id = p_run_id AND workspace_id = flowaid_workspace_id()
  ) $$;
--> statement-breakpoint
CREATE FUNCTION flowaid_evaluation_run_visible(p_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT flowaid_bypass_rls() OR EXISTS (
    SELECT 1 FROM evaluation_runs WHERE id = p_id AND workspace_id = flowaid_workspace_id()
  ) $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION flowaid_run_visible(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION flowaid_run_visible(uuid) TO flowaid_app, flowaid_code;
--> statement-breakpoint
REVOKE ALL ON FUNCTION flowaid_evaluation_run_visible(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION flowaid_evaluation_run_visible(uuid) TO flowaid_app, flowaid_code;
--> statement-breakpoint
REVOKE ALL ON FUNCTION flowaid_bypass_rls() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION flowaid_bypass_rls() TO flowaid_app, flowaid_code;
--> statement-breakpoint
REVOKE ALL ON FUNCTION flowaid_workspace_id() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION flowaid_workspace_id() TO flowaid_app, flowaid_code;
--> statement-breakpoint
ALTER TABLE "agents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "agents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "agents_tenant" ON "agents" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "api_keys_tenant" ON "api_keys" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "artifacts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "artifacts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "artifacts_tenant" ON "artifacts" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "chunks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "chunks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "chunks_tenant" ON "chunks" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "credentials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credentials" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "credentials_tenant" ON "credentials" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "documents_tenant" ON "documents" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "environments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "environments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "environments_tenant" ON "environments" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "evaluation_cases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "evaluation_cases" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "evaluation_cases_tenant" ON "evaluation_cases" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "evaluation_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "evaluation_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "evaluation_runs_tenant" ON "evaluation_runs" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "evaluation_sets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "evaluation_sets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "evaluation_sets_tenant" ON "evaluation_sets" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "event_subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "event_subscriptions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "event_subscriptions_tenant" ON "event_subscriptions" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "human_task_review_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "human_task_review_tokens" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "human_task_review_tokens_tenant" ON "human_task_review_tokens" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "human_tasks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "human_tasks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "human_tasks_tenant" ON "human_tasks" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "jobs_tenant" ON "jobs" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "knowledge_sources" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "knowledge_sources" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "knowledge_sources_tenant" ON "knowledge_sources" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "mcp_exposures" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mcp_exposures" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "mcp_exposures_tenant" ON "mcp_exposures" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "mcp_servers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mcp_servers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "mcp_servers_tenant" ON "mcp_servers" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "memberships_tenant" ON "memberships" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "models" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "models" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "models_tenant" ON "models" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "node_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "node_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "node_runs_tenant" ON "node_runs" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "notifications_tenant" ON "notifications" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "runs_tenant" ON "runs" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "schedules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schedules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "schedules_tenant" ON "schedules" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "secret_references" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "secret_references" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "secret_references_tenant" ON "secret_references" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "state_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "state_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "state_entries_tenant" ON "state_entries" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "tools" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tools" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tools_tenant" ON "tools" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "webhook_deliveries_tenant" ON "webhook_deliveries" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "webhooks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhooks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "webhooks_tenant" ON "webhooks" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "workflow_deployments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflow_deployments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workflow_deployments_tenant" ON "workflow_deployments" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "workflow_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflow_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workflow_versions_tenant" ON "workflow_versions" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "workflows" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflows" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workflows_tenant" ON "workflows" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "plugins" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "plugins" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "plugins_tenant" ON "plugins" USING (workspace_id IS NULL OR workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "templates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "templates_tenant" ON "templates" USING (workspace_id IS NULL OR workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "audit_events_tenant" ON "audit_events" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workspaces" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspaces_tenant" ON "workspaces" USING (id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
ALTER TABLE "run_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "run_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "run_events_tenant" ON "run_events" USING (flowaid_run_visible(run_id)) WITH CHECK (flowaid_run_visible(run_id));
--> statement-breakpoint
ALTER TABLE "run_checkpoints" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "run_checkpoints" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "run_checkpoints_tenant" ON "run_checkpoints" USING (flowaid_run_visible(run_id)) WITH CHECK (flowaid_run_visible(run_id));
--> statement-breakpoint
ALTER TABLE "run_timers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "run_timers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "run_timers_tenant" ON "run_timers" USING (flowaid_run_visible(run_id)) WITH CHECK (flowaid_run_visible(run_id));
--> statement-breakpoint
ALTER TABLE "evaluation_results" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "evaluation_results" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "evaluation_results_tenant" ON "evaluation_results" USING (flowaid_evaluation_run_visible(evaluation_run_id)) WITH CHECK (flowaid_evaluation_run_visible(evaluation_run_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "agents", "api_keys", "artifacts", "audit_events", "chunks", "credentials", "documents", "encryption_keys", "environments", "evaluation_cases", "evaluation_results", "evaluation_runs", "evaluation_sets", "event_subscriptions", "human_task_review_tokens", "human_tasks", "identities", "jobs", "knowledge_sources", "mcp_exposures", "mcp_servers", "memberships", "models", "node_runs", "notifications", "plugins", "queue_jobs", "refresh_tokens", "run_checkpoints", "run_events", "run_timers", "runs", "schedules", "secret_references", "state_entries", "templates", "tools", "user_tokens", "users", "webhook_deliveries", "webhooks", "workflow_deployments", "workflow_versions", "workflows", "workspaces" TO flowaid_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "queue_jobs" TO flowaid_code;
--> statement-breakpoint
GRANT INSERT ON "node_runs", "run_events" TO flowaid_code;
