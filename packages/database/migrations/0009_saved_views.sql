CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_name_uq" ON "saved_views" USING btree ("workspace_id","user_id","scope","name");--> statement-breakpoint
-- Row-level security like every tenant table (migrations/0001_rls.sql).
ALTER TABLE "saved_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "saved_views" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "saved_views_tenant" ON "saved_views" USING (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls()) WITH CHECK (workspace_id = flowaid_workspace_id() OR flowaid_bypass_rls());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "saved_views" TO flowaid_app;
