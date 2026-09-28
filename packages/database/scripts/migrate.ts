/**
 * Applies the pending migrations, as the api does before it listens:
 *
 *   DATABASE_URL=postgres://… pnpm db:migrate
 *
 * Connects as DATABASE_ADMIN_URL when set (the schema owner), else DATABASE_URL, and honours
 * RUN_EVENTS_PARTITIONED on a first migration.
 */
import { loadEnv } from "@flowaid/env";
import { migrateFromEnv } from "../src/migrate.js";

await migrateFromEnv(loadEnv());
console.log("migrations applied");
