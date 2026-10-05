ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "owner_webhook_id" uuid;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "owner_notification_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "credentials" ADD CONSTRAINT "credentials_owner_webhook_id_webhooks_id_fk" FOREIGN KEY ("owner_webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "credentials" ADD CONSTRAINT "credentials_owner_notification_id_notifications_id_fk" FOREIGN KEY ("owner_notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
-- Secrets FlowAId generated before owners existed get their owner. RLS is forced on the migrating
-- role too, so the backfill lifts it for its own statements and restores the caller's setting.
DO $$
DECLARE
  prior text := coalesce(current_setting('app.bypass_rls', true), '');
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  -- A webhook's signing secret ("webhook <path> <time>"): the one it uses now, and earlier ones its
  -- rotations left behind unless a workflow binds them.
  UPDATE "credentials" c SET "owner_webhook_id" = w."id"
  FROM "webhooks" w
  WHERE c."owner_webhook_id" IS NULL
    AND c."owner_notification_id" IS NULL
    AND c."workspace_id" = w."workspace_id"
    AND c."type" = 'http.header'
    AND starts_with(c."name", 'webhook ' || w."path" || ' ')
    AND (
      w."secret_credential_id" = c."id"
      OR NOT EXISTS (SELECT 1 FROM "secret_references" r WHERE r."credential_id" = c."id")
    );
  -- A notification channel's Slack URL or signing secret ("notification <name> (Slack|signing)").
  UPDATE "credentials" c SET "owner_notification_id" = n."id"
  FROM "notifications" n
  WHERE c."owner_webhook_id" IS NULL
    AND c."owner_notification_id" IS NULL
    AND n."credential_id" = c."id"
    AND c."type" = 'http.header'
    AND starts_with(c."name", 'notification ');
  PERFORM set_config('app.bypass_rls', prior, true);
END
$$;
