import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "pageindex",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
