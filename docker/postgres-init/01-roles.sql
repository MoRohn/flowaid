-- Runs once, on the first start of an empty postgres-data volume (mounted at
-- /docker-entrypoint-initdb.d by docker/compose.yml; the image runs it as the superuser
-- POSTGRES_USER with ON_ERROR_STOP). It creates the two login roles the stack connects with:
--
--   flowaid_app   api and worker (DATABASE_URL). Table privileges and the row-level-security
--                 policies come from migrations/0002_rls.sql (DATABASE.md), which the api runs
--                 as the owner through DATABASE_ADMIN_URL.
--   flowaid_code  worker-code, the sandbox host: queue_jobs, node_runs and run_events (insert)
--                 only, granted by the same migration. Its password is never the owner's.
--
-- Passwords come from the container environment (POSTGRES_APP_PASSWORD, POSTGRES_CODE_PASSWORD;
-- psql 16 \getenv). A missing variable leaves the psql variable unset and the CREATE ROLE
-- fails, which aborts the database initialisation instead of creating a role without a password.

\set ON_ERROR_STOP on
\getenv app_password POSTGRES_APP_PASSWORD
\getenv code_password POSTGRES_CODE_PASSWORD
\getenv db_name POSTGRES_DB

SELECT format('CREATE ROLE flowaid_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flowaid_app') \gexec

SELECT format('CREATE ROLE flowaid_code LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 32 PASSWORD %L', :'code_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flowaid_code') \gexec

-- Rotations: re-running with a new POSTGRES_*_PASSWORD only applies to a fresh volume; change
-- an existing password with ALTER ROLE ... PASSWORD (or wipe the volume).

GRANT CONNECT ON DATABASE :"db_name" TO flowaid_app, flowaid_code;
GRANT USAGE ON SCHEMA public TO flowaid_app, flowaid_code;

-- The owner's privileges on future tables are granted by migrations, not by default ACLs, so
-- the sandbox role never receives more than the migration lists.
