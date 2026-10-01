ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "result" jsonb;--> statement-breakpoint
ALTER TABLE "mcp_exposures" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
-- Exposures a version of their workflow declared as an MCP trigger keep following the versions.
UPDATE "mcp_exposures" e SET "source" = 'trigger'
WHERE EXISTS (
  SELECT 1 FROM "workflow_versions" v, jsonb_array_elements(coalesce(v."definition"->'triggers', '[]'::jsonb)) t
  WHERE v."workflow_id" = e."workflow_id" AND t->>'type' = 'mcp' AND t->>'toolName' = e."tool_name"
);--> statement-breakpoint
-- The rest were made by hand; until now only a deploy could switch them off, so switch them back on.
UPDATE "mcp_exposures" SET "enabled" = true WHERE "source" = 'manual' AND "enabled" = false;
