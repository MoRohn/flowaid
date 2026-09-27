import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "openapi-tools",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
