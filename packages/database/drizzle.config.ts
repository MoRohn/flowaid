import { defineConfig } from "drizzle-kit";

// `pnpm --filter @flowaid/database db:generate` writes the next migration from src/schema.ts.
// Only the migration generator uses this file; migrations are applied by `migrate()`.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
});
