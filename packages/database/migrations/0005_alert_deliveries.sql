CREATE TABLE "alert_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"event" text NOT NULL,
	"key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_channel_id_notifications_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_deliveries_key_uq" ON "alert_deliveries" USING btree ("channel_id","key");--> statement-breakpoint
CREATE INDEX "alert_deliveries_ws_idx" ON "alert_deliveries" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
-- Row-level security like every tenant table (migrations/0001_rls.sql).
ALTER TABLE "alert_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alert_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "alert_deliveries_tenant" ON "alert_deliveries" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "alert_deliveries" TO flowaid_app;
