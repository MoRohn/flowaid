import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "workflow-runtime",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
