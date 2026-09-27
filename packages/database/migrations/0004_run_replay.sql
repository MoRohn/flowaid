-- runs.replay (ARCHITECTURE.md §5.9): how a recorded replay, restart-from-node or fork reuses
-- the node results of runs.source_run_id (the nodes it never reuses, the target's patched inputs).
ALTER TABLE "runs" ADD COLUMN "replay" jsonb;
