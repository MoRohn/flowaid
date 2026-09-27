import { defineConfig } from "vitest/config";

// The PostgreSQL case of flowaid.tools.db_query runs only when FLOWAID_TEST_DATABASE_URL points at
// a disposable server; the URL reaches the suite through `inject("testDatabaseUrl")`.
export default defineConfig({
  test: {
    name: "nodes-core",
    include: ["src/**/*.test.ts"],
    environment: "node",
    provide: { testDatabaseUrl: process.env.FLOWAID_TEST_DATABASE_URL?.trim() ?? "" },
  },
});
