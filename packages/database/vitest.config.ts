import { defineConfig } from "vitest/config";

// Unit tests always run; the Postgres suites (*.pg.test.ts) skip unless FLOWAID_TEST_DATABASE_URL
// points at a disposable PostgreSQL 16 + pgvector server (CI starts one as a service).
export default defineConfig({
  test: {
    name: "database",
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
