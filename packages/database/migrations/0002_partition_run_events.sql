-- Monthly partitions for run_events (RUN_EVENTS_PARTITIONED=true). migrate() passes the setting as
-- the session GUC flowaid.run_events_partitioned; without it the table stays a plain table and
-- only the maintenance function below is created (it does nothing on a plain table).
--
-- Partitioned, the primary key becomes (run_id, seq, at): a partition key must be part of every
-- unique index. seq stays dense and unique per run because every append is fenced on
-- runs.last_seq. The retention sweep drops whole months (DROP TABLE run_events_YYYY_MM) and
-- calls flowaid_ensure_run_events_partitions() to keep three months ahead.
CREATE FUNCTION flowaid_ensure_run_events_partitions(months_ahead integer DEFAULT 3) RETURNS integer
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  created integer := 0;
  month date;
  name text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_partitioned_table p JOIN pg_class c ON c.oid = p.partrelid
    WHERE c.relname = 'run_events' AND c.relnamespace = 'public'::regnamespace
  ) THEN
    RETURN 0;
  END IF;
  FOR i IN 0..months_ahead LOOP
    month := (date_trunc('month', now()) + make_interval(months => i))::date;
    name := format('run_events_%s', to_char(month, 'YYYY_MM'));
    IF to_regclass(format('public.%I', name)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF run_events FOR VALUES FROM (%L) TO (%L)',
        name, month, (month + interval '1 month')::date
      );
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF coalesce(current_setting('flowaid.run_events_partitioned', true), '') <> 'true' THEN
    RETURN;
  END IF;

  ALTER TABLE run_events RENAME TO run_events_plain;
  ALTER TABLE run_events_plain RENAME CONSTRAINT run_events_run_id_seq_pk TO run_events_plain_pk;
  ALTER INDEX run_events_type_idx RENAME TO run_events_plain_type_idx;
  ALTER INDEX run_events_node_run_idx RENAME TO run_events_plain_node_run_idx;

  CREATE TABLE run_events (
    run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    seq integer NOT NULL,
    type text NOT NULL,
    node_run_id uuid,
    node_id text,
    scope text,
    payload jsonb NOT NULL,
    at timestamptz NOT NULL,
    CONSTRAINT run_events_payload_size CHECK (pg_column_size(payload) < 262144),
    CONSTRAINT run_events_run_id_seq_at_pk PRIMARY KEY (run_id, seq, at)
  ) PARTITION BY RANGE (at);
  CREATE INDEX run_events_type_idx ON run_events (run_id, type);
  CREATE INDEX run_events_node_run_idx ON run_events (node_run_id);
  CREATE TABLE run_events_default PARTITION OF run_events DEFAULT;
  PERFORM flowaid_ensure_run_events_partitions(3);

  INSERT INTO run_events SELECT * FROM run_events_plain;
  DROP TABLE run_events_plain;

  ALTER TABLE run_events ENABLE ROW LEVEL SECURITY;
  ALTER TABLE run_events FORCE ROW LEVEL SECURITY;
  CREATE POLICY run_events_tenant ON run_events
    USING (flowaid_run_visible(run_id)) WITH CHECK (flowaid_run_visible(run_id));
  GRANT SELECT, INSERT, UPDATE, DELETE ON run_events TO flowaid_app;
  GRANT INSERT ON run_events TO flowaid_code;
END
$$;
