import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "workflow-compiler",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
