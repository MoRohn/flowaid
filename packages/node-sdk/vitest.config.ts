import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "node-sdk",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
