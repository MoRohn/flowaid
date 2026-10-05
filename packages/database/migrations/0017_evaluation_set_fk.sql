-- A workflow's linked evaluation set (the publish gate) is cleared when the set is deleted. Links
-- left pointing at sets deleted before this migration are cleared first, so the key can be added.
-- RLS is forced on the migrating role too, so the cleanup lifts it for its own statement.
DO $$
DECLARE
  prior text := coalesce(current_setting('app.bypass_rls', true), '');
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  UPDATE "workflows" w SET "evaluation_set_id" = NULL
  WHERE w."evaluation_set_id" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "evaluation_sets" s WHERE s."id" = w."evaluation_set_id");
  PERFORM set_config('app.bypass_rls', prior, true);
END
$$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "workflows" ADD CONSTRAINT "workflows_evaluation_set_id_evaluation_sets_id_fk" FOREIGN KEY ("evaluation_set_id") REFERENCES "public"."evaluation_sets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
