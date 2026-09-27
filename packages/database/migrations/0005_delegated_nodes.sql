CREATE TABLE "delegated_nodes" (
	"node_run_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"pool" text NOT NULL,
	"call" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delegated_nodes" ADD CONSTRAINT "delegated_nodes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegated_nodes" ADD CONSTRAINT "delegated_nodes_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delegated_nodes_ws_run_idx" ON "delegated_nodes" USING btree ("workspace_id","run_id");--> statement-breakpoint
-- Tenant rows like every other table; the orchestrator (flowaid_app) reads and writes them in
-- the worker's system scope.
ALTER TABLE "delegated_nodes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "delegated_nodes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "delegated_nodes_tenant" ON "delegated_nodes" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "delegated_nodes" TO flowaid_app;
--> statement-breakpoint
-- The pool's worker (the sandbox host connects as flowaid_code, which has no table access)
-- claims one delegated node run and completes it. A run claimed longer ago than the stale
-- window is claimable again (its worker died; the queue redelivered the job). Both functions
-- lift RLS only for their own statements and restore the caller's setting.
CREATE FUNCTION flowaid_delegated_claim(p_node_run_id uuid, p_pool text, p_worker text, p_stale_seconds integer DEFAULT 300)
  RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  prior text := coalesce(current_setting('app.bypass_rls', true), '');
  claimed jsonb;
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  UPDATE delegated_nodes
     SET status = 'running', claimed_by = p_worker, claimed_at = now()
   WHERE node_run_id = p_node_run_id
     AND pool = p_pool
     AND (status = 'pending'
          OR (status = 'running' AND claimed_at < now() - make_interval(secs => p_stale_seconds)))
  RETURNING jsonb_build_object('runId', run_id, 'workspaceId', workspace_id, 'call', call) INTO claimed;
  PERFORM set_config('app.bypass_rls', prior, true);
  RETURN claimed;
END
$$;
--> statement-breakpoint
CREATE FUNCTION flowaid_delegated_complete(p_node_run_id uuid, p_worker text, p_result jsonb)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  prior text := coalesce(current_setting('app.bypass_rls', true), '');
  done boolean;
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  UPDATE delegated_nodes
     SET status = 'done', result = p_result, completed_at = now()
   WHERE node_run_id = p_node_run_id AND status = 'running' AND claimed_by = p_worker;
  done := FOUND;
  PERFORM set_config('app.bypass_rls', prior, true);
  RETURN done;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION flowaid_delegated_claim(uuid, text, text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION flowaid_delegated_claim(uuid, text, text, integer) TO flowaid_app, flowaid_code;
--> statement-breakpoint
REVOKE ALL ON FUNCTION flowaid_delegated_complete(uuid, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION flowaid_delegated_complete(uuid, text, jsonb) TO flowaid_app, flowaid_code;
