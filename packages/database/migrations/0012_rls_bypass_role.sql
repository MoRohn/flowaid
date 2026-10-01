-- The row-level-security bypass is gated on role membership (THREAT_MODEL.md, P3-4). Until now
-- flowaid_bypass_rls() only read the custom setting app.bypass_rls, which any role may set with
-- set_config(): the sandbox host's flowaid_code role could lift every policy for itself. Now the
-- setting counts only for members of the NOLOGIN role flowaid_rls_bypass, which is granted to
-- flowaid_app (the api and worker, whose system scope needs it) and to the migrating owner (its
-- SECURITY DEFINER functions lift RLS for their own statements). flowaid_code is never a member.
-- Superusers are members of every role, as before.
--
-- The roles are created when missing, like 0001_rls.sql does; a migrating role without
-- CREATEROLE needs them prepared first (docker/postgres-init/01-roles.sql, the test harness).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flowaid_rls_bypass') THEN
    CREATE ROLE flowaid_rls_bypass NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT pg_has_role('flowaid_app', 'flowaid_rls_bypass', 'MEMBER') THEN
    BEGIN
      GRANT flowaid_rls_bypass TO flowaid_app;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'flowaid_app must be a member of flowaid_rls_bypass: run "GRANT flowaid_rls_bypass TO flowaid_app" as a superuser, then migrate again';
    END;
  END IF;
  IF NOT pg_has_role(current_user, 'flowaid_rls_bypass', 'MEMBER') THEN
    BEGIN
      EXECUTE format('GRANT flowaid_rls_bypass TO %I', current_user);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'the migrating role % must be a member of flowaid_rls_bypass: run "GRANT flowaid_rls_bypass TO %I" as a superuser, then migrate again', current_user, current_user;
    END;
  END IF;
  IF pg_has_role('flowaid_code', 'flowaid_rls_bypass', 'MEMBER')
     AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = 'flowaid_code') THEN
    RAISE EXCEPTION 'flowaid_code (the sandbox host) must not be a member of flowaid_rls_bypass: REVOKE flowaid_rls_bypass FROM flowaid_code';
  END IF;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION flowaid_bypass_rls() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(current_setting('app.bypass_rls', true), '') = 'on'
           AND pg_has_role(current_user, 'flowaid_rls_bypass', 'MEMBER') $$;
--> statement-breakpoint
-- The visibility functions run as their (member) owner, so a bypass checked inside them would be
-- the owner's, not the caller's. They now answer only "is the parent in this workspace"; the
-- policies check the caller's bypass themselves.
CREATE OR REPLACE FUNCTION flowaid_run_visible(p_run_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT EXISTS (
    SELECT 1 FROM runs WHERE id = p_run_id AND workspace_id = flowaid_workspace_id()
  ) $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION flowaid_evaluation_run_visible(p_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT EXISTS (
    SELECT 1 FROM evaluation_runs WHERE id = p_id AND workspace_id = flowaid_workspace_id()
  ) $$;
--> statement-breakpoint
ALTER POLICY "run_events_tenant" ON "run_events"
  USING (flowaid_bypass_rls() OR flowaid_run_visible(run_id))
  WITH CHECK (flowaid_bypass_rls() OR flowaid_run_visible(run_id));
--> statement-breakpoint
ALTER POLICY "run_checkpoints_tenant" ON "run_checkpoints"
  USING (flowaid_bypass_rls() OR flowaid_run_visible(run_id))
  WITH CHECK (flowaid_bypass_rls() OR flowaid_run_visible(run_id));
--> statement-breakpoint
ALTER POLICY "run_timers_tenant" ON "run_timers"
  USING (flowaid_bypass_rls() OR flowaid_run_visible(run_id))
  WITH CHECK (flowaid_bypass_rls() OR flowaid_run_visible(run_id));
--> statement-breakpoint
ALTER POLICY "evaluation_results_tenant" ON "evaluation_results"
  USING (flowaid_bypass_rls() OR flowaid_evaluation_run_visible(evaluation_run_id))
  WITH CHECK (flowaid_bypass_rls() OR flowaid_evaluation_run_visible(evaluation_run_id));
