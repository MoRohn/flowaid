import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "nodes-langchain",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
