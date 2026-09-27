import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "workflow-sdk",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
