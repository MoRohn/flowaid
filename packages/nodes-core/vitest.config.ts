import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "nodes-core",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
