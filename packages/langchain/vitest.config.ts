import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "langchain",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
